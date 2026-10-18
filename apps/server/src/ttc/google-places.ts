import type { PlaceHit } from '@transit/shared';
import { config } from '../config.ts';

/**
 * Google Places (New) Text Search, the first source for place search when
 * GOOGLE_PLACES_API_KEY is set. Only the typed text goes to Google. Cost
 * protection lives here: 24 h cache, a daily cap on real calls (Tbilisi day),
 * no calls for queries under 3 characters, identical in-flight queries share
 * one call. Any failure returns nothing; TTC and Photon still answer.
 */

const URL_SEARCH = 'https://places.googleapis.com/v1/places:searchText';
const TIMEOUT_MS = 4_000;
const MIN_QUERY = 3;
const TTL_MS = 24 * 60 * 60_000;
const MAX_ENTRIES = 1000;
const FIELD_MASK = 'places.displayName,places.formattedAddress,places.location,places.types';

interface GooglePlace {
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  types?: string[];
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

const toHit = (p: GooglePlace): PlaceHit | null => {
  const lat = p.location?.latitude;
  const lon = p.location?.longitude;
  const name = str(p.displayName?.text) ?? str(p.formattedAddress);
  if (typeof lat !== 'number' || typeof lon !== 'number' || !name) return null;
  const address = str(p.formattedAddress);
  return { name, address: address === name ? null : address, lat, lon, kind: str(p.types?.[0]) };
};

/** Tbilisi calendar day (UTC+4, no DST) as YYYY-MM-DD. */
const tbilisiDay = (now = Date.now()): string => new Date(now + 4 * 3_600_000).toISOString().slice(0, 10);

export interface GooglePlacesOptions {
  key: string;
  dailyCap: number;
  fetch?: typeof fetch;
  now?: () => number;
  log?: (msg: string) => void;
}

export function createGoogleSearch(opts: GooglePlacesOptions): (query: string, limit?: number) => Promise<PlaceHit[]> {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((m: string) => console.warn(m));
  const cache = new Map<string, { at: number; hits: PlaceHit[] }>();
  const inflight = new Map<string, Promise<PlaceHit[]>>();
  let day = tbilisiDay(now());
  let used = 0;
  let capLogged = false;

  const call = async (query: string, limit: number): Promise<PlaceHit[]> => {
    try {
      const res = await doFetch(URL_SEARCH, {
        method: 'POST',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': opts.key, 'X-Goog-FieldMask': FIELD_MASK },
        body: JSON.stringify({
          textQuery: query,
          languageCode: 'en',
          regionCode: 'GE',
          locationRestriction: { rectangle: { low: { latitude: 41.55, longitude: 44.6 }, high: { latitude: 41.9, longitude: 45.1 } } },
          maxResultCount: limit,
        }),
      });
      if (!res.ok) {
        log(`[google-places] HTTP ${res.status}`);
        return [];
      }
      const data = (await res.json()) as { places?: GooglePlace[] };
      return (data.places ?? []).flatMap((p) => toHit(p) ?? []);
    } catch {
      return [];
    }
  };

  return async (query, limit = 5) => {
    const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
    if (q.length < MIN_QUERY) return [];
    const key = `${q}|${limit}`;
    const cached = cache.get(key);
    if (cached && now() - cached.at < TTL_MS) return cached.hits;
    const running = inflight.get(key);
    if (running) return running;

    const today = tbilisiDay(now());
    if (today !== day) {
      day = today;
      used = 0;
      capLogged = false;
    }
    if (used >= opts.dailyCap) {
      if (!capLogged) {
        capLogged = true;
        log(`[google-places] daily cap of ${opts.dailyCap} calls reached, Google search paused until tomorrow (Tbilisi time)`);
      }
      return [];
    }
    used++;
    const p = call(query.trim(), limit)
      .then((hits) => {
        // Cache answers only; an empty list from a failure must not stick for a day.
        if (hits.length) {
          if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
          cache.set(key, { at: now(), hits });
        }
        return hits;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };
}

/** The shared instance, or null when no key is configured (feature off). */
export const googleSearch = config.google.placesKey
  ? createGoogleSearch({ key: config.google.placesKey, dailyCap: config.google.dailyCap })
  : null;

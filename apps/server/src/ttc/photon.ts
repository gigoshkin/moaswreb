import type { PlaceHit } from '@transit/shared';

/**
 * Street and house-number search (Photon, OpenStreetMap data), used next to
 * TTC's geocoder, which finds landmarks but not "7 Archil Mefe". Only the
 * query text is sent. Failures return nothing: TTC results still show.
 */

const BASE = 'https://photon.komoot.io';
const TIMEOUT_MS = 4_000;
// Tbilisi: minLon,minLat,maxLon,maxLat. Bias point: the city centre.
const BBOX = '44.6,41.55,45.1,41.9';

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, unknown>;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

const fetchJson = async (path: string): Promise<{ features?: PhotonFeature[] } | null> => {
  try {
    const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'user-agent': 'tbilisi-transit-hackathon/0.1 (Hacktoberfest Georgia 2026)' } });
    return res.ok ? ((await res.json()) as { features?: PhotonFeature[] }) : null;
  } catch {
    return null;
  }
};

const toHit = (f: PhotonFeature): PlaceHit | null => {
  const c = f.geometry?.coordinates;
  if (!c) return null;
  const p = f.properties ?? {};
  const street = str(p.street);
  const number = str(p.housenumber);
  const name = str(p.name);
  // A house is "Street 7"; a street or landmark keeps its own name.
  const title = name ?? (street ? [street, number].filter(Boolean).join(' ') : null);
  if (!title) return null;
  const address = name && street ? [street, number].filter(Boolean).join(' ') : (str(p.district) ?? str(p.locality) ?? str(p.city));
  return { name: title, address, lat: c[1], lon: c[0], kind: str(p.osm_value) };
};

const cache = new Map<string, { at: number; hits: PlaceHit[] }>();
const TTL_MS = 10 * 60_000;

const remember = (key: string, hits: PlaceHit[]) => {
  if (cache.size >= 500) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: Date.now(), hits });
};

export async function photonSearch(query: string, limit = 5): Promise<PlaceHit[]> {
  const key = `s|${query.toLowerCase()}|${limit}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.hits;
  const data = await fetchJson(`/api/?${new URLSearchParams({ q: query, limit: String(limit), lang: 'en', bbox: BBOX, lat: '41.7151', lon: '44.793' })}`);
  const hits = (data?.features ?? []).flatMap((f) => toHit(f) ?? []);
  if (data) remember(key, hits);
  return hits;
}

/** The address at a point: a house or street within 150 m, else the nearest named thing within 600 m. Null when OSM has nothing. */
export async function photonReverse(lat: number, lon: number): Promise<PlaceHit | null> {
  const key = `r|${lat.toFixed(4)}|${lon.toFixed(4)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.hits[0] ?? null;
  let answered = false;
  let found: PlaceHit | null = null;
  for (const radius of ['0.15', '0.6']) {
    const data = await fetchJson(`/reverse?${new URLSearchParams({ lat: String(lat), lon: String(lon), lang: 'en', limit: '1', radius })}`);
    if (!data) continue;
    answered = true;
    found = data.features?.length ? toHit(data.features[0]) : null;
    if (found) break;
  }
  if (answered) remember(key, found ? [found] : []);
  return found;
}

/** The two lookups as a pair, so tests can swap in a stub and stay offline. */
export interface StreetGeo {
  search: (query: string, limit?: number) => Promise<PlaceHit[]>;
  reverse: (lat: number, lon: number) => Promise<PlaceHit | null>;
}

export const photonGeo: StreetGeo = { search: photonSearch, reverse: photonReverse };

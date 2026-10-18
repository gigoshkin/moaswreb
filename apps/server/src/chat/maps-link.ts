/**
 * Google Maps links -> places. Pure parsing plus a locked-down redirect
 * follower for short links (maps.app.goo.gl). Everything in a link is data.
 */

export interface MapsPlace {
  label: string;
  lat: number | null;
  lng: number | null;
}

export interface MapsLink {
  kind: 'dir' | 'place' | 'point';
  places: MapsPlace[];
}

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 3000;

const hostAllowed = (u: URL): boolean => {
  const h = u.hostname.toLowerCase();
  if (h === 'maps.app.goo.gl' || h === 'goo.gl' || h === 'maps.google.com') return true;
  return (h === 'google.com' || h === 'www.google.com') && (u.pathname === '/maps' || u.pathname.startsWith('/maps/'));
};

/** https only, default port, no credentials, host on the allowlist (never an IP literal). */
export const isAllowedMapsUrl = (raw: string): URL | null => {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.port || u.username || u.password) return null;
  return hostAllowed(u) ? u : null;
};

const isShort = (u: URL) => u.hostname === 'maps.app.goo.gl' || u.hostname === 'goo.gl';

const URL_RE = /https:\/\/(?:maps\.app\.goo\.gl|goo\.gl|maps\.google\.com|(?:www\.)?google\.com\/maps)[^\s<>"')\]]*/gi;
const COORD_RE = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;
const COORD_IN_TEXT = /(?<![\d.])(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})(?![\d.])/g;

/** Maps URLs (trailing punctuation trimmed) and bare "lat,lng" pairs found in a user message. */
export function detectMapsInput(text: string): { urls: string[]; points: MapsPlace[] } {
  const urls = [...text.matchAll(URL_RE)].map((m) => m[0].replace(/[.,;!?]+$/, ''));
  const rest = text.replace(URL_RE, ' ');
  const points = [...rest.matchAll(COORD_IN_TEXT)]
    .map((m) => ({ label: `${m[1]},${m[2]}`, lat: Number(m[1]), lng: Number(m[2]) }))
    .filter((p) => validLatLng(p.lat, p.lng));
  return { urls: [...new Set(urls)], points };
}

const validLatLng = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

const safeDecode = (s: string): string => {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s.replace(/\+/g, ' ');
  }
};

const asCoord = (s: string): MapsPlace | null => {
  const m = COORD_RE.exec(s);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return validLatLng(lat, lng) ? { label: `${m[1]},${m[2]}`, lat, lng } : null;
};

/** A text-or-coordinates value (path segment or query param) as a place. */
const toPlace = (value: string): MapsPlace | null => {
  const v = safeDecode(value).trim().slice(0, 200);
  if (!v) return null;
  return asCoord(v) ?? { label: v, lat: null, lng: null };
};

const at = (path: string): { lat: number; lng: number } | null => {
  const m = /@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/.exec(path);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return validLatLng(lat, lng) ? { lat, lng } : null;
};

/** All !3d<lat>!4d<lng> pairs of a data= blob, in order (the precise pin positions). */
const dataPins = (s: string): { lat: number; lng: number }[] =>
  [...s.matchAll(/!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/g)]
    .map((m) => ({ lat: Number(m[1]), lng: Number(m[2]) }))
    .filter((p) => validLatLng(p.lat, p.lng));

/** Parse an already-resolved (long) Google Maps URL. Returns null when no place can be read. */
export function parseMapsUrl(raw: string): MapsLink | null {
  const u = isAllowedMapsUrl(raw);
  if (!u) return null;
  const segs = u.pathname.split('/').filter(Boolean); // ['maps', 'dir', 'A', 'B', '@41.7,44.8,14z', 'data=...']
  const q = u.searchParams;
  const rawAll = raw;
  const kindIdx = segs.findIndex((s, i) => i > 0 && (s === 'dir' || s === 'place' || s === 'search'));
  const kind = kindIdx >= 0 ? segs[kindIdx] : undefined;
  const after = kindIdx >= 0 ? segs.slice(kindIdx + 1) : segs.slice(1);
  const words = after.filter((s) => !s.startsWith('@') && !s.startsWith('data='));

  if (kind === 'dir' || q.has('destination') || q.has('daddr')) {
    const named = kind === 'dir' ? words : [];
    const origin = q.get('origin') ?? q.get('saddr') ?? named[0];
    const dest = q.get('destination') ?? q.get('daddr') ?? (kind === 'dir' ? named[1] : undefined);
    const pins = dataPins(rawAll);
    const places = [origin, dest].map((v) => (v ? toPlace(v) : null));
    // Names without coordinates: fill from the two pins, but only when both ends are named and there are exactly two.
    if (pins.length === 2 && places.every((p) => p && p.lat === null)) {
      places.forEach((p, i) => {
        p!.lat = pins[i]!.lat;
        p!.lng = pins[i]!.lng;
      });
    }
    const found = places.filter((p): p is MapsPlace => !!p);
    if (found.length) return { kind: 'dir', places: found };
  }

  const qPin = ['q', 'query', 'll'].map((k) => asCoord(q.get(k) ?? '')).find(Boolean) ?? null;
  const pin = dataPins(rawAll)[0] ?? (qPin ? { lat: qPin.lat!, lng: qPin.lng! } : null) ?? at(u.pathname) ?? null;
  if (kind === 'place' && words[0]) {
    const label = safeDecode(words[0]).slice(0, 200);
    const asC = asCoord(label);
    if (asC) return { kind: 'place', places: [asC] };
    return { kind: 'place', places: [{ label, lat: pin?.lat ?? null, lng: pin?.lng ?? null }] };
  }

  for (const key of ['q', 'query', 'll', 'center', 'destination']) {
    const v = q.get(key);
    if (!v) continue;
    const p = toPlace(v);
    if (p) {
      if (p.lat === null && pin) {
        p.lat = pin.lat;
        p.lng = pin.lng;
      }
      return { kind: 'point', places: [p] };
    }
  }
  if (kind === 'search' && words[0]) {
    const p = toPlace(words[0]);
    if (p) {
      if (p.lat === null && pin) Object.assign(p, pin);
      return { kind: 'point', places: [p] };
    }
  }
  // /maps/@lat,lng,zoom or a data pin only
  if (pin) return { kind: 'point', places: [{ label: `${pin.lat},${pin.lng}`, lat: pin.lat, lng: pin.lng }] };
  return null;
}

/**
 * Follow redirects of a short link. Every hop must be https on the allowlist,
 * at most 3 hops, 3 s in total, bodies never read. Returns the final long URL.
 */
export async function resolveMapsUrl(raw: string, fetchFn: typeof fetch = fetch): Promise<string | null> {
  let u = isAllowedMapsUrl(raw);
  if (!u) return null;
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!isShort(u)) return u.toString();
      const res = await fetchFn(u.toString(), { method: 'GET', redirect: 'manual', signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; MoaswrebBot)' } });
      void res.body?.cancel().catch(() => {});
      const loc = res.headers.get('location');
      if (res.status < 300 || res.status >= 400 || !loc) return null;
      const next = isAllowedMapsUrl(new URL(loc, u).toString());
      if (!next) return null;
      u = next;
    }
    return isShort(u) ? null : u.toString();
  } catch {
    return null;
  }
}

/** Resolve (if short) and parse one URL. */
export async function mapsLinkToPlaces(raw: string, fetchFn?: typeof fetch): Promise<MapsLink | null> {
  const long = await resolveMapsUrl(raw, fetchFn);
  return long ? parseMapsUrl(long) : null;
}

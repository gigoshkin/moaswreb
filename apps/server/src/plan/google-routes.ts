import type { JourneyStep, LatLon } from '@transit/shared';
import { config } from '../config.ts';
import type { Source } from '../journey/source.ts';

/**
 * Google Routes (transit) as a second opinion on WHICH lines to ride. TTC's
 * planner answers with at most 3 itineraries and often misses a faster chain;
 * Google sees more chains but its times are not TTC's. So only the structure is
 * taken from Google: each candidate becomes JourneySteps on TTC stops, and the
 * journey engine times it from TTC timetables and live data.
 *
 * Cost protection mirrors google-places.ts: answers cached 5 min per
 * (from, to, arrive-by rounded to 5 min), a daily cap on real calls (Tbilisi
 * day), identical in-flight requests share one call. Any failure gives null and
 * the planner carries on with TTC alone. The key never leaves the header.
 */

const URL_ROUTES = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const TIMEOUT_MS = 3_000;
const TTL_MS = 5 * 60_000;
const ROUND_MS = 5 * 60_000;
const MAX_ENTRIES = 500;
const FIELD_MASK = [
  'routes.duration',
  'routes.legs.steps.travelMode',
  'routes.legs.steps.transitDetails',
  'routes.legs.steps.startLocation',
  'routes.legs.steps.endLocation',
  'routes.legs.steps.staticDuration',
].join(',');

/** One ride of a Google candidate: the line and where Google boards and leaves it. */
export interface GoogleRide {
  line: string;
  /** TTC mode: BUS, SUBWAY, GONDOLA. */
  mode: string;
  board: LatLon;
  alight: LatLon;
}

export interface GoogleCandidate {
  rides: GoogleRide[];
}

const MODES: Record<string, string> = {
  BUS: 'BUS',
  INTERCITY_BUS: 'BUS',
  TROLLEYBUS: 'BUS',
  SHARE_TAXI: 'BUS',
  SUBWAY: 'SUBWAY',
  METRO_RAIL: 'SUBWAY',
  GONDOLA_LIFT: 'GONDOLA',
  CABLE_CAR: 'GONDOLA',
  FUNICULAR: 'GONDOLA',
};

interface GLatLng {
  latLng?: { latitude?: number; longitude?: number };
}
interface GStep {
  travelMode?: string;
  transitDetails?: {
    stopDetails?: { departureStop?: { location?: GLatLng }; arrivalStop?: { location?: GLatLng } };
    transitLine?: { nameShort?: string; name?: string; vehicle?: { type?: string } };
  };
}
interface GResponse {
  routes?: Array<{ legs?: Array<{ steps?: GStep[] }> }>;
}

const point = (l: GLatLng | undefined): LatLon | null => {
  const lat = l?.latLng?.latitude;
  const lon = l?.latLng?.longitude;
  return typeof lat === 'number' && typeof lon === 'number' ? { lat, lon } : null;
};

/** The line chain of a candidate, e.g. "BUS:539>SUBWAY:2". */
export const candidateChain = (c: GoogleCandidate): string => c.rides.map((r) => `${r.mode}:${r.line}`).join('>');

/**
 * Google's answer as ride lists, one per distinct line chain (Google repeats
 * the same chain at other times). A route with a ride we can't name or map to a
 * TTC mode is dropped, as is a walking-only one.
 */
export const parseGoogleRoutes = (data: unknown): GoogleCandidate[] => {
  const out: GoogleCandidate[] = [];
  const seen = new Set<string>();
  for (const route of (data as GResponse | null)?.routes ?? []) {
    const rides: GoogleRide[] = [];
    let ok = true;
    for (const step of (route.legs ?? []).flatMap((l) => l.steps ?? [])) {
      if (step.travelMode !== 'TRANSIT') continue;
      const td = step.transitDetails;
      const line = (td?.transitLine?.nameShort ?? '').trim();
      const mode = MODES[td?.transitLine?.vehicle?.type ?? ''];
      const board = point(td?.stopDetails?.departureStop?.location);
      const alight = point(td?.stopDetails?.arrivalStop?.location);
      if (!line || !mode || !board || !alight) {
        ok = false;
        break;
      }
      rides.push({ line, mode, board, alight });
    }
    if (!ok || !rides.length) continue;
    const c = { rides };
    const k = candidateChain(c);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
};

/** Stops this close to Google's boarding / alighting point are tried. */
export const RESOLVE_RADIUS_M = 120;
const RESOLVE_LIMIT = 6;

/**
 * A candidate as JourneySteps on TTC stops: for each ride, the TTC stops within
 * RESOLVE_RADIUS_M of Google's boarding and alighting points between which the
 * same line (same mode, same short name) actually rides. Null when any ride
 * has no such pair.
 */
export const resolveCandidate = async (c: GoogleCandidate, src: Pick<Source, 'stopsNear' | 'patternsAt'>): Promise<JourneyStep[] | null> => {
  const steps: JourneyStep[] = [];
  for (const r of c.rides) {
    const [near, far] = await Promise.all([src.stopsNear(r.board, RESOLVE_RADIUS_M, RESOLVE_LIMIT), src.stopsNear(r.alight, RESOLVE_RADIUS_M, RESOLVE_LIMIT)]);
    const farIds = new Set(far.map((s) => s.id));
    const fromStops = new Set<string>();
    const toStops = new Set<string>();
    for (const f of near) {
      for (const p of await src.patternsAt(f.id)) {
        if (p.shortName !== r.line || p.mode !== r.mode) continue;
        const b = p.stops.findIndex((s) => s.id === f.id);
        if (b < 0) continue;
        for (const s of p.stops.slice(b + 1)) {
          if (!farIds.has(s.id)) continue;
          fromStops.add(f.id);
          toStops.add(s.id);
        }
      }
    }
    if (!fromStops.size) return null;
    steps.push({ fromStops: [...fromStops], toStops: [...toStops], routes: [r.line] });
  }
  return steps;
};

/** Tbilisi calendar day (UTC+4, no DST) as YYYY-MM-DD. */
const tbilisiDay = (now: number): string => new Date(now + 4 * 3_600_000).toISOString().slice(0, 10);

export interface GoogleRoutesOptions {
  key: string;
  dailyCap: number;
  fetch?: typeof fetch;
  now?: () => number;
  log?: (msg: string) => void;
  timeoutMs?: number;
}

/** Candidates for arriving at `to` by `arriveBy` (UTC ms); null when Google could not answer (off, capped, failed). */
export type GoogleRoutes = (from: LatLon, to: LatLon, arriveBy: number) => Promise<GoogleCandidate[] | null>;

export function createGoogleRoutes(opts: GoogleRoutesOptions): GoogleRoutes {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((m: string) => console.warn(m));
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const cache = new Map<string, { at: number; value: GoogleCandidate[] }>();
  const inflight = new Map<string, Promise<GoogleCandidate[] | null>>();
  let day = tbilisiDay(now());
  let used = 0;
  let capLogged = false;

  const call = async (from: LatLon, to: LatLon, at: number): Promise<GoogleCandidate[] | null> => {
    try {
      const latLng = (p: LatLon) => ({ location: { latLng: { latitude: p.lat, longitude: p.lon } } });
      const res = await doFetch(URL_ROUTES, {
        method: 'POST',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': opts.key, 'X-Goog-FieldMask': FIELD_MASK },
        body: JSON.stringify({
          origin: latLng(from),
          destination: latLng(to),
          travelMode: 'TRANSIT',
          arrivalTime: new Date(at).toISOString(),
          computeAlternativeRoutes: true,
          languageCode: 'en',
        }),
      });
      if (!res.ok) {
        log(`[google-routes] HTTP ${res.status}`);
        return null;
      }
      return parseGoogleRoutes(await res.json());
    } catch {
      return null;
    }
  };

  return async (from, to, arriveBy) => {
    if (!Number.isFinite(arriveBy)) return null;
    const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
    const a = { lat: r4(from.lat), lon: r4(from.lon) };
    const b = { lat: r4(to.lat), lon: r4(to.lon) };
    const at = Math.round(arriveBy / ROUND_MS) * ROUND_MS;
    const key = `${a.lat},${a.lon}|${b.lat},${b.lon}|${at}`;
    const cached = cache.get(key);
    if (cached && now() - cached.at < TTL_MS) return cached.value;
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
        log(`[google-routes] daily cap of ${opts.dailyCap} calls reached, Google routes paused until tomorrow (Tbilisi time)`);
      }
      return null;
    }
    used++;
    const p = call(a, b, at)
      .then((value) => {
        // Only answers are kept; a failure is retried on the next request.
        if (value) {
          if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
          cache.set(key, { at: now(), value });
        }
        return value;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };
}

/** The shared instance, or null when no key is configured (feature off). */
export const googleRoutes: GoogleRoutes | null = config.google.routesKey
  ? createGoogleRoutes({ key: config.google.routesKey, dailyCap: config.google.routesDailyCap })
  : null;

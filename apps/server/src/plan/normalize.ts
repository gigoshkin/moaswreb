import { TBILISI_UTC_OFFSET_MIN, type Itinerary, type PlanLeg, type PlanPlace, type PlanRoute } from '@transit/shared';
import type { RawItinerary, RawPlan, RawPlanLeg, RawPlanPlace } from '../ttc/types.ts';

/** Epoch ms or ISO string → ISO string (UTC). */
const iso = (t: number | string): string => new Date(t).toISOString();

/** `HH:mm` in Tbilisi for a UTC ISO string. */
const tbilisiHm = (isoUtc: string): string => new Date(Date.parse(isoUtc) + TBILISI_UTC_OFFSET_MIN * 60_000).toISOString().slice(11, 16);

const hexColor = (c: string | undefined | null): string | null => {
  if (!c) return null;
  const v = c.replace(/^#/, '');
  return /^[0-9a-f]{6}$/i.test(v) ? `#${v.toUpperCase()}` : null;
};

const place = (p: RawPlanPlace): PlanPlace => ({
  name: p.name ?? '',
  lat: p.lat,
  lon: p.lon,
  stopId: p.stopId ?? p.stop?.id ?? null,
});

const route = (leg: RawPlanLeg): PlanRoute | null => {
  if (leg.mode === 'WALK') return null;
  const r = typeof leg.route === 'object' && leg.route !== null ? leg.route : null;
  const shortName = r?.shortName ?? leg.routeShortName ?? (typeof leg.route === 'string' ? leg.route : '');
  if (!shortName) return null;
  return {
    shortName,
    longName: r?.longName ?? leg.routeLongName ?? null,
    color: hexColor(r?.color ?? leg.routeColor),
  };
};

const polyline = (leg: RawPlanLeg): string | null => {
  const p = leg.legPolyline;
  if (typeof p === 'string') return p;
  return p?.encodedValue ?? p?.points ?? leg.legGeometry?.points ?? null;
};

const normalizeLeg = (leg: RawPlanLeg): PlanLeg => ({
  mode: leg.mode,
  from: place(leg.from),
  to: place(leg.to),
  departAt: iso(leg.startTime),
  arriveAt: iso(leg.endTime),
  durationSec: Math.round(leg.duration),
  distanceM: Math.round(leg.distance ?? 0),
  route: route(leg),
  headsign: leg.headsign ?? null,
  realtime: leg.realTime === true,
  intermediateStops: leg.intermediateStops?.length ?? 0,
  polyline: polyline(leg),
});

const normalizeItinerary = (it: RawItinerary): Itinerary => {
  const legs = it.legs.map(normalizeLeg);
  const transit = legs.filter((l) => l.mode !== 'WALK');
  const walking = legs.filter((l) => l.mode === 'WALK');
  const departAt = iso(it.startTime);
  return {
    // Readable and stable: Tbilisi departure time + routes, e.g. "08:15-306-347".
    id: [tbilisiHm(departAt), ...transit.map((l) => l.route?.shortName ?? l.mode)].join('-'),
    departAt,
    arriveAt: iso(it.endTime),
    durationSec: Math.round(it.duration),
    walkSec: Math.round(it.walkTime ?? walking.reduce((s, l) => s + l.durationSec, 0)),
    walkM: Math.round(it.walkDistance ?? walking.reduce((s, l) => s + l.distanceM, 0)),
    transfers: it.transfers ?? Math.max(0, transit.length - 1),
    legs,
  };
};

/**
 * TTC `v2/plan` → our itineraries, earliest arrival first. Leg `arrivalDelay`
 * is dropped on purpose: it was off by up to ±1 h in testing.
 */
export const normalizePlan = (raw: RawPlan): Itinerary[] =>
  (raw.itineraries ?? raw.plan?.itineraries ?? [])
    .map(normalizeItinerary)
    .sort((a, b) => a.arriveAt.localeCompare(b.arriveAt));

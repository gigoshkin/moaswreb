import { leaveAtMs, tbilisiLocalToIso, type Itinerary, type PlanLeg } from '@transit/shared';

// Plan maths shared by the screens. The server's AlertWatcher uses the same
// rule (leaveAtMs), so a push and the Today screen agree on the leave time.

export const transitLegs = (it: Itinerary): PlanLeg[] => it.legs.filter((l) => l.mode !== 'WALK');

export const isMetro = (leg: PlanLeg) => leg.mode === 'SUBWAY';

/** What the plate colour says: metro red, minibus blue, bus green. */
export type Kind = 'bus' | 'minibus' | 'metro';
export const kindOf = (leg: PlanLeg): Kind => (leg.mode === 'SUBWAY' ? 'metro' : leg.route?.minibus ? 'minibus' : 'bus');

/** Walk from the start to the first stop, whole minutes. */
export const firstWalkMin = (it: Itinerary): number => {
  const i = it.legs.findIndex((l) => l.mode !== 'WALK');
  const walk = (i < 0 ? it.legs : it.legs.slice(0, i)).reduce((s, l) => s + l.durationSec, 0);
  return Math.round(walk / 60);
};

/** Walk from the last stop to the destination, whole minutes. */
export const lastWalkMin = (it: Itinerary): number => {
  let sec = 0;
  for (let i = it.legs.length - 1; i >= 0 && it.legs[i].mode === 'WALK'; i--) sec += it.legs[i].durationSec;
  return Math.round(sec / 60);
};

/**
 * When to leave the start point: the first bus's departure minus the walk,
 * the user's buffer and the early-bus margin. Walking-only trips: departure.
 */
export const leaveAt = (it: Itinerary, bufferMin = 0): number => {
  const first = transitLegs(it)[0];
  if (!first) return Date.parse(it.departAt) - bufferMin * 60_000;
  return leaveAtMs(Date.parse(first.departAt), firstWalkMin(it) + bufferMin);
};

export type Choice =
  /** An option that still arrives on time. */
  | { kind: 'onTime'; it: Itinerary; leaveAt: number }
  /** Nothing on time is left; the soonest arrival you can still catch. */
  | { kind: 'late'; it: Itinerary; leaveAt: number; lateMin: number }
  | { kind: 'none' };

/** A leave time this far in the past still counts: you may be at the door. */
const GRACE_MS = 60_000;

/**
 * The option to show: the latest one you can still catch that arrives by
 * `arriveByIso`, as the server's watcher does. Falls back to the soonest
 * arrival when you can't make it on time any more.
 */
export function choose(its: Itinerary[], arriveByLocal: string, now: number, bufferMin = 0): Choice {
  const deadline = Date.parse(tbilisiLocalToIso(arriveByLocal) ?? '') || Infinity;
  const catchable = its.map((it) => ({ it, leaveAt: leaveAt(it, bufferMin) })).filter((c) => c.leaveAt >= now - GRACE_MS);
  const onTime = catchable.filter((c) => Date.parse(c.it.arriveAt) <= deadline).sort((a, b) => b.leaveAt - a.leaveAt || Date.parse(a.it.arriveAt) - Date.parse(b.it.arriveAt))[0];
  if (onTime) return { kind: 'onTime', ...onTime };
  const soonest = catchable.sort((a, b) => Date.parse(a.it.arriveAt) - Date.parse(b.it.arriveAt))[0];
  if (!soonest) return { kind: 'none' };
  return { kind: 'late', ...soonest, lateMin: Math.max(1, Math.ceil((Date.parse(soonest.it.arriveAt) - deadline) / 60_000)) };
}

/** Whole minutes until `t`, rounded up so "Leave in 1 min" shows until the minute is over. */
export const minutesUntil = (t: number, now: number) => Math.ceil((t - now) / 60_000);

/** Route numbers of an itinerary, e.g. "306 347" — used to notice that the plan changed. */
export const routeKey = (it: Itinerary) =>
  transitLegs(it)
    .map((l) => l.route?.shortName ?? l.mode)
    .join(' ');

/** "2h 6m", "45 min". */
export const durationText = (ms: number): string => {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
};

/** A plan place that is just the query point has a generic name from TTC. */
export const placeName = (name: string | undefined, fallback: string) =>
  !name || /^(origin|destination|start|end)$/i.test(name.trim()) ? fallback : name;

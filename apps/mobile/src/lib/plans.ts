import { transitLegs, type Choice, type Itinerary, type PlanLeg } from '@transit/shared';

// The plan maths that decides routes (transitLegs, kindOf, leaveAt, choose and
// the merge of several kept ways) is in packages/shared/src/ways.ts, shared with
// the server (its AlertWatcher uses the same leaveAtMs rule, so a push and the
// Today screen agree on the leave time). Re-exported here for the app's imports.
export { choose, firstWalkMin, kindOf, leaveAt, mergeItineraries, mergePlans, transitLegs, wireSteps } from '@transit/shared';
export type { Choice, Kind } from '@transit/shared';

export const isMetro = (leg: PlanLeg) => leg.mode === 'SUBWAY';

/** Walk from the last stop to the destination, whole minutes. */
export const lastWalkMin = (it: Itinerary): number => {
  let sec = 0;
  for (let i = it.legs.length - 1; i >= 0 && it.legs[i].mode === 'WALK'; i--) sec += it.legs[i].durationSec;
  return Math.round(sec / 60);
};

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

// --- Another way, only when every kept way missed ---

/** A way outside the kept ones, offered because every kept way misses the arrive-by time. */
export interface Suggestion {
  it: Itinerary;
  leaveAt: number;
  /** True when it still arrives by the arrive-by time; false when it is late but sooner than any kept way. */
  onTime: boolean;
}

/**
 * Whether to suggest a way the trip doesn't keep. Never for a trip without
 * kept ways (the app already picks from every line), never while a kept way
 * still arrives on time. When every kept way missed (`kept` is late or none),
 * the best option among `others` (the all-lines plan, minus the kept ways'
 * own rides, `isKept`) is offered if it arrives on time, or arrives sooner
 * than the soonest kept ride.
 */
export function suggestOther(opts: {
  keepsWays: boolean;
  kept: Choice;
  /** choose() over the all-lines plan at the trip's arrive-by, without the kept ways' rides. */
  other: Choice;
}): Suggestion | null {
  const { keepsWays, kept, other } = opts;
  if (!keepsWays || kept.kind === 'onTime' || other.kind === 'none') return null;
  if (other.kind === 'onTime') return { it: other.it, leaveAt: other.leaveAt, onTime: true };
  if (kept.kind === 'none' || Date.parse(other.it.arriveAt) < Date.parse(kept.it.arriveAt)) return { it: other.it, leaveAt: other.leaveAt, onTime: false };
  return null;
}

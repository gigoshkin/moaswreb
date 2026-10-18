import type { Itinerary, PlanQuery } from '@transit/shared';
import { useMemo } from 'react';
import { choose, isMetro, leaveAt, routeKey, transitLegs, wireSteps, type Choice } from './plans';
import { settings } from './settings';
import { memory } from './store';
import { hhmm } from './time';
import { TBILISI_UTC_OFFSET_MIN, tbilisiLocalToIso } from '@transit/shared';
import { hasAvoid, type SavedTrip } from './trips';
import { usePlans } from './usePlan';
import { tripWays } from './ways';

/** The plan query for a trip on a date (`YYYY-MM-DD`). Only coordinates, so cache keys stay stable. */
export const tripQuery = (trip: Pick<SavedTrip, 'from' | 'to' | 'arriveBy' | 'avoid' | 'steps'>, date: string): PlanQuery => ({
  from: { lat: trip.from.lat, lon: trip.from.lon },
  to: { lat: trip.to.lat, lon: trip.to.lon },
  arriveBy: `${date}T${trip.arriveBy}`,
  ...(hasAvoid(trip.avoid) ? { avoid: trip.avoid } : {}),
  ...(trip.steps?.length ? { steps: wireSteps(trip.steps) } : {}),
});

/**
 * One query per kept way (the app plans each on its own and merges them), or
 * the trip's own query when it keeps none. Each is the query a single pinned
 * way always had, so cached plans stay valid.
 */
export const tripQueries = (trip: Pick<SavedTrip, 'from' | 'to' | 'arriveBy' | 'avoid' | 'steps' | 'ways'>, date: string): PlanQuery[] => {
  const ways = tripWays(trip);
  return ways.length ? ways.map((steps) => tripQuery({ ...trip, steps }, date)) : [tripQuery(trip, date)];
};

// The first option seen for each trip and day. When a later re-plan picks a
// different bus or moves the leave time by 3+ min, Today says what changed.
const firstSeen = memory<Record<string, { routes: string; leaveAt: number; label: string }>>({});

export interface TripPlan {
  choice: Choice;
  /** One line when the plan moved since it was first shown today, e.g. "Switch to 17 — leave at 08:16". */
  change: string | null;
  refreshing: boolean;
  error: string | null;
  loaded: boolean;
  itineraries: Itinerary[];
}

export const rideLabel = (it: Itinerary) => {
  const first = transitLegs(it)[0];
  if (!first) return 'Walk';
  return `${isMetro(first) ? 'Metro' : 'Bus'} ${first.route?.shortName ?? ''}`.trim();
};

export function useTripPlan(trip: SavedTrip | null, date: string, now: number, opts: { refreshMs?: number; trackChanges?: boolean } = {}): TripPlan {
  const queries = useMemo(() => (trip ? tripQueries(trip, date) : null), [trip?.from.lat, trip?.from.lon, trip?.to.lat, trip?.to.lon, trip?.arriveBy, date, JSON.stringify(trip?.avoid), JSON.stringify(trip?.steps), JSON.stringify(trip?.ways)]);
  const query = queries?.[0] ?? null;
  const main = usePlans(queries, { refreshMs: opts.refreshMs });
  const bufferMin = settings.use().bufferMin;
  const mainChoice = useMemo(() => (query && main.plan ? choose(main.plan.itineraries, query.arriveBy, now, bufferMin) : ({ kind: 'none' } as Choice)), [main.plan, query, now, bufferMin]);

  // Once the last bus that arrives in time has gone, "arrive by" plans come back empty. Ask again with a
  // later deadline (rounded to 15 min, so the query stays stable) to still show the soonest arrival, marked late.
  // Every kept way is asked again, and only those: a trip with ways never falls back to other lines.
  const lateQueries = useMemo(() => {
    if (!queries || !query || !main.plan || mainChoice.kind !== 'none') return null;
    const deadline = Date.parse(tbilisiLocalToIso(query.arriveBy) ?? '');
    // Long enough to include a ride leaving now: the trip's own duration (from the plans just received) plus a margin.
    const longest = Math.max(0, ...main.plan.itineraries.map((i) => i.durationSec)) * 1000;
    const later = Math.ceil((now + Math.max(60 * 60_000, longest + 30 * 60_000)) / (15 * 60_000)) * 15 * 60_000;
    if (!(deadline < later)) return null;
    const arriveBy = new Date(later + TBILISI_UTC_OFFSET_MIN * 60_000).toISOString().slice(0, 16);
    return queries.map((q) => ({ ...q, arriveBy }));
  }, [queries, query, main.plan, mainChoice.kind, Math.floor(now / (15 * 60_000))]);
  const retry = usePlans(lateQueries, { refreshMs: opts.refreshMs });
  const second = lateQueries && retry.plan ? { ...retry, error: null } : main;
  const secondChoice = useMemo(() => (query && second.plan ? choose(second.plan.itineraries, query.arriveBy, now, bufferMin) : ({ kind: 'none' } as Choice)), [second.plan, query, now, bufferMin]);

  // A pinned route never falls back to a different one: it may be late, but it stays the route the user picked.
  const { plan, refreshing, error } = second;
  const itineraries = plan?.itineraries ?? [];
  const choice = useMemo(() => (query ? choose(itineraries, query.arriveBy, now, bufferMin) : ({ kind: 'none' } as Choice)), [itineraries, query, now, bufferMin]);

  let change: string | null = null;
  if (opts.trackChanges && trip && choice.kind !== 'none') {
    const key = `${trip.id}|${date}`;
    const seen = firstSeen.get()[key];
    const current = { routes: routeKey(choice.it), leaveAt: leaveAt(choice.it, bufferMin), label: rideLabel(choice.it) };
    const record = () => queueMicrotask(() => firstSeen.set({ ...firstSeen.get(), [key]: current }));
    if (!seen || seen.leaveAt < now - 60_000) {
      // First look, or the option first shown has left (missed, or taken):
      // the new one is the baseline, not a change.
      if (!seen || seen.routes !== current.routes || seen.leaveAt !== current.leaveAt) record();
    } else if (seen.routes !== current.routes) {
      change = `Plan changed — take ${current.label} instead of ${seen.label.replace(/^(Bus|Metro) /, '')}`;
    } else {
      const shift = Math.round((current.leaveAt - seen.leaveAt) / 60_000);
      if (shift >= 3) change = `${current.label} is ${shift} min later — leave at ${hhmm(current.leaveAt)}`;
      else if (shift <= -3) change = `${current.label} comes ${-shift} min earlier — leave at ${hhmm(current.leaveAt)}`;
    }
  }

  return { choice, change, refreshing, error, loaded: plan !== null, itineraries };
}

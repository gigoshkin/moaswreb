import type { Itinerary, PlanQuery } from '@transit/shared';
import { useMemo } from 'react';
import { choose, isMetro, leaveAt, routeKey, transitLegs, type Choice } from './plans';
import { settings } from './settings';
import { memory } from './store';
import { hhmm } from './time';
import { TBILISI_UTC_OFFSET_MIN, tbilisiLocalToIso } from '@transit/shared';
import { hasAvoid, type SavedTrip } from './trips';
import { usePlan } from './usePlan';

/** The plan query for a trip on a date (`YYYY-MM-DD`). Only coordinates, so cache keys stay stable. */
export const tripQuery = (trip: Pick<SavedTrip, 'from' | 'to' | 'arriveBy' | 'avoid' | 'steps'>, date: string): PlanQuery => ({
  from: { lat: trip.from.lat, lon: trip.from.lon },
  to: { lat: trip.to.lat, lon: trip.to.lon },
  arriveBy: `${date}T${trip.arriveBy}`,
  ...(hasAvoid(trip.avoid) ? { avoid: trip.avoid } : {}),
  ...(trip.steps?.length ? { steps: trip.steps } : {}),
});

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
  const query = useMemo(() => (trip ? tripQuery(trip, date) : null), [trip?.from.lat, trip?.from.lon, trip?.to.lat, trip?.to.lon, trip?.arriveBy, date, JSON.stringify(trip?.avoid), JSON.stringify(trip?.steps)]);
  const main = usePlan(query, { refreshMs: opts.refreshMs });
  const bufferMin = settings.use().bufferMin;
  const mainChoice = useMemo(() => (query && main.plan ? choose(main.plan.itineraries, query.arriveBy, now, bufferMin) : ({ kind: 'none' } as Choice)), [main.plan, query, now, bufferMin]);

  // Once the last bus that arrives in time has gone, "arrive by" plans come back empty. Ask again with a
  // later deadline (rounded to 15 min, so the query stays stable) to still show the soonest arrival, marked late.
  const lateQuery = useMemo(() => {
    if (!query || !main.plan || mainChoice.kind !== 'none') return null;
    const deadline = Date.parse(tbilisiLocalToIso(query.arriveBy) ?? '');
    const later = Math.ceil((now + 60 * 60_000) / (15 * 60_000)) * 15 * 60_000;
    if (!(deadline < later)) return null;
    return { ...query, arriveBy: new Date(later + TBILISI_UTC_OFFSET_MIN * 60_000).toISOString().slice(0, 16) };
  }, [query, main.plan, mainChoice.kind, Math.floor(now / (15 * 60_000))]);
  const retry = usePlan(lateQuery, { refreshMs: opts.refreshMs });
  const second = lateQuery && retry.plan ? { ...retry, error: null } : main;
  const secondChoice = useMemo(() => (query && second.plan ? choose(second.plan.itineraries, query.arriveBy, now, bufferMin) : ({ kind: 'none' } as Choice)), [second.plan, query, now, bufferMin]);

  // A pinned route (hand-built, or the one picked in chat) that gives nothing, not even a late one, must not end in "No route
  // found": plan the trip without the pinned rides, so the fastest way still shows (marked late when it is).
  const looseQuery = useMemo(() => {
    if (!query?.steps?.length || !second.plan || secondChoice.kind !== 'none') return null;
    const { steps: _pinned, ...loose } = lateQuery ?? query;
    return loose as PlanQuery;
  }, [query, lateQuery, second.plan, secondChoice.kind]);
  const loose = usePlan(looseQuery, { refreshMs: opts.refreshMs });

  const { plan, refreshing, error } = looseQuery && loose.plan ? { ...loose, error: null } : second;
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

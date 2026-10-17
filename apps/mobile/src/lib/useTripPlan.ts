import type { Itinerary, PlanQuery } from '@transit/shared';
import { useMemo } from 'react';
import { choose, isMetro, leaveAt, routeKey, transitLegs, type Choice } from './plans';
import { settings } from './settings';
import { memory } from './store';
import { hhmm } from './time';
import type { SavedTrip } from './trips';
import { usePlan } from './usePlan';

/** The plan query for a trip on a date (`YYYY-MM-DD`). Only coordinates, so cache keys stay stable. */
export const tripQuery = (trip: Pick<SavedTrip, 'from' | 'to' | 'arriveBy'>, date: string): PlanQuery => ({
  from: { lat: trip.from.lat, lon: trip.from.lon },
  to: { lat: trip.to.lat, lon: trip.to.lon },
  arriveBy: `${date}T${trip.arriveBy}`,
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
  const query = useMemo(() => (trip ? tripQuery(trip, date) : null), [trip?.from.lat, trip?.from.lon, trip?.to.lat, trip?.to.lon, trip?.arriveBy, date]);
  const { plan, refreshing, error } = usePlan(query, { refreshMs: opts.refreshMs });
  const bufferMin = settings.use().bufferMin;
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

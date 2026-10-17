import type { JourneyStep, LatLon, PlanAvoid, StoredTrip } from '@transit/shared';
import { fetchPlan, hasApi, syncTrips } from './api';
import { choose, firstWalkMin, transitLegs } from './plans';
import { settings } from './settings';
import { persisted } from './store';
import { nextArriveBy } from './time';

export interface Place extends LatLon {
  label: string;
}

/** A trip the user repeats, e.g. home → work, arrive by 09:00. Stored on the phone only. */
export interface SavedTrip {
  id: string;
  name: string;
  from: Place;
  to: Place;
  /** Tbilisi wall clock, `HH:mm`. */
  arriveBy: string;
  /** Filled from the plan when the trip is saved. Only trips with both sync to the server. */
  fromStopId?: string;
  toStopId?: string;
  /** ISO weekdays, 1 = Monday. Defaults to Mon–Fri (DEFAULT_DAYS). */
  days?: number[];
  /** Walk from `from` to the first stop, worked out on the phone. */
  walkMin?: number;
  /** Lines this trip never uses ("not 518", "no microbuses"). Only this trip. */
  avoid?: PlanAvoid;
  /** A hand-built route: the rides in order. Without it the planner looks at every line that fits. */
  steps?: JourneyStep[];
}

/** True when the avoid list excludes anything. */
export const hasAvoid = (a?: PlanAvoid): a is PlanAvoid => Boolean(a?.routes?.length || a?.minibus);

export const DEFAULT_DAYS = [1, 2, 3, 4, 5];

export const tripsStore = persisted<SavedTrip[]>('trips:v1', []);

export const listTrips = (): SavedTrip[] => tripsStore.get();

export const useTrips = (): SavedTrip[] => tripsStore.use();

export const getTrip = (id: string): SavedTrip | undefined => listTrips().find((t) => t.id === id);

export const tripDays = (t: SavedTrip) => (t.days?.length ? t.days : DEFAULT_DAYS);

/**
 * What the server gets for alerts: stops and times only. The trip name and the
 * start/end addresses stay on the phone. The buffer is added to the walk, so
 * the server's leave time is the one the phone shows. Alerts off: nothing.
 */
export const toStored = (trips: SavedTrip[]): StoredTrip[] => {
  const { alerts, bufferMin } = settings.get();
  if (!alerts) return [];
  return trips.flatMap((t) =>
    t.fromStopId && t.toStopId
      ? [{ id: t.id, fromStopId: t.fromStopId, toStopId: t.toStopId, arriveBy: t.arriveBy, days: tripDays(t), walkMin: Math.round((t.walkMin ?? 0) + bufferMin), ...(hasAvoid(t.avoid) ? { avoid: t.avoid } : {}), ...(t.steps?.length ? { steps: t.steps } : {}) }]
      : [],
  );
};

/** Push the current trips to the server so alerts follow them. Offline: setUpAlerts re-syncs on next start. */
export const syncNow = () => {
  if (hasApi) syncTrips(toStored(listTrips())).catch(() => {});
};

const write = (trips: SavedTrip[]): void => {
  tripsStore.set(trips);
  syncNow();
};

export const saveTrip = (trip: SavedTrip): void => {
  const trips = listTrips();
  const i = trips.findIndex((t) => t.id === trip.id);
  write(i < 0 ? [...trips, trip] : trips.map((t) => (t.id === trip.id ? trip : t)));
};

export const removeTrip = (id: string): void => write(listTrips().filter((t) => t.id !== id));

export const clearTrips = (): void => tripsStore.set([]);

export const newTripId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Stop ids and walk for the server, from a plan of the trip's next
 * occurrence. Without them the trip still works on the phone but gets no
 * pushes, so a failed plan doesn't block saving.
 */
export async function withStops(trip: SavedTrip): Promise<SavedTrip> {
  if (!hasApi) return trip;
  try {
    const plan = await fetchPlan({ from: trip.from, to: trip.to, arriveBy: nextArriveBy(trip.arriveBy, tripDays(trip)), ...(hasAvoid(trip.avoid) ? { avoid: trip.avoid } : {}), ...(trip.steps?.length ? { steps: trip.steps } : {}) });
    const c = choose(plan.itineraries, plan.query.arriveBy, Date.now(), 0);
    const it = c.kind === 'none' ? plan.itineraries[0] : c.it;
    const legs = it ? transitLegs(it) : [];
    if (!it || !legs.length) return trip;
    return { ...trip, fromStopId: legs[0].from.stopId ?? undefined, toStopId: legs.at(-1)!.to.stopId ?? undefined, walkMin: firstWalkMin(it) };
  } catch {
    return trip;
  }
}

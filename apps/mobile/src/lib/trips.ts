import type { LatLon } from '@transit/shared';
import type { StoredTrip } from '@transit/shared';
import { hasApi, syncTrips } from './api';
import { readCache, writeCache } from './cache';

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
  /** Set once the user picks stops (andro's add-trip flow). Only these trips sync to the server. */
  fromStopId?: string;
  toStopId?: string;
  /** ISO weekdays, 1 = Monday. Defaults to Mon–Fri (DEFAULT_DAYS). */
  days?: number[];
  /** Walk from `from` to the first stop, worked out on the phone. */
  walkMin?: number;
}

export const DEFAULT_DAYS = [1, 2, 3, 4, 5];

const KEY = 'trips:v1';

export const listTrips = (): SavedTrip[] => readCache<SavedTrip[]>(KEY) ?? [];

export const getTrip = (id: string): SavedTrip | undefined => listTrips().find((t) => t.id === id);

// Every change is pushed to the server so alerts follow it. Offline: setUpAlerts re-syncs on next start.
const write = (trips: SavedTrip[]): void => {
  writeCache(KEY, trips);
  if (hasApi) syncTrips(toStored(trips)).catch(() => {});
};

export const saveTrip = (trip: SavedTrip): void => write([...listTrips().filter((t) => t.id !== trip.id), trip]);

export const removeTrip = (id: string): void => write(listTrips().filter((t) => t.id !== id));

/**
 * What the server gets for alerts: stops and times only. The trip name and the
 * start/end addresses stay on the phone.
 */
export const toStored = (trips: SavedTrip[]): StoredTrip[] =>
  trips.flatMap((t) =>
    t.fromStopId && t.toStopId
      ? [{ id: t.id, fromStopId: t.fromStopId, toStopId: t.toStopId, arriveBy: t.arriveBy, days: t.days ?? DEFAULT_DAYS, walkMin: Math.round(t.walkMin ?? 0) }]
      : [],
  );

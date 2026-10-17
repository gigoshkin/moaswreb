import type { LatLon } from '@transit/shared';
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
}

const KEY = 'trips:v1';

// DEMO placeholder until andro's "add a trip" flow exists. Coordinates are the
// pair used for the TTC planner test on 17 Oct (knowledge-base/ttc-pis-gateway-api.md).
const DEMO: SavedTrip[] = [
  {
    id: 'demo-1',
    name: 'სახლი → უნივერსიტეტი',
    from: { label: 'სახლი', lat: 41.7151, lon: 44.8271 },
    to: { label: 'უნივერსიტეტი', lat: 41.7099, lon: 44.7929 },
    arriveBy: '09:00',
  },
];

export const listTrips = (): SavedTrip[] => readCache<SavedTrip[]>(KEY) ?? DEMO;

export const getTrip = (id: string): SavedTrip | undefined => listTrips().find((t) => t.id === id);

export const saveTrip = (trip: SavedTrip): void =>
  writeCache(KEY, [...listTrips().filter((t) => t.id !== trip.id), trip]);

export const removeTrip = (id: string): void => writeCache(KEY, listTrips().filter((t) => t.id !== id));

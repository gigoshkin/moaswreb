// REST lookups for screens (Today countdown, Add-trip pickers). The chat and
// MCP tools return the same shapes inside their cards.

import type { Arrival, StopHit } from './chat.ts';

/** TTC stop ids: "1:1405" (bus), "1:metro_1_11" (metro), "1:gondola_1" (gondola). */
export const STOP_ID_PATTERN = '^\\d+:[a-z0-9_]+$';

export interface NearStop extends StopHit {
  /** Straight-line distance from the query point. */
  distanceM: number;
}

/** GET /stops?q= */
export interface StopsResponse {
  stops: StopHit[];
}

/** GET /stops/near?lat=&lon= */
export interface NearStopsResponse {
  stops: NearStop[];
}

/** GET /stops/:id/arrivals */
export interface ArrivalsResponse {
  stop: { id: string; name: string };
  /** Soonest first. `realtime: false` means timetable only. */
  arrivals: Arrival[];
  fetchedAt: string;
}

export interface PlaceHit {
  name: string;
  /** Street (and house number) or district, when OSM has one. */
  address: string | null;
  lat: number;
  lon: number;
  /** OSM category, e.g. "university", "park", "bus_stop". */
  kind: string | null;
}

/** GET /places?q= */
export interface PlacesResponse {
  places: PlaceHit[];
}

// Normalised trip-planner types. The server maps TTC's OpenTripPlanner-shaped
// `v2/plan` response into these, so the app never sees TTC's raw format.

export interface LatLon {
  lat: number;
  lon: number;
}

export type PlanMode = 'BUS' | 'SUBWAY' | 'GONDOLA';
export type LegMode = 'WALK' | PlanMode | (string & {});
export type Optimize = 'quick' | 'lessWalking' | 'fewerTransfers';
export type Locale = 'ka' | 'en';

/** Query for GET /plan. */
export interface PlanQuery {
  from: LatLon;
  to: LatLon;
  /** Tbilisi local wall-clock time to arrive by, `YYYY-MM-DDTHH:mm`. */
  arriveBy: string;
  modes?: PlanMode[];
  optimize?: Optimize;
  locale?: Locale;
}

export interface PlanPlace extends LatLon {
  name: string;
  /** TTC stop id (e.g. "1:1405") when the place is a stop. */
  stopId: string | null;
}

export interface PlanRoute {
  shortName: string;
  longName: string | null;
  /** Line colour as `#RRGGBB`, or null if TTC didn't send one. */
  color: string | null;
}

export interface PlanLeg {
  mode: LegMode;
  from: PlanPlace;
  to: PlanPlace;
  /** ISO 8601, UTC. */
  departAt: string;
  arriveAt: string;
  durationSec: number;
  distanceM: number;
  /** Null for walking legs. */
  route: PlanRoute | null;
  headsign: string | null;
  /** True when TTC timed this leg from live vehicles, not the timetable. */
  realtime: boolean;
  /** Stops between boarding and alighting. */
  intermediateStops: number;
  /** Google encoded polyline, if TTC sent one. */
  polyline: string | null;
}

export interface Itinerary {
  /** Stable within one response; built from the transit legs and times. */
  id: string;
  departAt: string;
  arriveAt: string;
  durationSec: number;
  walkSec: number;
  walkM: number;
  transfers: number;
  legs: PlanLeg[];
}

export interface PlanResponse {
  query: PlanQuery;
  itineraries: Itinerary[];
  /** Where the itineraries came from, so the UI can attribute them. */
  source: 'ttc';
  /** ISO time TTC answered (cached responses keep the original time). */
  fetchedAt: string;
}

export interface ApiError {
  error: string;
  message: string;
}

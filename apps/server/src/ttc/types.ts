// Shapes of the TTC PIS gateway responses, as observed on 2026-10-17.
// See knowledge-base/ttc-pis-gateway-api.md.

export type VehicleMode = 'BUS' | 'SUBWAY' | 'GONDOLA' | (string & {});

export interface Stop {
  id: string;
  code: string | null;
  name: string;
  lat: number;
  lon: number;
  vehicleMode: VehicleMode;
}

export interface RouteSummary {
  id: string;
  shortName: string;
  longName: string;
  color: string;
  mode: VehicleMode;
}

export interface Pattern {
  patternSuffix: string;
  directionId: number;
  firstStop: { id: string; name: string };
  lastStop: { id: string; name: string };
  headsign: string;
}

export interface RouteDetail {
  id: string;
  shortName: string;
  color: string;
  mode: VehicleMode;
  patterns: Pattern[];
  defaultPatternSuffix: string;
}

export interface ArrivalTime {
  shortName: string;
  color: string;
  headsign: string;
  patternSuffix: string;
  vehicleMode: VehicleMode;
  realtime: boolean;
  realtimeArrivalMinutes: number;
  scheduledArrivalMinutes: number;
}

export interface VehiclePosition {
  vehicleId: string;
  lat: number;
  lon: number;
  heading: number | null;
  nextStopId: string | null;
}

/** Keyed by pattern suffix, e.g. { "0:01": [...] } */
export type RoutePositions = Record<string, VehiclePosition[]>;

// --- trip planner (v2/plan) ---
// OpenTripPlanner-shaped. Only the top-level and leg key names were confirmed
// live on 2026-10-17; the value types below follow OTP and are read
// defensively in plan/normalize.ts until a real response is saved.

export interface RawPlanPlace {
  name?: string;
  lat: number;
  lon: number;
  stopId?: string | null;
  stop?: { id?: string; code?: string } | null;
}

export interface RawPlanLeg {
  mode: string;
  from: RawPlanPlace;
  to: RawPlanPlace;
  /** OTP sends epoch ms; TTC's UI shows UTC ISO strings. Accept both. */
  startTime: number | string;
  endTime: number | string;
  duration: number;
  distance?: number;
  /** OTP: short name string. Some gateways: an object. */
  route?: string | { shortName?: string; longName?: string; color?: string } | null;
  routeShortName?: string;
  routeLongName?: string;
  routeColor?: string;
  headsign?: string;
  realTime?: boolean;
  arrivalDelay?: number;
  intermediateStops?: unknown[] | null;
  legPolyline?: string | { points?: string; encodedValue?: string } | null;
  legGeometry?: { points?: string } | null;
}

export interface RawItinerary {
  startTime: number | string;
  endTime: number | string;
  duration: number;
  walkTime?: number;
  walkDistance?: number;
  transfers?: number;
  legs: RawPlanLeg[];
}

export interface RawPlan {
  itineraries?: RawItinerary[];
  plan?: { itineraries?: RawItinerary[] };
}

// --- geocode (v2) ---
// "GeoJSON features from OSM data" per the KB; property names unverified, read defensively.
export interface RawGeocode {
  features?: Array<{
    geometry?: { coordinates?: [number, number] };
    properties?: Record<string, unknown>;
  }>;
}

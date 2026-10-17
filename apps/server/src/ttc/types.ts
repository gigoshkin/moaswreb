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

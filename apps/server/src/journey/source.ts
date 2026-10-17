import type { LatLon, NearStop, PlanAvoid, StopHit } from '@transit/shared';

// What the engine needs to know about the network. The real one reads TTC
// (ttc-source.ts); tests use a small made-up network.

export interface StopRef extends LatLon {
  id: string;
  name: string;
}

/** One direction of one line: a route and the stops it visits, in order. */
export interface PatternRef {
  routeId: string;
  shortName: string;
  longName: string | null;
  color: string | null;
  minibus: boolean;
  /** TTC mode: BUS, SUBWAY, GONDOLA. */
  mode: string;
  suffix: string;
  headsign: string | null;
  stops: StopRef[];
}

/** A pattern's timetable on one date: `times[position]` are minutes after that day's midnight, one per trip, the same trip at the same index in every stop. Hours may pass 24. */
export interface Timetable {
  times: number[][];
}

export interface Source {
  stopsNear(p: LatLon, radiusM: number, limit: number): Promise<NearStop[]>;
  stop(id: string): Promise<StopHit | null>;
  /** Every pattern that visits the stop. */
  patternsAt(stopId: string): Promise<PatternRef[]>;
  /** Null when TTC has no timetable for that date. */
  timetable(p: PatternRef, date: string): Promise<Timetable | null>;
  /** Minutes until each of the next vehicles of this pattern reaches the stop, from live data only. */
  live(stopId: string, p: PatternRef): Promise<number[]>;
  /** Walking time and distance as TTC's own router would give them. */
  walk(a: LatLon, b: LatLon): Promise<{ sec: number; m: number }>;
}

export const isAvoided = (p: Pick<PatternRef, 'shortName' | 'minibus'>, avoid?: PlanAvoid): boolean =>
  Boolean(avoid?.routes?.includes(p.shortName) || (avoid?.minibus && p.minibus));

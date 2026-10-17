import type { JourneyStep, StopHit } from '@transit/shared';
import type { LineRef } from '../ui/LineChain';

type Point = { lat: number; lon: number };

/** One ride of a hand-built trip, with what the rail and the map need to show it. */
export interface BuiltRide {
  board: StopHit;
  off: StopHit;
  /** Every line that goes from `board` to `off`. */
  lines: LineRef[];
  /** Lines the rider switched off for this ride (labels). */
  skipped: string[];
  /** Stops on the way, boarding stop first; what the map draws. */
  path: Point[];
}

/** Rides further apart than this (previous get-off to next boarding stop) are flagged as a long walk. */
export const FAR_WALK_M = 800;

const rad = Math.PI / 180;
export const distM = (a: Point, b: Point) =>
  Math.hypot((b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad), (b.lat - a.lat) * rad) * 6_371_000;

/** Walking minutes for a straight-line distance: about 1.25x for streets at 75 m a minute. */
export const walkMinutes = (m: number) => Math.max(1, Math.round((m * 1.25) / 75));

/** The planner step for a ride. A ride with some lines switched off lists only the ones left. */
export function stepOf(r: BuiltRide): JourneyStep {
  const left = r.lines.map((l) => l.label).filter((l) => !r.skipped.includes(l));
  return { fromStops: [r.board.id], toStops: [r.off.id], ...(r.skipped.length && left.length ? { routes: left } : {}) };
}

/** Put a ride at index `at` (insert), or in place of the one there (replace). The rides after it stay. */
export const place = (rides: BuiltRide[], at: number, ride: BuiltRide, replace: boolean): BuiltRide[] => {
  const next = [...rides];
  next.splice(at, replace ? 1 : 0, ride);
  return next;
};

export const removeAt = (rides: BuiltRide[], at: number): BuiltRide[] => rides.filter((_, i) => i !== at);

/** Switch one line of a ride on or off. The last line left on can't be switched off. */
export function toggleLine(r: BuiltRide, label: string): BuiltRide {
  if (r.skipped.includes(label)) return { ...r, skipped: r.skipped.filter((l) => l !== label) };
  if (r.lines.length - r.skipped.length <= 1) return r;
  return { ...r, skipped: [...r.skipped, label] };
}

/** Walk metres between ride i-1's get-off stop and ride i's boarding stop (0 for the first ride). */
export const gapBefore = (rides: BuiltRide[], i: number): number => (i > 0 ? distM(rides[i - 1].off, rides[i].board) : 0);

/** How many rides of history the Undo button keeps. */
export const UNDO_DEPTH = 20;

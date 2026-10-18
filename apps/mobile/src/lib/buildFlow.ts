import type { JourneyStep, LineRef, StopHit, StopLine } from '@transit/shared';
import { UNDO_DEPTH, distM, place, removeAt, stepOf, toggleLine, walkMinutes, type BuiltRide } from './chain';
import type { BuiltSteps } from './handoff';
import { metroChange } from './metro';
import type { Place } from './trips';

// The by-hand route builder as plain data: what the floating pin does next,
// and the rows the sheet shows. The screen only renders this and sends events.
//
// The route is: [walk Start|End] [ride stop -> stop] [walk] [ride] ...
//  - `start` is the ground point the first walk starts at (none: the route starts at the first boarding stop).
//  - `rides` are the finished rides; between two of them the walk is implied (get-off stop -> next boarding stop).
//  - `end` is the ground point the last walk ends at (none: the route ends at the last get-off stop).
//  - `board` is the boarding stop of the ride being built: only then are its lines drawn (black).

export interface Flow {
  start: Place | null;
  rides: BuiltRide[];
  end: Place | null;
  board: StopHit | null;
  /** The ride being built goes in before ride `at` (insert) or in its place (replace); null: after the last ride. */
  slot: { at: number; replace: boolean } | null;
  /** The caller gave the trip's ends: ground pins don't move them. */
  fixedStart: boolean;
  fixedEnd: boolean;
}

/**
 * What the next pin means:
 *  - first:       nothing yet. Ground -> the first walk's Start. Stop -> the first ride boards there.
 *  - walkEnd:     the first walk has a Start. Ground -> its End. Stop -> its End is that stop and a ride boards there.
 *  - awaitingOff: a ride boarded (its lines drawn). Only a stop those lines reach ends it.
 *  - floating:    after a ride (or a walk that ended on the ground). Ground -> a walk from there to the pin.
 *                 Stop -> a new ride boards there (with a walk to it when it is another stop).
 *  - insertBoard: a ride is being inserted / replaced. Only a stop is taken, as its boarding stop.
 */
export type Phase = 'first' | 'walkEnd' | 'awaitingOff' | 'floating' | 'insertBoard';

export function initFlow(from: Place | null, to: Place | null): Flow {
  return { start: from, rides: [], end: to, board: null, slot: null, fixedStart: !!from, fixedEnd: !!to };
}

export function phaseOf(f: Flow): Phase {
  if (f.board) return 'awaitingOff';
  if (f.slot) return 'insertBoard';
  if (!f.rides.length && !f.start) return 'first';
  if (!f.rides.length && !f.end) return 'walkEnd';
  return 'floating';
}

/** The pin floats (no ride waiting for its get-off stop): stop dots around it, no black lines. */
export const floating = (f: Flow) => phaseOf(f) !== 'awaitingOff';

/** Whether a pin on the ground (not on a stop) means anything now. */
export function groundOk(f: Flow): boolean {
  const p = phaseOf(f);
  if (p === 'first') return !f.fixedStart;
  if (p === 'walkEnd' || p === 'floating') return !f.fixedEnd;
  return false;
}

/** The pin is dropped on the ground (`stop` null) or on a stop / station dot. */
export function pinDropped(f: Flow, at: Place, stop: StopHit | null): Flow {
  const p = phaseOf(f);
  if (p === 'awaitingOff') return f; // a ride ends only on a stop its lines reach: rideEnded
  if (!stop) {
    if (!groundOk(f)) return f;
    if (p === 'first') return { ...f, start: at };
    return { ...f, end: at }; // walkEnd, floating: the walk ends here (a later ground pin moves the End)
  }
  // A stop: a ride boards there. A walk that ended on the ground now ends at this stop instead.
  return { ...f, board: stop, end: p === 'insertBoard' || f.fixedEnd ? f.end : null };
}

const kindOfLine = (l: StopLine): LineRef['kind'] => (l.mode === 'SUBWAY' ? 'metro' : l.minibus ? 'minibus' : 'bus');

type Point = { lat: number; lon: number };
type Stopish = Point & { id: string };

/** A bus coming back this close to its boarding stop, after being twice as far away, is on its way back (the other side of the road). */
export const LOOP_BACK_M = 250;

/**
 * The stops a bus or minibus pattern really goes on to from `board`: the stops after it,
 * up to where the pattern turns back on itself. A round-trip or loop pattern comes back
 * to the boarding stop, or past it on the other side of the road; everything from there
 * on is behind the rider, not ahead.
 */
export function onwardStops<T extends Stopish>(board: Stopish, next: T[]): T[] {
  let far = 0;
  for (let i = 0; i < next.length; i++) {
    const s = next[i];
    if (s.id === board.id) return next.slice(0, i);
    const d = distM(board, s);
    if (far >= 2 * LOOP_BACK_M && d <= LOOP_BACK_M) return next.slice(0, i);
    far = Math.max(far, d);
  }
  return next;
}

/** The stops a pattern goes on to from `board`, given the whole pattern in order; empty when it doesn't stop there. */
export function onwardOnPattern<T extends Stopish>(board: Stopish, pattern: T[]): T[] {
  const at = pattern.findIndex((s) => s.id === board.id);
  return at < 0 ? [] : onwardStops(board, pattern.slice(at + 1));
}

/** The lines at a stop with only the stops ahead of it; metro lines are left whole (both directions are there as their own patterns). */
export function onwardLines(board: StopHit, lines: StopLine[]): StopLine[] {
  return lines.map((l) => (l.mode === 'SUBWAY' ? l : { ...l, next: onwardStops(board, l.next) })).filter((l) => l.next.length > 0);
}

/** A road shape cut where it passes closest to `to`, ending exactly there. */
export function shapeTo(points: Point[], to: Point): Point[] {
  if (points.length < 2) return [...points, to];
  let best = 0;
  for (let i = 1; i < points.length; i++) if (distM(points[i], to) < distM(points[best], to)) best = i;
  return [...points.slice(0, best + 1), to];
}

/**
 * The ride from `board` to `off` on the lines that stop there, in the order they go; null when no line does.
 * `roads` (a line's road shape from `board`, by line) draws the ride along the road when it is known.
 */
export function rideBetween(board: StopHit, off: StopHit, lines: StopLine[], roads?: ReadonlyMap<string, Point[]>): BuiltRide | null {
  const used = onwardLines(board, lines).filter((l) => l.next.some((x) => x.id === off.id));
  if (!used.length || off.id === board.id) return null;
  const refs = new Map<string, LineRef>();
  for (const l of used) if (!refs.has(l.shortName)) refs.set(l.shortName, { label: l.shortName, kind: kindOfLine(l) });
  const road = used[0].mode === 'SUBWAY' ? undefined : roads?.get(used[0].shortName);
  const path = road ? shapeTo(road, off) : [board, ...used[0].next.slice(0, used[0].next.findIndex((x) => x.id === off.id) + 1)];
  return { board, off, lines: [...refs.values()], skipped: [], path };
}

/** Stops any line from the boarding stop reaches: the only places to get off. */
export function reachableFrom(board: StopHit, lines: StopLine[]): StopHit[] {
  const m = new Map<string, StopHit>();
  for (const l of onwardLines(board, lines)) for (const s of l.next) if (s.id !== board.id && !m.has(s.id)) m.set(s.id, { id: s.id, name: s.name, lat: s.lat, lon: s.lon, mode: l.mode });
  return [...m.values()];
}

/** The ride ends at `off`. The pin floats again, with no boarding stop and no lines drawn; nothing is picked for you. */
export function rideEnded(f: Flow, off: StopHit, lines: StopLine[], roads?: ReadonlyMap<string, Point[]>): Flow {
  if (!f.board) return f;
  const ride = rideBetween(f.board, off, lines, roads);
  return ride ? ridesEnded(f, [ride]) : f;
}

/**
 * The ride being built ends as one or more rides in a row (a metro trip that changes
 * lines is a ride per line), put where the ride was being built.
 */
export function ridesEnded(f: Flow, add: BuiltRide[]): Flow {
  if (!f.board || !add.length) return f;
  let rides = f.rides;
  if (f.slot) add.forEach((r, k) => (rides = place(rides, f.slot!.at + k, r, k === 0 && f.slot!.replace)));
  else rides = [...rides, ...add];
  return { ...f, rides, board: null, slot: null, end: f.slot || f.fixedEnd ? f.end : null };
}

/** A stop of the same name across the road is this close (Tevdore Mghvdeli Street's two are 9 m apart). */
export const ACROSS_M = 80;

/** The stop of the same name on the other side of the road from `board`, if one is among `stops`: its lines go the other way. */
export function twinAcross(board: StopHit, stops: StopHit[]): StopHit | null {
  if (board.mode === 'SUBWAY') return null;
  let best: { s: StopHit; d: number } | null = null;
  for (const s of stops) {
    if (s.id === board.id || s.name !== board.name || s.mode !== board.mode) continue;
    const d = distM(board, s);
    if (d <= ACROSS_M && (!best || d < best.d)) best = { s, d };
  }
  return best?.s ?? null;
}

/** The ride being built boards at another stop instead (across the road); the rest stays as it is. */
export const reboard = (f: Flow, stop: StopHit): Flow => (f.board && f.board.id !== stop.id ? { ...f, board: stop } : f);

/** Drop the ride being built (or the insert / replace): the pin floats again. */
export const cancelRide = (f: Flow): Flow => ({ ...f, board: null, slot: null });
export const insertAt = (f: Flow, at: number): Flow => ({ ...f, board: null, slot: { at, replace: false } });
export const replaceAt = (f: Flow, at: number): Flow => ({ ...f, board: null, slot: { at, replace: true } });
export const removeRide = (f: Flow, at: number): Flow => ({ ...f, rides: removeAt(f.rides, at), board: null, slot: null });
export const toggleRideLine = (f: Flow, at: number, label: string): Flow => ({ ...f, rides: f.rides.map((r, i) => (i === at ? toggleLine(r, label) : r)) });
/** A kept way opened for editing: its rides, named from the planned legs (not an undoable change). */
export const seeded = (f: Flow, rides: BuiltRide[]): Flow => ({ ...f, rides });

// ——— Undo: every change keeps the state before it. ———

export interface Builder {
  flow: Flow;
  past: Flow[];
}
export const builder = (flow: Flow): Builder => ({ flow, past: [] });
/** Apply a change; a change that changes nothing is not kept. */
export function commit(b: Builder, next: Flow): Builder {
  if (next === b.flow) return b;
  return { flow: next, past: [...b.past.slice(-(UNDO_DEPTH - 1)), b.flow] };
}
export function undo(b: Builder): Builder {
  const last = b.past.at(-1);
  return last ? { flow: last, past: b.past.slice(0, -1) } : b;
}

// ——— The sheet's rows. ———

export interface End {
  label: string;
  lat: number;
  lon: number;
  stop?: StopHit;
}
/** A walk: Start | End. `to` null while the pin is placing it; `metres`/`minutes` once both are known (0: a change on the spot). */
export interface WalkRow {
  kind: 'walk';
  from: End;
  to: End | null;
  metres: number | null;
  minutes: number | null;
  /** A ride can be inserted here (before ride `insertAt`). */
  insertAt?: number;
  /** One of the trip's ends the caller gave. */
  fixed?: 'start' | 'end';
}
export type Row =
  | WalkRow
  | { kind: 'ride'; ride: BuiltRide; index: number; replacing: boolean }
  /** The ride being built: boarded, waiting for its get-off stop. */
  | { kind: 'boarding'; board: StopHit };

const stopEnd = (s: StopHit): End => ({ label: s.name, lat: s.lat, lon: s.lon, stop: s });
const placeEnd = (p: Place): End => ({ label: p.label, lat: p.lat, lon: p.lon });
/** Walks this short (or between the same stop) are a change on the spot, not a walk. */
const SAME_SPOT_M = 30;

function walkRow(from: End, to: End | null, extra: Partial<WalkRow> = {}): WalkRow {
  const onSpot = to?.stop && from.stop && (to.stop.id === from.stop.id || distM(from, to) <= SAME_SPOT_M || metroChange(from.stop, to.stop));
  const m = to ? (onSpot ? 0 : distM(from, to)) : null;
  return { kind: 'walk', from, to, metres: m, minutes: m === null ? null : m === 0 ? 0 : walkMinutes(m), ...extra };
}

export function rowsOf(f: Flow): Row[] {
  const rows: Row[] = [];
  const appending = f.board && !f.slot;
  const firstBoard = f.rides[0]?.board ?? (appending ? f.board : null);
  if (f.start) {
    const to = firstBoard ? stopEnd(firstBoard) : f.end && !f.fixedEnd ? placeEnd(f.end) : null;
    rows.push(walkRow(placeEnd(f.start), to, f.fixedStart ? { fixed: 'start' } : {}));
  }
  f.rides.forEach((r, i) => {
    if (f.slot && !f.slot.replace && f.slot.at === i && f.board) rows.push({ kind: 'boarding', board: f.board });
    if (i > 0) {
      rows.push(walkRow(stopEnd(f.rides[i - 1].off), stopEnd(r.board), { insertAt: i }));
    }
    const replacing = !!f.slot?.replace && f.slot.at === i;
    if (replacing && f.board) rows.push({ kind: 'boarding', board: f.board });
    else rows.push({ kind: 'ride', ride: r, index: i, replacing });
  });
  const last = f.rides.at(-1)?.off;
  if (appending) {
    if (last && last.id !== f.board!.id) rows.push(walkRow(stopEnd(last), stopEnd(f.board!)));
    rows.push({ kind: 'boarding', board: f.board! });
  } else if (f.slot && !f.slot.replace && f.slot.at >= f.rides.length && f.board) {
    rows.push({ kind: 'boarding', board: f.board });
  }
  if (f.end && last && !appending) rows.push(walkRow(stopEnd(last), placeEnd(f.end), f.fixedEnd ? { fixed: 'end' } : {}));
  return rows;
}

// ——— Finishing. ———

/** Done is there once the route has a ride. A ride boarded but not ended yet is left out. */
export const canFinish = (f: Flow) => f.rides.length > 0;

/** The trip's ends: the first walk's Start (or the first boarding stop), the last walk's End (or the last get-off stop). */
export function endsOf(f: Flow): { from: Place; to: Place } | null {
  if (!f.rides.length) return null;
  const first = f.rides[0].board;
  const last = f.rides.at(-1)!.off;
  return {
    from: f.start ?? { lat: first.lat, lon: first.lon, label: first.name },
    to: f.end ?? { lat: last.lat, lon: last.lon, label: last.name },
  };
}

/** What the builder hands back on Done; null when there is no ride yet. */
export function finish(f: Flow): BuiltSteps | null {
  const ends = endsOf(f);
  if (!ends) return null;
  const steps: JourneyStep[] = f.rides.map(stepOf);
  return { steps, ...ends };
}

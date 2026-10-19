import type { LatLon, PlanAvoid } from '@transit/shared';
import { distanceM } from '../ttc/stops.ts';
import { estimateWalk, isAvoided, type PatternRef, type StopRef, type Timetable } from './source.ts';

// Which rides to take, from the whole network in memory (TtcSource.warm). A
// RAPTOR search run backwards from the arrive-by time: round k finds, for every
// stop, the latest time you can be there and still arrive with k rides. The
// answer is structures (line, boarding stop, alighting stop per ride), not
// times: the journey engine times them from timetables and live data, the same
// way it times a hand-built route. Same network, same deadline, same answer, so
// the ways a trip shows don't jump between refreshes.

const MIN = 60_000;
const TBILISI_MS = 4 * 3_600_000;
/** Getting off one vehicle and onto the next takes at least this (as the engine). */
const CONNECT_MS = 2 * MIN;
/** Walks between stops at a change. */
export const TRANSFER_M = 400;
/** Walks at the start and the end. */
export const ACCESS_M = 1000;

export interface Ride {
  p: PatternRef;
  /** Positions in p.stops. */
  b: number;
  a: number;
}

export interface Journey {
  rides: Ride[];
  /** Latest time to leave the start (UTC ms), timetable only. */
  leave: number;
  arrive: number;
}

export interface RaptorInput {
  from: LatLon;
  to: LatLon;
  /** UTC ms. */
  deadline: number;
  avoid?: PlanAvoid;
  modes?: string[];
  /** Patterns (routeId|suffix) not to use; for finding alternatives. */
  banned?: Set<string>;
  maxRides?: number;
}

export interface RaptorNetwork {
  patterns: PatternRef[];
  /** A pattern's timetable on a Tbilisi date; null when it has none. Must not call TTC (memory only). */
  timetable: (p: PatternRef, date: string) => Promise<Timetable | null>;
}

const tbilisiDate = (ms: number) => new Date(ms + TBILISI_MS).toISOString().slice(0, 10);
const dayStart = (date: string) => Date.parse(`${date}T00:00:00Z`) - TBILISI_MS;

export const patternKey = (p: PatternRef) => `${p.routeId}|${p.suffix}`;

/** Trips of one pattern as absolute times per position (NaN: the trip doesn't stop there), earliest first. */
type Trips = Float64Array[];

interface Label {
  t: number;
  /** How this stop was reached in this round: a ride (pattern, board here, alight at a) or a walk to `to`. */
  ride?: { p: PatternRef; b: number; a: number; trip: number };
  walk?: string;
}

interface Prepared {
  stops: Map<string, StopRef>;
  /** Stops within TRANSFER_M of each stop, with the walk in ms. */
  near: Map<string, Array<{ id: string; ms: number }>>;
  at: Map<string, Array<{ p: PatternRef; i: number }>>;
}

const prepared = new WeakMap<PatternRef[], Prepared>();

/** Stop coordinates, foot-path neighbours and patterns per stop; computed once per network. */
const prepare = (patterns: PatternRef[]): Prepared => {
  const hit = prepared.get(patterns);
  if (hit) return hit;
  const stops = new Map<string, StopRef>();
  const at = new Map<string, Array<{ p: PatternRef; i: number }>>();
  for (const p of patterns) {
    p.stops.forEach((s, i) => {
      stops.set(s.id, s);
      const list = at.get(s.id);
      if (list) list.push({ p, i });
      else at.set(s.id, [{ p, i }]);
    });
  }
  // A grid of ~TRANSFER_M cells: neighbours are in the 3x3 cells around a stop.
  const cell = (s: LatLon) => `${Math.floor(s.lat / 0.0036)},${Math.floor(s.lon / 0.0048)}`;
  const grid = new Map<string, StopRef[]>();
  for (const s of stops.values()) {
    const k = cell(s);
    const list = grid.get(k);
    if (list) list.push(s);
    else grid.set(k, [s]);
  }
  const near = new Map<string, Array<{ id: string; ms: number }>>();
  for (const s of stops.values()) {
    const [y, x] = cell(s).split(',').map(Number);
    const out: Array<{ id: string; ms: number }> = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const o of grid.get(`${y + dy},${x + dx}`) ?? []) {
          if (o.id === s.id) continue;
          if (distanceM(s, o) <= TRANSFER_M) out.push({ id: o.id, ms: estimateWalk(s, o).sec * 1000 });
        }
      }
    }
    near.set(s.id, out);
  }
  const p: Prepared = { stops, near, at };
  prepared.set(patterns, p);
  return p;
};

/** The day's trips and the previous day's that run past midnight, as absolute ms. */
const tripsFor = async (net: RaptorNetwork, p: PatternRef, deadline: number, cache: Map<PatternRef, Trips>): Promise<Trips> => {
  const hit = cache.get(p);
  if (hit) return hit;
  const date = tbilisiDate(deadline);
  const prev = tbilisiDate(dayStart(date) - 12 * 3_600_000);
  const out: Trips = [];
  for (const d of [prev, date]) {
    const tt = await net.timetable(p, d);
    if (!tt) continue;
    const base = dayStart(d);
    const n = Math.max(0, ...p.stops.map((_, i) => tt.times[i]?.length ?? 0));
    for (let k = 0; k < n; k++) {
      const row = new Float64Array(p.stops.length).fill(NaN);
      let any = false;
      for (let i = 0; i < p.stops.length; i++) {
        const m = tt.times[i]?.[k];
        if (m === undefined) continue;
        row[i] = base + m * MIN;
        any = true;
      }
      // Only trips around the deadline matter (the night before's late trips, today's).
      if (any && row.some((t) => t > deadline - 6 * 3_600_000 && t <= deadline)) out.push(row);
    }
  }
  const first = (r: Float64Array) => r.find((t) => !Number.isNaN(t)) ?? 0;
  out.sort((x, y) => first(x) - first(y));
  cache.set(p, out);
  return out;
};

/**
 * Journeys arriving by the deadline: for each number of rides (1..maxRides),
 * the one that lets you leave the start latest, when it beats every journey
 * with fewer rides. Empty when the network isn't loaded or nothing fits.
 */
export async function raptor(net: RaptorNetwork, input: RaptorInput, trips = new Map<PatternRef, Trips>()): Promise<Journey[]> {
  if (!net.patterns.length) return [];
  const { stops, near, at } = prepare(net.patterns);
  const maxRides = input.maxRides ?? 4;
  const usable = (p: PatternRef) =>
    !isAvoided(p, input.avoid) && (!input.modes || input.modes.includes(p.mode)) && !input.banned?.has(patternKey(p));

  const access = (pt: LatLon) =>
    [...stops.values()].filter((s) => distanceM(pt, s) <= ACCESS_M).map((s) => ({ id: s.id, ms: estimateWalk(pt, s).sec * 1000 }));
  const egress = access(input.to);
  const starts = access(input.from);
  if (!egress.length || !starts.length) return [];

  // rounds[k]: label per stop with k rides. best: the best label in any round (prunes).
  const rounds: Array<Map<string, Label>> = [new Map()];
  const best = new Map<string, number>();
  for (const e of egress) {
    const t = input.deadline - e.ms;
    rounds[0].set(e.id, { t });
    best.set(e.id, Math.max(best.get(e.id) ?? -Infinity, t));
  }
  let marked = new Set(egress.map((e) => e.id));
  const out: Journey[] = [];
  let bestLeave = -Infinity;

  for (let k = 1; k <= maxRides && marked.size; k++) {
    const prev = rounds[k - 1];
    const cur = new Map<string, Label>();
    rounds.push(cur);
    // Patterns through a marked stop, scanned from the latest marked position back.
    const queue = new Map<PatternRef, number>();
    for (const id of marked) {
      for (const { p, i } of at.get(id) ?? []) {
        if (!usable(p)) continue;
        queue.set(p, Math.max(queue.get(p) ?? -1, i));
      }
    }
    const improved = new Set<string>();
    for (const [p, from] of queue) {
      const tr = await tripsFor(net, p, input.deadline, trips);
      if (!tr.length) continue;
      let trip = -1;
      let alight = -1;
      for (let i = from; i >= 0; i--) {
        const id = p.stops[i].id;
        // Board here on the current trip.
        if (trip >= 0 && !Number.isNaN(tr[trip][i])) {
          const t = tr[trip][i];
          if (t > (best.get(id) ?? -Infinity) && t > (cur.get(id)?.t ?? -Infinity)) {
            cur.set(id, { t, ride: { p, b: i, a: alight, trip } });
            best.set(id, t);
            improved.add(id);
          }
        }
        // Or get off here: the latest trip that arrives in time for what comes after.
        const after = prev.get(id);
        if (!after) continue;
        const limit = after.t - (k > 1 ? CONNECT_MS : 0);
        let lo = trip + 1;
        let hi = tr.length - 1;
        let found = -1;
        // Latest trip with time at i <= limit (trips are in order; NaN rows are skipped by the linear fallback).
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const t = tr[mid][i];
          if (Number.isNaN(t)) {
            // Rare (a trip skipping a stop): scan this window linearly.
            for (let j = hi; j >= lo; j--) if (tr[j][i] <= limit) { found = Math.max(found, j); break; }
            break;
          }
          if (t <= limit) {
            found = mid;
            lo = mid + 1;
          } else hi = mid - 1;
        }
        if (found > trip) {
          trip = found;
          alight = i;
        }
      }
    }
    // Walk from an improved stop to its neighbours (a change on foot).
    for (const id of [...improved]) {
      const l = cur.get(id)!;
      for (const n of near.get(id) ?? []) {
        const t = l.t - n.ms;
        if (t > (best.get(n.id) ?? -Infinity) && t > (cur.get(n.id)?.t ?? -Infinity)) {
          cur.set(n.id, { t, walk: id });
          best.set(n.id, t);
          improved.add(n.id);
        }
      }
    }
    marked = improved;

    // The best way to leave the start with k rides.
    let top: { id: string; leave: number } | null = null;
    for (const s of starts) {
      const l = cur.get(s.id);
      if (l?.ride && (!top || l.t - s.ms > top.leave)) top = { id: s.id, leave: l.t - s.ms };
    }
    if (top && top.leave > bestLeave) {
      const rides = trace(rounds, k, top.id);
      if (rides) {
        bestLeave = top.leave;
        out.push({ rides, leave: top.leave, arrive: input.deadline });
      }
    }
  }
  return out;
}

/** The rides of the round-k label at `id`, following ride and walk links down to round 0. */
function trace(rounds: Array<Map<string, Label>>, k: number, id: string): Ride[] | null {
  const rides: Ride[] = [];
  let stop = id;
  for (let r = k; r >= 1; r--) {
    let l = rounds[r].get(stop);
    // A walk link: the ride starts at the stop walked to.
    for (let guard = 0; l?.walk && guard < 4; guard++) {
      stop = l.walk;
      l = rounds[r].get(stop);
    }
    if (!l?.ride) return null;
    rides.push({ p: l.ride.p, b: l.ride.b, a: l.ride.a });
    stop = l.ride.p.stops[l.ride.a].id;
  }
  return rides;
}

/**
 * Several different journeys: the Pareto set (rides vs leave time), then again
 * with the first ride's line of each found journey left out, so a second-best
 * line or another change point shows up too. At most `max`, distinct by lines.
 */
export async function alternatives(net: RaptorNetwork, input: RaptorInput, max = 8): Promise<Journey[]> {
  const trips = new Map<PatternRef, Trips>();
  const seen = new Set<string>();
  const out: Journey[] = [];
  const add = (js: Journey[]) => {
    for (const j of js) {
      const k = j.rides.map((r) => `${r.p.shortName}@${r.p.stops[r.b].id}>${r.p.stops[r.a].id}`).join('|');
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(j);
    }
  };
  const banned = new Set(input.banned ?? []);
  add(await raptor(net, { ...input, banned }, trips));
  // Leave out each first-ride line once (and its other direction is irrelevant: it doesn't go there).
  for (let round = 0; round < 3 && out.length < max; round++) {
    const firsts = out.map((j) => patternKey(j.rides[0].p)).filter((k) => !banned.has(k));
    if (!firsts.length) break;
    for (const k of firsts) banned.add(k);
    const before = out.length;
    add(await raptor(net, { ...input, banned }, trips));
    if (out.length === before) break;
  }
  return out.slice(0, max);
}

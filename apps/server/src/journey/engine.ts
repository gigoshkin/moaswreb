import { distanceM } from '../ttc/stops.ts';
import type { Itinerary, JourneyStep, LatLon, PlanAvoid, PlanLeg, PlanPlace } from '@transit/shared';
import { encodePolyline } from './polyline.ts';
import { isAvoided, type PatternRef, type Source, type StopRef } from './source.ts';

// Links, not guesses. A journey is: walk, ride, (walk, ride)…, walk. Each ride
// has alternatives (every line that goes from one of its stops to another).
// "Arrive by" is solved backwards: the last ride is the latest one that still
// gets you there, the walk before it says when you must be at the earlier
// stop, and so on, so every alternative is compared against the same
// deadline. "Leave now" is the same walk forwards from the current time.

const MIN = 60_000;
const TBILISI_MS = 4 * 3_600_000;
/** Slack between getting off one vehicle and the next one leaving. */
const CONNECT_MS = 2 * MIN;
/** Departures of the pattern are looked at this far around the deadline / start. */
const BEFORE_MS = 6 * 3_600_000;
const AFTER_MS = 3 * 3_600_000;
/** A "leave now" option that arrives more than this before the deadline is dropped. */
const EARLY_MS = 90 * MIN;

export const tbilisiDate = (ms: number) => new Date(ms + TBILISI_MS).toISOString().slice(0, 10);
const dayStart = (date: string) => Date.parse(`${date}T00:00:00Z`) - TBILISI_MS;
const addDays = (date: string, n: number) => tbilisiDate(dayStart(date) + n * 86_400_000 + 12 * 3_600_000);

interface Dep {
  dep: number;
  arr: number;
  live: boolean;
}

/** One way to do a ride: a line, where it is boarded and where you get off. */
interface Alt {
  p: PatternRef;
  b: number;
  a: number;
  board: StopRef;
  alight: StopRef;
  deps: Dep[];
}

/** An alternative with its departure chosen, and what follows it. */
interface Node {
  alt: Alt;
  dep: Dep;
  next: Node | null;
  /** Walk from the alight stop to the next boarding stop (or the destination). */
  walkAfter: { sec: number; m: number };
}

export interface JourneyInput {
  from: LatLon;
  to: LatLon;
  steps: JourneyStep[];
  avoid?: PlanAvoid;
  /** UTC ms. */
  deadline: number;
  now: number;
  /** Modes allowed, e.g. ['BUS', 'SUBWAY']. */
  modes?: string[];
}

const rideTimes = (all: Dep[], t: number): number => {
  // Ride time of the timetable trip closest to `t`.
  let best: Dep | null = null;
  for (const d of all) if (!best || Math.abs(d.dep - t) < Math.abs(best.dep - t)) best = d;
  return best ? best.arr - best.dep : 0;
};

export class Engine {
  private readonly src: Source;

  constructor(src: Source) {
    this.src = src;
  }

  /** All ways to do one step, with their departures between `lo` and `hi`. */
  private async alts(step: JourneyStep, input: JourneyInput, lo: number, hi: number): Promise<Alt[]> {
    const out: Alt[] = [];
    const allowed = step.routes?.length ? new Set(step.routes) : null;
    const seen = new Set<string>();
    for (const fromId of step.fromStops) {
      for (const p of await this.src.patternsAt(fromId)) {
        if (allowed && !allowed.has(p.shortName)) continue;
        if (isAvoided(p, input.avoid)) continue;
        if (input.modes && !input.modes.includes(p.mode)) continue;
        const b = p.stops.findIndex((s) => s.id === fromId);
        if (b < 0) continue;
        for (const toId of step.toStops) {
          const a = p.stops.findIndex((s, i) => i > b && s.id === toId);
          if (a < 0) continue;
          const key = `${p.routeId}|${p.suffix}|${fromId}|${toId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const alt: Alt = { p, b, a, board: p.stops[b], alight: p.stops[a], deps: [] };
          alt.deps = await this.departures(alt, lo, hi, input.now);
          if (alt.deps.length) out.push(alt);
        }
      }
    }
    return out;
  }

  /** Timetable trips in the window, with live vehicles replacing the timetable where TTC reports them. */
  private async departures(alt: Alt, lo: number, hi: number, now: number): Promise<Dep[]> {
    const table: Dep[] = [];
    for (let date = addDays(tbilisiDate(lo), -1); date <= tbilisiDate(hi); date = addDays(date, 1)) {
      const tt = await this.src.timetable(alt.p, date);
      const tb = tt?.times[alt.b];
      const ta = tt?.times[alt.a];
      if (!tb || !ta || tb.length !== ta.length) continue;
      const base = dayStart(date);
      for (let k = 0; k < tb.length; k++) {
        const dep = base + tb[k] * MIN;
        if (dep >= lo && dep <= hi) table.push({ dep, arr: base + ta[k] * MIN, live: false });
      }
    }
    table.sort((x, y) => x.dep - y.dep);

    let liveMins: number[] = [];
    if (hi >= now && lo <= now + 3 * 3_600_000) liveMins = await this.src.live(alt.board.id, alt.p).catch(() => []);
    if (!liveMins.length) return table;
    const live: Dep[] = liveMins
      .map((m) => now + m * MIN)
      .sort((x, y) => x - y)
      .map((dep) => ({ dep, arr: dep + (table.length ? rideTimes(table, dep) : 0), live: true }))
      .filter((d) => d.dep >= lo && d.dep <= hi && d.arr > d.dep);
    if (!live.length) return table;
    const last = live[live.length - 1].dep;
    // Within the live window only vehicles TTC can see count; the timetable takes over after the last one.
    return [...live, ...table.filter((d) => d.dep > last + 2 * MIN)];
  }

  private async walkBetween(a: LatLon, b: LatLon): Promise<{ sec: number; m: number }> {
    if (distanceM(a, b) < 15) return { sec: 0, m: 0 };
    return this.src.walk(a, b);
  }

  /** Itineraries for the first ride's alternatives, each arriving by the deadline with the latest possible start; then, for what's still catchable now, the soonest ones. */
  async solve(input: JourneyInput): Promise<Itinerary[]> {
    if (!input.steps.length) return [];
    const lo = Math.min(input.deadline - BEFORE_MS, input.now);
    const hi = Math.max(input.deadline + AFTER_MS, input.now + AFTER_MS);
    const altsByStep: Alt[][] = [];
    for (const step of input.steps) altsByStep.push(await this.alts(step, input, lo, hi));
    if (altsByStep.some((a) => !a.length)) return [];

    const back = await this.backward(altsByStep, input);
    // A line whose on-time ride can still be caught needs no "leave now" version.
    const catchable = new Set(back.filter((n) => n.dep.dep - 0 >= input.now).map((n) => n.alt.p.shortName));
    // And one that arrives long before the deadline is not an answer to "arrive by": that line has no ride near the time.
    const fwd = (await this.forward(altsByStep, input)).filter((n) => {
      if (catchable.has(n.alt.p.shortName)) return false;
      let last = n;
      while (last.next) last = last.next;
      return last.dep.arr + last.walkAfter.sec * 1000 >= input.deadline - EARLY_MS;
    });
    const all = [...back, ...fwd];
    const seen = new Set<string>();
    const out: Itinerary[] = [];
    for (const n of all) {
      const it = await this.itinerary(n, input);
      if (!seen.has(it.id)) {
        seen.add(it.id);
        out.push(it);
      }
    }
    return out;
  }

  /** Latest departures that still arrive by the deadline: one chain per first-ride alternative (best per line). */
  private async backward(altsByStep: Alt[][], input: JourneyInput): Promise<Node[]> {
    const n = altsByStep.length;
    let later: Node[] = [];
    for (let i = n - 1; i >= 0; i--) {
      const here: Node[] = [];
      for (const alt of altsByStep[i]) {
        let limit: number;
        let next: Node | null = null;
        let walkAfter: { sec: number; m: number };
        if (i === n - 1) {
          walkAfter = await this.walkBetween(alt.alight, input.to);
          limit = input.deadline - walkAfter.sec * 1000;
        } else {
          // The best following ride that can still be caught from here.
          limit = -Infinity;
          walkAfter = { sec: 0, m: 0 };
          for (const nx of later) {
            const w = await this.walkBetween(alt.alight, nx.alt.board);
            const l = nx.dep.dep - w.sec * 1000 - CONNECT_MS;
            if (l > limit) {
              limit = l;
              next = nx;
              walkAfter = w;
            }
          }
        }
        let best: Dep | null = null;
        for (const d of alt.deps) if (d.arr <= limit && (!best || d.dep > best.dep)) best = d;
        if (best) here.push({ alt, dep: best, next, walkAfter });
      }
      if (!here.length) return [];
      later = here;
    }
    return bestPerLine(later);
  }

  /** Earliest arrivals when leaving at `now`: one chain per first-ride alternative (best per line). */
  private async forward(altsByStep: Alt[][], input: JourneyInput): Promise<Node[]> {
    const firsts: Node[] = [];
    for (const first of altsByStep[0]) {
      const w = await this.walkBetween(input.from, first.board);
      const ready = input.now + w.sec * 1000;
      const dep = first.deps.find((d) => d.dep >= ready);
      if (!dep) continue;
      // Build forward and link it backwards afterwards.
      const chain: Node[] = [{ alt: first, dep, next: null, walkAfter: { sec: 0, m: 0 } }];
      let ok = true;
      for (let i = 1; i < altsByStep.length && ok; i++) {
        const prev = chain[chain.length - 1];
        let best: { node: Node; w: { sec: number; m: number } } | null = null;
        for (const alt of altsByStep[i]) {
          const ww = await this.walkBetween(prev.alt.alight, alt.board);
          const ready2 = prev.dep.arr + ww.sec * 1000 + CONNECT_MS;
          const d = alt.deps.find((x) => x.dep >= ready2);
          if (d && (!best || d.arr < best.node.dep.arr)) best = { node: { alt, dep: d, next: null, walkAfter: { sec: 0, m: 0 } }, w: ww };
        }
        if (!best) ok = false;
        else {
          prev.walkAfter = best.w;
          chain.push(best.node);
        }
      }
      if (!ok) continue;
      const last = chain[chain.length - 1];
      last.walkAfter = await this.walkBetween(last.alt.alight, input.to);
      for (let i = 0; i < chain.length - 1; i++) chain[i].next = chain[i + 1];
      firsts.push(chain[0]);
    }
    return bestPerLine(firsts, true);
  }

  private async itinerary(first: Node, input: JourneyInput): Promise<Itinerary> {
    const legs: PlanLeg[] = [];
    const startWalk = await this.walkBetween(input.from, first.alt.board);
    const place = (name: string, p: LatLon, stopId: string | null): PlanPlace => ({ name, lat: p.lat, lon: p.lon, stopId });
    const origin = place('Origin', input.from, null);
    const walk = (from: PlanPlace, to: PlanPlace, startMs: number, w: { sec: number; m: number }): PlanLeg => ({
      mode: 'WALK',
      from,
      to,
      departAt: new Date(startMs).toISOString(),
      arriveAt: new Date(startMs + w.sec * 1000).toISOString(),
      durationSec: w.sec,
      distanceM: Math.round(w.m),
      route: null,
      headsign: null,
      realtime: false,
      intermediateStops: 0,
      polyline: null,
    });
    const stopPlace = (s: StopRef) => place(s.name, s, s.id);

    let n: Node | null = first;
    let prevPlace = origin;
    let at = first.dep.dep - startWalk.sec * 1000;
    const departAt = at;
    let walkBefore = startWalk;
    let last: Node = first;
    while (n) {
      const boardP = stopPlace(n.alt.board);
      if (walkBefore.sec > 0) legs.push(walk(prevPlace, boardP, n.dep.dep - walkBefore.sec * 1000, walkBefore));
      const { p, b, a } = n.alt;
      legs.push({
        mode: p.mode,
        from: boardP,
        to: stopPlace(n.alt.alight),
        departAt: new Date(n.dep.dep).toISOString(),
        arriveAt: new Date(n.dep.arr).toISOString(),
        durationSec: Math.round((n.dep.arr - n.dep.dep) / 1000),
        distanceM: Math.round(p.stops.slice(b, a).reduce((s, st, i) => s + distanceM(st, p.stops[b + i + 1]), 0)),
        route: { shortName: p.shortName, longName: p.longName, color: p.color, minibus: p.minibus },
        headsign: p.headsign,
        realtime: n.dep.live,
        intermediateStops: Math.max(0, a - b - 1),
        polyline: encodePolyline(p.stops.slice(b, a + 1)),
      });
      prevPlace = stopPlace(n.alt.alight);
      walkBefore = n.walkAfter;
      last = n;
      at = n.dep.arr;
      n = n.next;
      if (n) {
        // Walk to the next stop; it ends right before that boarding.
        walkBefore = last.walkAfter;
      }
    }
    // Final walk to the destination.
    const dest = place('Destination', input.to, null);
    if (last.walkAfter.sec > 0 || distanceM(prevPlace, dest) >= 15) legs.push(walk(prevPlace, dest, at, last.walkAfter));
    const arriveAt = at + last.walkAfter.sec * 1000;
    const transit = legs.filter((l) => l.mode !== 'WALK');
    const walking = legs.filter((l) => l.mode === 'WALK');
    const hm = new Date(departAt + TBILISI_MS).toISOString().slice(11, 16);
    return {
      id: [hm, ...transit.map((l) => l.route?.shortName ?? l.mode)].join('-'),
      departAt: new Date(departAt).toISOString(),
      arriveAt: new Date(arriveAt).toISOString(),
      durationSec: Math.round((arriveAt - departAt) / 1000),
      walkSec: walking.reduce((s, l) => s + l.durationSec, 0),
      walkM: walking.reduce((s, l) => s + l.distanceM, 0),
      transfers: Math.max(0, transit.length - 1),
      legs,
    };
  }
}

/** One chain per line of the first ride: the one that is best (latest leave, or earliest arrival when `byArrival`). */
function bestPerLine(nodes: Node[], byArrival = false): Node[] {
  const best = new Map<string, Node>();
  for (const n of nodes) {
    const key = `${n.alt.p.shortName}`;
    const cur = best.get(key);
    const end = (x: Node) => { let y = x; while (y.next) y = y.next; return y.dep.arr; };
    const better = !cur || (byArrival ? end(n) < end(cur) : n.dep.dep > cur.dep.dep);
    if (better) best.set(key, n);
  }
  return [...best.values()];
}

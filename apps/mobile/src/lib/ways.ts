import type { Itinerary, JourneyStep } from '@transit/shared';
import type { LineRef, Slot } from '../ui/LineChain';
import { kindOf, leaveAt, transitLegs } from './plans';

// Itineraries that ride between the same stops on different lines are the same
// way to travel with different numbers: "any of 541, 551, 558". Itineraries
// that change between lines are a sequence. A "way" groups the first kind.
// Lines often stop at neighbouring stops of the same place (321 and 518 a few
// metres apart before the same metro), so one ride may board and leave at stops
// up to NEAR_M away as long as every other ride uses the very same stops.

/** Stops this close count as the same place for grouping. */
export const NEAR_M = 150;

const stopKey = (p: { name: string; stopId: string | null }) => p.stopId ?? p.name;

/** The rides of an itinerary as boarding and alighting stops: same key, same way. */
export const wayKey = (it: Itinerary): string =>
  transitLegs(it)
    .map((l) => `${stopKey(l.from)}>${stopKey(l.to)}`)
    .join('|');

type Place = { name: string; stopId: string | null; lat: number; lon: number };

/** Straight-line metres; fine at city scale. */
const metres = (a: Place, b: Place): number => {
  const k = Math.PI / 180;
  const x = (b.lon - a.lon) * k * Math.cos(((a.lat + b.lat) / 2) * k);
  const y = (b.lat - a.lat) * k;
  return Math.hypot(x, y) * 6_371_000;
};

/**
 * Same way to travel: as many rides, same modes, the same stops on every
 * ride except at most one whose boarding and alighting stops are each within
 * NEAR_M of the other's.
 */
export const sameWay = (a: Itinerary, b: Itinerary): boolean => {
  const x = transitLegs(a);
  const y = transitLegs(b);
  if (x.length !== y.length) return false;
  let near = 0;
  for (let i = 0; i < x.length; i++) {
    if (x[i].mode !== y[i].mode) return false;
    if (stopKey(x[i].from) === stopKey(y[i].from) && stopKey(x[i].to) === stopKey(y[i].to)) continue;
    if (metres(x[i].from, y[i].from) > NEAR_M || metres(x[i].to, y[i].to) > NEAR_M) return false;
    near++;
  }
  return near <= 1;
};

const lineOf = (l: Itinerary['legs'][number]): LineRef => ({ label: l.route?.shortName ?? l.mode, kind: kindOf(l) });

/** One itinerary as a chain of single lines. */
export const chainOf = (it: Itinerary): Slot[] => transitLegs(it).map((l) => [lineOf(l)]);

export interface Way {
  key: string;
  /** The ways to do it, earliest arrival first. */
  its: Itinerary[];
  /** Per ride, every line that can do it (the best itinerary's line first). */
  slots: Slot[];
}

/** The lines that can do each ride of `it`, taken from every itinerary over the same (or neighbouring) stops. */
export const slotsFor = (it: Itinerary, all: Itinerary[]): Slot[] => {
  const slots = chainOf(it);
  for (const other of all) {
    if (other === it || !sameWay(it, other)) continue;
    transitLegs(other).forEach((l, i) => {
      const line = lineOf(l);
      if (!slots[i].some((x) => x.label === line.label)) slots[i].push(line);
    });
  }
  return slots;
};

/** Group by stops, best (earliest arrival, then latest leave) first. */
export function groupWays(all: Itinerary[], bufferMin: number): Way[] {
  const best = (a: Itinerary, b: Itinerary) => Date.parse(a.arriveAt) - Date.parse(b.arriveAt) || leaveAt(b, bufferMin) - leaveAt(a, bufferMin);
  // The same lines can show up with different times or stops: keep the best of each, so nothing is listed twice.
  const seen = new Set<string>();
  const distinct = [...all].sort(best).filter((it) => {
    const k = chainOf(it).map((s) => s[0].label).join('>');
    return !seen.has(k) && !!seen.add(k);
  });
  // Each joins the first group whose best itinerary is the same way (best first, so that one leads).
  const groups: Itinerary[][] = [];
  for (const it of distinct) {
    const g = groups.find((its) => sameWay(its[0], it));
    if (g) g.push(it);
    else groups.push([it]);
  }
  return groups.map((its) => ({ key: wayKey(its[0]), its, slots: slotsFor(its[0], its) })).sort((a, b) => best(a.its[0], b.its[0]));
}

// A picked way is kept as the trip's rides. Each ride may be done by any of
// its variations (the lines of the way's group); the planner then looks at
// nothing else for that ride.

/**
 * One ride of a pinned route as the phone keeps it: the planner step plus every
 * line that can do the ride (`lines`, from the way or the by-hand builder). Only fromStops, toStops and routes go to the server (wireSteps).
 */
export interface RideStep extends JourneyStep {
  lines?: LineRef[];
}

/** What the server takes per ride (store and /plan/journey schemas). */
const MAX_STOPS = 8;
const MAX_ROUTES = 20;

/**
 * The rides of `it` with every variation of each from `all` (same way, see
 * sameWay): their boarding and alighting stops (the picked itinerary's first)
 * and all their lines, every one allowed. Undefined when a ride has no stop id.
 */
export function variantSteps(it: Itinerary, all: Itinerary[]): RideStep[] | undefined {
  const own = transitLegs(it);
  if (!own.length || own.some((l) => !l.from.stopId || !l.to.stopId)) return undefined;
  const rides = own.map(() => ({ fromStops: [] as string[], toStops: [] as string[], lines: [] as LineRef[], named: true }));
  const add = (x: Itinerary) =>
    transitLegs(x).forEach((l, i) => {
      const r = rides[i];
      if (l.from.stopId && !r.fromStops.includes(l.from.stopId)) r.fromStops.push(l.from.stopId);
      if (l.to.stopId && !r.toStops.includes(l.to.stopId)) r.toStops.push(l.to.stopId);
      const line = lineOf(l);
      if (!r.lines.some((x) => x.label === line.label)) r.lines.push(line);
      if (!l.route?.shortName) r.named = false;
    });
  add(it);
  for (const other of all) if (other !== it && sameWay(it, other)) add(other);
  // A ride without line numbers can't be narrowed down: it stays "any line between these stops".
  return rides.map(({ fromStops, toStops, lines, named }) => {
    const kept = lines.slice(0, MAX_ROUTES);
    return { fromStops: fromStops.slice(0, MAX_STOPS), toStops: toStops.slice(0, MAX_STOPS), lines: kept, ...(named ? { routes: kept.map((l) => l.label) } : {}) };
  });
}

// A trip may keep several ways: the rider ticks every row of the list they'd
// take, and the trip plans each ticked way on its own and nothing else. Each
// ticked way is a pinned route as above. `steps` stays the first one, so trips
// saved before this, older app versions and the server (alerts plan with
// `steps`) keep working; `ways` is only stored when more than one is ticked.

/** The ways a trip keeps (empty: the app picks from every line). */
export const tripWays = (t: { steps?: RideStep[]; ways?: RideStep[][] }): RideStep[][] => (t.ways?.length ? t.ways : t.steps?.length ? [t.steps] : []);

/** The trip fields for a set of kept ways: the first as `steps`, the whole list as `ways` when there are several. */
export const waysFields = (ways: RideStep[][]): { steps: RideStep[] | undefined; ways: RideStep[][] | undefined } => ({
  steps: ways[0],
  ways: ways.length > 1 ? ways : undefined,
});

/** True when `it` rides exactly the kept way `steps`: same number of rides, each from one of its stops, to one of its stops, on one of its lines. */
export function fitsWay(steps: JourneyStep[], it: Itinerary): boolean {
  const legs = transitLegs(it);
  if (legs.length !== steps.length) return false;
  return legs.every((l, i) => {
    const s = steps[i];
    if (!l.from.stopId || !l.to.stopId || !s.fromStops.includes(l.from.stopId) || !s.toStops.includes(l.to.stopId)) return false;
    return !s.routes?.length || (!!l.route?.shortName && s.routes.includes(l.route.shortName));
  });
}

/** A row of the list is ticked when one of its itineraries is a kept way. */
export const isTicked = (way: Way, kept: JourneyStep[][]): boolean => way.its.some((it) => kept.some((k) => fitsWay(k, it)));

/**
 * Tick or untick a row. Ticking keeps the row's way with all its variations
 * (variantSteps over `all`); unticking drops every kept way the row rides. The
 * last ticked way stays: a trip with ways keeps at least one ("let the app
 * pick" clears them instead). A row whose rides have no stop ids can't be kept.
 */
export function toggleWay(kept: RideStep[][], way: Way, all: Itinerary[]): RideStep[][] {
  if (isTicked(way, kept)) {
    const left = kept.filter((k) => !way.its.some((it) => fitsWay(k, it)));
    return left.length ? left : kept;
  }
  const steps = variantSteps(way.its[0], all);
  return steps ? [...kept, steps] : kept;
}

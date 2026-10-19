// The one route model, used by the app (Today, trip screens, route builder,
// hand builder, chat cards) and the server (chat and MCP plan_trip, proposal
// cards). Pure functions only: no runtime dependencies.
//
// A trip keeps a set of WAYS. A way is a structure of rides: the rides in
// order, each with its kind (bus, minibus, metro), its boarding and alighting
// stops and the lines that can do it. Itineraries are variations of the same
// way only when they have the same structure: as many rides, the same kind on
// each ride, and boarding / alighting at the same place (the same stops, or on
// at most one ride stops within NEAR_M of each other). So a direct 302 is never
// the same way as 321|335 -> metro 1, and a 2-ride way never matches a 3-ride way.

import { leaveAtMs } from './leave.ts';
import type { Itinerary, JourneyStep, PlanLeg, PlanResponse } from './plan.ts';
import { tbilisiLocalToIso } from './time.ts';

export const transitLegs = (it: Itinerary): PlanLeg[] => it.legs.filter((l) => l.mode !== 'WALK');

/** What a ride is: metro red, minibus blue, bus green. Metro is a different way from a road ride; bus and minibus are one family (see `family`). */
export type Kind = 'bus' | 'minibus' | 'metro';
export const kindOf = (leg: Pick<PlanLeg, 'mode' | 'route'>): Kind => (leg.mode === 'SUBWAY' ? 'metro' : leg.route?.minibus ? 'minibus' : 'bus');

/** One line of a ride. */
export interface LineRef {
  label: string;
  kind: Kind;
}

/** One ride of a way: the lines that can do it. More than one means "any of these" (same stops). */
export type Slot = LineRef[];

/**
 * One ride of a kept way as the phone keeps it: the planner step plus every
 * line that can do the ride (`lines`). Only fromStops, toStops and routes go to
 * the server (wireSteps).
 */
export interface RideStep extends JourneyStep {
  lines?: LineRef[];
}

/** Steps as the server takes them: the phone's own fields (the lines offered per ride) stay on the phone. */
export const wireSteps = (steps: JourneyStep[]): JourneyStep[] =>
  steps.map(({ fromStops, toStops, routes }) => ({ fromStops, toStops, ...(routes?.length ? { routes } : {}) }));

// --- Leave time and the option to show ---

/** Walk from the start to the first stop, whole minutes. */
export const firstWalkMin = (it: Itinerary): number => {
  const i = it.legs.findIndex((l) => l.mode !== 'WALK');
  const walk = (i < 0 ? it.legs : it.legs.slice(0, i)).reduce((s, l) => s + l.durationSec, 0);
  return Math.round(walk / 60);
};

/**
 * When to leave the start point: the first bus's departure minus the walk,
 * the user's buffer and the early-bus margin. Walking-only trips: departure.
 */
export const leaveAt = (it: Itinerary, bufferMin = 0): number => {
  const first = transitLegs(it)[0];
  if (!first) return Date.parse(it.departAt) - bufferMin * 60_000;
  return leaveAtMs(Date.parse(first.departAt), firstWalkMin(it) + bufferMin);
};

export type Choice =
  /** An option that still arrives on time. */
  | { kind: 'onTime'; it: Itinerary; leaveAt: number }
  /** Nothing on time is left; the soonest arrival you can still catch. */
  | { kind: 'late'; it: Itinerary; leaveAt: number; lateMin: number }
  | { kind: 'none' };

/** A leave time this far in the past still counts: you may be at the door. */
const GRACE_MS = 60_000;
/** Minutes of walking one change counts as (waiting, a second vehicle that may not come). */
const CHANGE_MIN = 8;
const effort = (it: Itinerary) => Math.round(it.walkSec / 60) + CHANGE_MIN * it.transfers;
/** Options leaving within this long of the latest one count as equal on time. */
const NEAR_TIE_MS = 5 * 60_000;

/**
 * The option to show: the latest one you can still catch that arrives by
 * `arriveByLocal` (ties within 5 min go to the least effort: walking minutes
 * plus 8 per change), as the server's watcher does. Falls back to the soonest
 * arrival when you can't make it on time any more.
 */
export function choose(its: Itinerary[], arriveByLocal: string, now: number, bufferMin = 0): Choice {
  const deadline = Date.parse(tbilisiLocalToIso(arriveByLocal) ?? '') || Infinity;
  const catchable = its.map((it) => ({ it, leaveAt: leaveAt(it, bufferMin) })).filter((c) => c.leaveAt >= now - GRACE_MS);
  const fits = catchable.filter((c) => Date.parse(c.it.arriveAt) <= deadline).sort((a, b) => b.leaveAt - a.leaveAt || Date.parse(a.it.arriveAt) - Date.parse(b.it.arriveAt));
  const onTime = fits
    .filter((c) => c.leaveAt >= fits[0].leaveAt - NEAR_TIE_MS)
    .sort((a, b) => effort(a.it) - effort(b.it) || b.leaveAt - a.leaveAt)[0];
  if (onTime) return { kind: 'onTime', ...onTime };
  const soonest = catchable.sort((a, b) => Date.parse(a.it.arriveAt) - Date.parse(b.it.arriveAt))[0];
  if (!soonest) return { kind: 'none' };
  return { kind: 'late', ...soonest, lateMin: Math.max(1, Math.ceil((Date.parse(soonest.it.arriveAt) - deadline) / 60_000)) };
}

// --- Merging the plans of several kept ways ---

/** Same rides at the same times: the same option, whichever plan it came from. */
const rideSig = (it: Itinerary) => transitLegs(it).map((l) => `${l.route?.shortName ?? l.mode}@${l.from.stopId ?? l.from.name}@${l.departAt}>${l.to.stopId ?? l.to.name}`).join('|') || it.id;

/** Several lists of itineraries as one: every option once (first seen wins), earliest arrival first, ids unique so lists can key on them. */
export function mergeItineraries(lists: Itinerary[][]): Itinerary[] {
  const seen = new Set<string>();
  const ids = new Set<string>();
  const out: Itinerary[] = [];
  lists.forEach((list, n) => {
    for (const it of list) {
      const sig = rideSig(it);
      if (seen.has(sig)) continue;
      seen.add(sig);
      const id = ids.has(it.id) ? `${it.id}~${n}` : it.id;
      ids.add(id);
      out.push(id === it.id ? it : { ...it, id });
    }
  });
  return out.sort((a, b) => Date.parse(a.arriveAt) - Date.parse(b.arriveAt));
}

/** One plan from the plans of a trip's kept ways (one request each). The first plan's query and time stand for the whole. One plan is returned as it is. */
export function mergePlans(plans: PlanResponse[]): PlanResponse | null {
  if (plans.length <= 1) return plans[0] ?? null;
  return { ...plans[0], itineraries: mergeItineraries(plans.map((p) => p.itineraries)) };
}

// --- Structure and grouping ---

/** Stops this close count as the same place for grouping. */
export const NEAR_M = 150;

const stopKey = (p: { name: string; stopId: string | null }) => p.stopId ?? p.name;

/** The rides of an itinerary as boarding and alighting stops: same key, same way. */
export const wayKey = (it: Itinerary): string =>
  transitLegs(it)
    .map((l) => `${stopKey(l.from)}>${stopKey(l.to)}`)
    .join('|');

/** The structure of an itinerary: the kind of each ride, e.g. ['bus', 'metro']. A direct line is one ride. */
/** Buses and minibuses are the same kind of way (a 518 minibus can stand in for a 321 bus); metro is its own. */
export const family = (k: Kind): 'metro' | 'road' | Kind => (k === 'bus' || k === 'minibus' ? 'road' : k);

export const structureOf = (it: Itinerary): Kind[] => transitLegs(it).map(kindOf);

type Place = { name: string; stopId: string | null; lat: number; lon: number };

/** Straight-line metres; fine at city scale. */
const metres = (a: Place, b: Place): number => {
  const k = Math.PI / 180;
  const x = (b.lon - a.lon) * k * Math.cos(((a.lat + b.lat) / 2) * k);
  const y = (b.lat - a.lat) * k;
  return Math.hypot(x, y) * 6_371_000;
};

/**
 * Same way to travel: as many rides, the same family on every ride (road
 * (bus or minibus) or metro), the same stops on every ride except at most one whose
 * boarding and alighting stops are each within NEAR_M of the other's.
 */
export const sameWay = (a: Itinerary, b: Itinerary): boolean => {
  const x = transitLegs(a);
  const y = transitLegs(b);
  if (x.length !== y.length) return false;
  let near = 0;
  for (let i = 0; i < x.length; i++) {
    if (x[i].mode !== y[i].mode || family(kindOf(x[i])) !== family(kindOf(y[i]))) return false;
    if (stopKey(x[i].from) === stopKey(y[i].from) && stopKey(x[i].to) === stopKey(y[i].to)) continue;
    if (metres(x[i].from, y[i].from) > NEAR_M || metres(x[i].to, y[i].to) > NEAR_M) return false;
    near++;
  }
  return near <= 1;
};

const lineOf = (l: PlanLeg): LineRef => ({ label: l.route?.shortName ?? l.mode, kind: kindOf(l) });

/** One itinerary as a chain of single lines. */
export const chainOf = (it: Itinerary): Slot[] => transitLegs(it).map((l) => [lineOf(l)]);

export interface Way {
  key: string;
  /** The ways to do it, earliest arrival first. */
  its: Itinerary[];
  /** Per ride, every line that can do it (the best itinerary's line first). */
  slots: Slot[];
}

/** The lines that can do each ride of `it`, taken from every itinerary of the same way. */
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

/** THE grouping: itineraries into ways (see sameWay), best (earliest arrival, then latest leave) first. */
export function groupWays(all: Itinerary[], bufferMin = 0): Way[] {
  const best = (a: Itinerary, b: Itinerary) => Date.parse(a.arriveAt) - Date.parse(b.arriveAt) || leaveAt(b, bufferMin) - leaveAt(a, bufferMin);
  // The same lines at the same stops can show up at different times: keep the best of each, so nothing is listed twice.
  // The same lines from other stops are another way (a hand-built route must not be pushed out by a look-alike).
  const seen = new Set<string>();
  const distinct = [...all].sort(best).filter((it) => {
    const k = transitLegs(it).map((l) => `${lineOf(l).label}@${stopKey(l.from)}>${stopKey(l.to)}`).join('|');
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

/** A way in words, the same in the app and for the model: "direct 302", "321|335 -> metro 1", "minibus 518 -> metro 1". */
export const wayLabel = (slots: Slot[]): string => {
  const ride = (s: Slot) => `${s[0]?.kind === 'metro' ? 'metro ' : s.length && s.every((l) => l.kind === 'minibus') ? 'minibus ' : ''}${s.map((l) => l.label).join('|')}`;
  if (slots.length === 0) return 'walk';
  if (slots.length === 1) return `direct ${ride(slots[0])}`;
  return slots.map(ride).join(' -> ');
};

/**
 * Does `text` name this way? Rides split on "->" or ">", lines on "|", "," or
 * spaces; "direct", "metro", "bus", "minibus" are ignored. Same number of rides,
 * and each named ride has at least one of the way's lines.
 */
export function namesWay(way: Pick<Way, 'slots'>, text: string): boolean {
  const rides = text
    .split(/->|>|→/)
    .map((r) => r.split(/[|,\s/]+/).map((t) => t.trim()).filter((t) => t && !/^(direct|metro|bus|minibus|line|then)$/i.test(t)))
    .filter((r) => r.length);
  if (rides.length !== way.slots.length) return false;
  return rides.every((names, i) => names.some((n) => way.slots[i].some((l) => l.label.toLowerCase() === n.toLowerCase())));
}

// --- Kept ways ---

/** What the server takes per ride (store and /plan/journey schemas). */
const MAX_STOPS = 8;
const MAX_ROUTES = 20;

/**
 * THE way-to-steps function: the rides of `it` with every variation of each
 * from `all` (same way, see sameWay): their boarding and alighting stops (the
 * picked itinerary's first) and all their lines, every one allowed. Undefined
 * when a ride has no stop id.
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

// A trip may keep several ways: the rider ticks every row they'd take, and the
// trip plans each ticked way on its own and nothing else. `steps` stays the
// first one, so trips saved before this, older app versions and the server
// (alerts plan with `steps`) keep working; `ways` is only stored when more
// than one is ticked.

/** The ways a trip keeps (empty: the app picks from every line). */
export const tripWays = (t: { steps?: RideStep[]; ways?: RideStep[][] }): RideStep[][] => (t.ways?.length ? t.ways : t.steps?.length ? [t.steps] : []);

/** The trip fields for a set of kept ways: the first as `steps`, the whole list as `ways` when there are several. */
export const waysFields = (ways: RideStep[][]): { steps: RideStep[] | undefined; ways: RideStep[][] | undefined } => ({
  steps: ways[0],
  ways: ways.length > 1 ? ways : undefined,
});

/**
 * A kept way as a chain of rides without a plan: per ride the lines it allows
 * (`lines`, narrowed to `routes` when the rider switched some off). Steps that
 * only carry route numbers (older trips) take the kind of road ride; a ride
 * that names no line comes out empty.
 */
export const stepSlots = (steps: RideStep[]): Slot[] =>
  steps.map((s) => {
    const lines: LineRef[] = s.lines?.length ? s.lines : (s.routes ?? []).map((label) => ({ label, kind: 'bus' as Kind }));
    return s.routes?.length ? lines.filter((l) => s.routes!.includes(l.label)) : [...lines];
  });

/**
 * True when `it` rides exactly the kept way `steps`: as many rides, each from
 * one of its stops, to one of its stops, on one of its lines, and of a kind the
 * ride has (when the step knows its lines).
 */
export function fitsWay(steps: RideStep[], it: Itinerary): boolean {
  const legs = transitLegs(it);
  if (legs.length !== steps.length) return false;
  return legs.every((l, i) => {
    const s = steps[i];
    if (!l.from.stopId || !l.to.stopId || !s.fromStops.includes(l.from.stopId) || !s.toStops.includes(l.to.stopId)) return false;
    if (s.lines?.length && !s.lines.some((x) => family(x.kind) === family(kindOf(l)))) return false;
    return !s.routes?.length || (!!l.route?.shortName && s.routes.includes(l.route.shortName));
  });
}

/** A row is ticked when one of its itineraries is a kept way. */
export const isTicked = (way: Way, kept: RideStep[][]): boolean => way.its.some((it) => kept.some((k) => fitsWay(k, it)));

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

/**
 * A way built (or rebuilt) in the hand builder joins the kept ways as an ordinary
 * way: it takes the place of the first one, which the builder edits; the others
 * stay, minus any copy of it.
 */
export function withBuiltWay(kept: RideStep[][], built: RideStep[]): RideStep[][] {
  const same = JSON.stringify(built);
  return [built, ...kept.slice(1).filter((w) => JSON.stringify(w) !== same)];
}

/** The way the app would take now (the one holding choose()'s pick), else the first. */
export function bestWay(ways: Way[], arriveByLocal: string, now: number, bufferMin = 0): Way | undefined {
  const c = choose(ways.flatMap((w) => w.its), arriveByLocal, now, bufferMin);
  return (c.kind === 'none' ? undefined : ways.find((w) => w.its.includes(c.it))) ?? ways[0];
}

/**
 * The ways a chat card starts with ticked: the card's own (the server ticked
 * them), else a hand-built route's rides, else the plan's (its hand-built steps,
 * or the best way). Empty only when there is no plan yet.
 */
export function cardKept(card: { ways?: RideStep[][]; steps?: RideStep[]; plan?: PlanResponse | null }, now: number, bufferMin = 0): RideStep[][] {
  if (card.ways?.length) return card.ways;
  if (card.steps?.length) return [card.steps];
  if (!card.plan) return [];
  if (card.plan.query.steps?.length) return [card.plan.query.steps];
  return defaultKept(card.plan.itineraries, card.plan.query.arriveBy, now, bufferMin);
}

/**
 * The ways to keep when a plan is saved and nothing is ticked yet: the ways
 * `names` name (see namesWay), else the best way alone, so a saved trip always
 * keeps a way and never falls back to "any route".
 */
export function defaultKept(its: Itinerary[], arriveByLocal: string, now: number, bufferMin = 0, names: string[] = []): RideStep[][] {
  const ways = groupWays(its, bufferMin);
  const named = ways.filter((w) => names.some((n) => namesWay(w, n)));
  const picked = named.length ? named : [bestWay(ways, arriveByLocal, now, bufferMin)].filter((w): w is Way => !!w);
  return picked.flatMap((w) => {
    const steps = variantSteps(w.its[0], its);
    return steps ? [steps] : [];
  });
}

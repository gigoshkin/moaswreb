import type { Itinerary } from '@transit/shared';
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

import type { Itinerary } from '@transit/shared';
import type { LineRef, Slot } from '../ui/LineChain';
import { kindOf, leaveAt, transitLegs } from './plans';

// Itineraries that ride between the same stops on different lines are the same
// way to travel with different numbers: "any of 541, 551, 558". Itineraries
// that change between lines are a sequence. A "way" groups the first kind.

const stopKey = (p: { name: string; stopId: string | null }) => p.stopId ?? p.name;

/** The rides of an itinerary as boarding and alighting stops: same key, same way. */
export const wayKey = (it: Itinerary): string =>
  transitLegs(it)
    .map((l) => `${stopKey(l.from)}>${stopKey(l.to)}`)
    .join('|');

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

const sameRides = (a: Itinerary, b: Itinerary) => wayKey(a) === wayKey(b);

/** The lines that can do each ride of `it`, taken from every itinerary over the same stops. */
export const slotsFor = (it: Itinerary, all: Itinerary[]): Slot[] => {
  const slots = chainOf(it);
  for (const other of all) {
    if (other === it || !sameRides(it, other)) continue;
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
  const groups = new Map<string, Itinerary[]>();
  for (const it of distinct) groups.set(wayKey(it), [...(groups.get(wayKey(it)) ?? []), it]);
  return [...groups.entries()].map(([key, its]) => ({ key, its, slots: slotsFor(its[0], its) })).sort((a, b) => best(a.its[0], b.its[0]));
}

import type { Itinerary, Slot } from '@transit/shared';
import { choose, leaveAt } from './plans';
import { fitsWay, isOwn, slotsFor, stepSlots, type RideStep } from './ways';

/** One kept way of a trip as the trip form lists it: its chain, and its times once a plan has it. */
export interface KeptRow {
  key: string;
  slots: Slot[];
  /** The option of this way the app would take (the plan's pick, else its first). Null until the plan has one. */
  it: Itinerary | null;
  leave: number | null;
  late: boolean;
  /** The rider's own route (built by hand or described in chat). */
  own: boolean;
}

/**
 * A row per kept way, in the order they were kept. The chain is the way's own
 * steps (the lines it allows on each ride), so it shows before any plan; a ride
 * whose step names no line takes the lines of the plan's option for that way.
 */
export function keptRows(kept: RideStep[][], itineraries: Itinerary[], arriveByLocal: string, now: number, bufferMin = 0): KeptRow[] {
  return kept.map((steps, i) => {
    const fits = itineraries.filter((it) => fitsWay(steps, it));
    const c = choose(fits, arriveByLocal, now, bufferMin);
    const it = c.kind === 'none' ? (fits[0] ?? null) : c.it;
    const planned = it ? slotsFor(it, fits) : null;
    const slots = stepSlots(steps).map((s, r) => (s.length ? s : (planned?.[r] ?? s)));
    return {
      key: `${i}:${steps.map((s) => `${s.fromStops[0]}>${s.toStops[0]}`).join('|')}`,
      slots,
      it,
      leave: it ? leaveAt(it, bufferMin) : null,
      late: c.kind === 'late',
      own: isOwn(steps),
    };
  });
}

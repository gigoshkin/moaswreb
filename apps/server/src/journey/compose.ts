import type { JourneyStep, LatLon, PlanAvoid } from '@transit/shared';
import { raptor, type Journey, type RaptorNetwork, type RideRule } from './raptor.ts';
import type { PatternRef } from './source.ts';

// A route the rider describes in their own words, "321, 335 or 518 to
// Sarajishvili, then the metro", turned into planner steps. TTC's and Google's
// planners never return such a route when a direct bus is quicker, so it is
// searched for directly: the network search with exactly those rides.

export interface RideSpec {
  /** Lines that can do this ride, e.g. ["321", "335", "518"]. Empty: any line of the mode. */
  lines?: string[];
  mode?: 'BUS' | 'SUBWAY' | 'GONDOLA';
  /** Stops to get off at (ids); empty: wherever suits the next ride. */
  getOffAt?: string[];
}

export interface Composed {
  steps: JourneyStep[];
  journey: Journey;
}

/** The network with what the search needs; TtcSource is one. */
export interface NetworkView extends RaptorNetwork {
  ready: boolean;
}

/** A ride on "the metro" with no line named may need a change between metro lines (1 ↔ 2 at Station Square). */
const expand = (rides: RideSpec[]): RideSpec[][] => {
  let out: RideSpec[][] = [[]];
  for (const r of rides) {
    const alone = [r];
    const anyMetro = r.mode === 'SUBWAY' && !r.lines?.length;
    // The first metro ride gets off at the change; only the second keeps the rider's get-off stop.
    const twice = anyMetro ? [{ mode: 'SUBWAY' as const }, r] : null;
    out = out.flatMap((seq) => [[...seq, ...alone], ...(twice ? [[...seq, ...twice]] : [])]);
  }
  return out.filter((seq) => seq.length <= 6);
};

const ruleOf = (r: RideSpec): RideRule => ({
  allow: (p: PatternRef) => (!r.mode || p.mode === r.mode) && (!r.lines?.length || r.lines.includes(p.shortName)),
  ...(r.getOffAt?.length ? { alightAt: new Set(r.getOffAt) } : {}),
});

/**
 * The latest-leaving journey that rides exactly as described and arrives by
 * the deadline, as steps (with the stops beside each found stop, from
 * `siblings`, so the way's variations are kept). Null when no such journey
 * exists in the timetables.
 */
export async function composeRoute(
  net: NetworkView,
  q: { from: LatLon; to: LatLon; deadline: number; rides: RideSpec[]; avoid?: PlanAvoid },
  siblings: (stopId: string, at: LatLon, mode: string) => Promise<string[]>,
): Promise<Composed | null> {
  if (!net.ready || !q.rides.length) return null;
  let best: { j: Journey; seq: RideSpec[] } | null = null;
  for (const seq of expand(q.rides)) {
    const [j] = await raptor(net, { from: q.from, to: q.to, deadline: q.deadline, avoid: q.avoid, sequence: seq.map(ruleOf) });
    // Later leave wins; on a tie, fewer rides.
    if (j && (!best || j.leave > best.j.leave || (j.leave === best.j.leave && seq.length < best.seq.length))) best = { j, seq };
  }
  if (!best) return null;
  const { j, seq } = best;
  const steps = await Promise.all(
    j.rides.map(async (r, i) => {
      const board = r.p.stops[r.b];
      const alight = r.p.stops[r.a];
      const lines = seq[i].lines;
      return {
        fromStops: await siblings(board.id, board, r.p.mode),
        toStops: seq[i].getOffAt?.length ? [alight.id, ...seq[i].getOffAt!.filter((s) => s !== alight.id)].slice(0, 8) : await siblings(alight.id, alight, r.p.mode),
        ...(lines?.length ? { routes: lines } : {}),
      };
    }),
  );
  return { steps, journey: j };
}

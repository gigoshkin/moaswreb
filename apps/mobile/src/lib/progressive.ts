import { mergePlans, type PlanResponse } from '@transit/shared';

// A first search of a new area is slow on the server (its own planner loads
// timetables), so a plan arrives in two steps: TTC's planner first (the server
// marks it `partial`), then the full plan. These are the pure rules for what
// shows between and after them; the hooks only gather the answers.

/** What is known about one query: its full plan, its quick part, and its last full plan on the phone. */
export interface QueryPlans {
  full?: PlanResponse | null;
  partial?: PlanResponse | null;
  cached?: PlanResponse | null;
}

/**
 * The plan to show for several queries (a trip's kept ways) as one. Per query,
 * in order of preference: the full plan; the plan cached on the phone (a quick
 * part never replaces it, so a list that was on screen does not shrink and grow
 * again); the quick part. `partial` is true while any query shows only its
 * quick part, so a consumer knows the full plan is still to come.
 */
export function composePlans(queries: QueryPlans[]): { plan: PlanResponse | null; partial: boolean } {
  let partial = false;
  const plans = queries.flatMap((q) => {
    if (q.full) return [q.full];
    if (q.cached) return [q.cached];
    if (q.partial) {
      partial = true;
      return [q.partial];
    }
    return [];
  });
  return { plan: mergePlans(plans), partial };
}

/**
 * `next` with every itinerary that is unchanged from `prev` kept as the very
 * same object, so rows keyed by id (and memos on them) do not redo work or
 * flicker when the full plan replaces the quick one. Ids already are the same
 * for the same ride (departure time and lines); a changed one is replaced.
 */
export function reuseItineraries(prev: PlanResponse | null, next: PlanResponse | null): PlanResponse | null {
  if (!prev || !next) return next;
  const old = new Map(prev.itineraries.map((it) => [it.id, it]));
  let same = prev.itineraries.length === next.itineraries.length;
  const itineraries = next.itineraries.map((it, i) => {
    const o = old.get(it.id);
    const keep = o && JSON.stringify(o) === JSON.stringify(it) ? o : it;
    if (keep !== prev.itineraries[i]) same = false;
    return keep;
  });
  if (same && prev.partial === next.partial && prev.fetchedAt === next.fetchedAt) return prev;
  return { ...next, itineraries };
}

/**
 * Whether a response is the quick part. A server that predates `part=ttc`
 * ignores it and answers in full, without the flag, so that answer is final.
 */
export const isPartial = (p: PlanResponse): boolean => p.partial === true;

/**
 * Asks for the quick part and the full plan at once. The quick part goes to
 * `onPartial` if it is in before the full plan; it never settles the result
 * unless the server answered it in full (an older server ignores `part=ttc`),
 * in which case that answer, once in, is the result. A quick request that
 * fails changes nothing. If the full request fails, the quick answer still
 * on its way is awaited (and delivered) before the failure is raised, and a
 * full answer to the quick request stands in for it.
 */
export async function progressivePlan(
  quick: () => Promise<PlanResponse>,
  full: () => Promise<PlanResponse>,
  onPartial: (plan: PlanResponse) => void,
): Promise<PlanResponse> {
  let done = false;
  const asked = quick().then(
    (r) => {
      if (done) return null;
      if (isPartial(r)) {
        onPartial(r);
        return null;
      }
      return r;
    },
    () => null,
  );
  const whole = full();
  const quickWhole = asked.then((r) => r ?? new Promise<never>(() => {}));
  try {
    return await Promise.race([whole, quickWhole]);
  } catch (err) {
    const fallback = await asked;
    if (!fallback) throw err;
    return fallback;
  } finally {
    done = true;
  }
}

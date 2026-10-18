import type { PlanQuery, PlanResponse } from '@transit/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { samplePlan } from '../dev/samplePlan';
import { cachedPlan, fetchPlan, hasApi } from './api';
import { mergePlans } from './plans';
import { composePlans, reuseItineraries } from './progressive';

interface PlanState {
  plan: PlanResponse | null;
  /** True while a network request is in flight (the cached plan stays on screen). */
  refreshing: boolean;
  /**
   * True while the plan shown is only the quick part (TTC's planner) and the full plan is still on its way;
   * `refreshing` is true too. Anything that acts on the plan (a late retry, a "plan changed" note) should wait for it to end.
   */
  partial: boolean;
  error: string | null;
  /** True when the plan is synthetic because no API URL is configured. */
  sample: boolean;
  refresh: () => void;
}

// Each query is cached on its own, so a way that failed this time shows its last plan.
const cachedAll = (queries: PlanQuery[]) => mergePlans(queries.flatMap((q) => cachedPlan(q) ?? []));
const initial = (queries: PlanQuery[] | null) => (!queries?.length ? null : hasApi ? cachedAll(queries) : samplePlan());

/**
 * Cache first, then network: the last plan for this query shows instantly,
 * then gets replaced by a fresh one. `refreshMs` re-plans on a timer and when
 * the app comes back to the foreground (the Today hero). A null query does
 * nothing. Without EXPO_PUBLIC_API_URL it shows synthetic sample data.
 */
export function usePlan(query: PlanQuery | null, opts: { refreshMs?: number } = {}): PlanState {
  return usePlans(query ? [query] : null, opts);
}

/**
 * usePlan for several queries at once (a trip with several kept ways): one
 * request each, in parallel, merged into one plan (mergePlans). A query that
 * fails falls back to its cached plan; the error shows only when all fail.
 *
 * A plan of the planner's own (no hand-built steps) that has nothing cached is
 * shown as soon as the server's quick part answers (`partial`), then replaced
 * by the full plan; `refreshing` stays on until then. A cached plan is never
 * swapped for the quick part, and the quick part is never cached.
 */
export function usePlans(queries: PlanQuery[] | null, { refreshMs }: { refreshMs?: number } = {}): PlanState {
  const key = queries?.length ? JSON.stringify(queries) : '';
  const [plan, setPlan] = useState<PlanResponse | null>(() => initial(queries));
  const [refreshing, setRefreshing] = useState(false);
  const [partial, setPartial] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only the latest request may update state; an older one finishing late is dropped.
  const latest = useRef(0);
  const queryRef = useRef(queries);
  queryRef.current = queries;

  const refresh = useCallback(() => {
    const qs = queryRef.current;
    if (!hasApi || !qs?.length) return;
    const id = ++latest.current;
    setRefreshing(true);
    setError(null);
    const fulls: (PlanResponse | null)[] = qs.map(() => null);
    const partials: (PlanResponse | null)[] = qs.map(() => null);
    // What shows: each query's full plan, else its cached one, else its quick part.
    const show = () => {
      const shown = composePlans(qs.map((q, i) => ({ full: fulls[i], partial: partials[i], cached: cachedPlan(q) })));
      setPlan((prev) => reuseItineraries(prev, shown.plan));
      setPartial(shown.partial);
    };
    Promise.allSettled(
      qs.map((q, i) =>
        fetchPlan(q, {
          onPartial: (p) => {
            if (id !== latest.current) return;
            partials[i] = p;
            show();
          },
        }).then((p) => (fulls[i] = p)),
      ),
    )
      .then((rs) => {
        if (id !== latest.current) return;
        const failed = rs.find((r): r is PromiseRejectedResult => r.status === 'rejected');
        // Only when every plan failed and not even a quick part came: the error, with the cached plan still on screen.
        if (failed && rs.every((r) => r.status === 'rejected') && !partials.some(Boolean)) return setError((failed.reason as Error)?.message ?? 'Plan failed');
        show();
      })
      .finally(() => {
        if (id !== latest.current) return;
        // Done: whatever shows now is all there will be (a failed full plan leaves its quick part as the answer).
        setPartial(false);
        setRefreshing(false);
      });
  }, []);

  useEffect(() => {
    setPlan(initial(queries));
    setPartial(false);
    refresh();
    // key captures the queries.
  }, [key]);

  useEffect(() => {
    if (!refreshMs || !key) return;
    const timer = setInterval(refresh, refreshMs);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [refreshMs, key]);

  return { plan, refreshing, partial, error, sample: !hasApi, refresh };
}

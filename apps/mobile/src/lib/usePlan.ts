import type { PlanQuery, PlanResponse } from '@transit/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { samplePlan } from '../dev/samplePlan';
import { cachedPlan, fetchPlan, hasApi } from './api';
import { mergePlans } from './plans';

interface PlanState {
  plan: PlanResponse | null;
  /** True while a network request is in flight (the cached plan stays on screen). */
  refreshing: boolean;
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
 */
export function usePlans(queries: PlanQuery[] | null, { refreshMs }: { refreshMs?: number } = {}): PlanState {
  const key = queries?.length ? JSON.stringify(queries) : '';
  const [plan, setPlan] = useState<PlanResponse | null>(() => initial(queries));
  const [refreshing, setRefreshing] = useState(false);
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
    Promise.allSettled(qs.map(fetchPlan))
      .then((rs) => {
        if (id !== latest.current) return;
        const failed = rs.find((r): r is PromiseRejectedResult => r.status === 'rejected');
        if (failed && rs.every((r) => r.status === 'rejected')) return setError((failed.reason as Error)?.message ?? 'Plan failed');
        setPlan(mergePlans(rs.flatMap((r, i) => (r.status === 'fulfilled' ? [r.value] : (cachedPlan(qs[i]) ?? [])))));
      })
      .finally(() => id === latest.current && setRefreshing(false));
  }, []);

  useEffect(() => {
    setPlan(initial(queries));
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

  return { plan, refreshing, error, sample: !hasApi, refresh };
}

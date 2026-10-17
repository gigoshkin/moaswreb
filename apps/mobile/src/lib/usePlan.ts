import type { PlanQuery, PlanResponse } from '@transit/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { samplePlan } from '../dev/samplePlan';
import { cachedPlan, fetchPlan, hasApi } from './api';

interface PlanState {
  plan: PlanResponse | null;
  /** True while a network request is in flight (the cached plan stays on screen). */
  refreshing: boolean;
  error: string | null;
  /** True when the plan is synthetic because no API URL is configured. */
  sample: boolean;
  refresh: () => void;
}

const initial = (query: PlanQuery | null) => (!query ? null : hasApi ? cachedPlan(query) : samplePlan());

/**
 * Cache first, then network: the last plan for this query shows instantly,
 * then gets replaced by a fresh one. `refreshMs` re-plans on a timer and when
 * the app comes back to the foreground (the Today hero). A null query does
 * nothing. Without EXPO_PUBLIC_API_URL it shows synthetic sample data.
 */
export function usePlan(query: PlanQuery | null, { refreshMs }: { refreshMs?: number } = {}): PlanState {
  const key = query ? JSON.stringify(query) : '';
  const [plan, setPlan] = useState<PlanResponse | null>(() => initial(query));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only the latest request may update state; an older one finishing late is dropped.
  const latest = useRef(0);
  const queryRef = useRef(query);
  queryRef.current = query;

  const refresh = useCallback(() => {
    const q = queryRef.current;
    if (!hasApi || !q) return;
    const id = ++latest.current;
    setRefreshing(true);
    setError(null);
    fetchPlan(q)
      .then((p) => id === latest.current && setPlan(p))
      .catch((e: Error) => id === latest.current && setError(e.message))
      .finally(() => id === latest.current && setRefreshing(false));
  }, []);

  useEffect(() => {
    setPlan(initial(query));
    refresh();
    // key captures query.
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

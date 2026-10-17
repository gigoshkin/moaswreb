import type { PlanQuery, PlanResponse } from '@transit/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
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

/**
 * Cache first, then network: the last plan for this query shows instantly,
 * then gets replaced by a fresh one. Without EXPO_PUBLIC_API_URL it shows
 * synthetic sample data so the app still runs.
 */
export function usePlan(query: PlanQuery): PlanState {
  const key = JSON.stringify(query);
  const [plan, setPlan] = useState<PlanResponse | null>(() => (hasApi ? cachedPlan(query) : samplePlan()));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only the latest request may update state; an older one finishing late is dropped.
  const latest = useRef(0);

  const refresh = useCallback(() => {
    if (!hasApi) return;
    const id = ++latest.current;
    setRefreshing(true);
    setError(null);
    fetchPlan(query)
      .then((p) => id === latest.current && setPlan(p))
      .catch((e: Error) => id === latest.current && setError(e.message))
      .finally(() => id === latest.current && setRefreshing(false));
    // key captures query.
  }, [key]);

  useEffect(() => {
    setPlan(hasApi ? cachedPlan(query) : samplePlan());
    refresh();
  }, [key]);

  return { plan, refreshing, error, sample: !hasApi, refresh };
}

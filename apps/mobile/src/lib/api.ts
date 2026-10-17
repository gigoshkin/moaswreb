import type { ApiError, PlanQuery, PlanResponse } from '@transit/shared';
import { readCache, writeCache } from './cache';

const BASE = process.env.EXPO_PUBLIC_API_URL ?? '';

export const hasApi = BASE !== '';

const planKey = (q: PlanQuery) => `plan:${JSON.stringify(q)}`;

/** Last plan for this query from the device cache, for instant start. */
export const cachedPlan = (q: PlanQuery): PlanResponse | null => readCache<PlanResponse>(planKey(q));

export async function fetchPlan(q: PlanQuery): Promise<PlanResponse> {
  const params = new URLSearchParams({
    from: `${q.from.lat},${q.from.lon}`,
    to: `${q.to.lat},${q.to.lon}`,
    arriveBy: q.arriveBy,
  });
  if (q.modes) params.set('modes', q.modes.join(','));
  if (q.optimize) params.set('optimize', q.optimize);
  if (q.locale) params.set('locale', q.locale);

  const res = await fetch(`${BASE}/plan?${params}`);
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as ApiError | null;
    throw new Error(err?.message ?? `HTTP ${res.status}`);
  }
  const body = (await res.json()) as PlanResponse;
  writeCache(planKey(q), body);
  return body;
}

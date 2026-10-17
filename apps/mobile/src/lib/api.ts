import type { ApiError, PlanQuery, PlanResponse, StoredTrip } from '@transit/shared';
import { readCache, writeCache } from './cache';
import { deviceId } from './device';

const BASE = process.env.EXPO_PUBLIC_API_URL ?? '';
const KEY = process.env.EXPO_PUBLIC_API_KEY ?? '';

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

const me = async (method: 'PUT' | 'DELETE', path: string, body?: unknown): Promise<void> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      'x-device-id': deviceId(),
      ...(KEY ? { authorization: `Bearer ${KEY}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
};

/** Replace this device's trips on the server (stops and times only). */
export const syncTrips = (trips: StoredTrip[]) => me('PUT', '/me/trips', { trips });

export const registerPushToken = (token: string) => me('PUT', '/me/push', { token });

/** The delete-all button: removes this device's trips and push token from the server. */
export const deleteMyData = () => me('DELETE', '/me');

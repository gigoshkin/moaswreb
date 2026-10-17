import type {
  ApiError,
  ArrivalsResponse,
  ChatRequest,
  ChatResponse,
  Locale,
  NearStopsResponse,
  PlaceHit,
  ReversePlaceResponse,
  PlanQuery,
  PlanResponse,
  StopHit,
  StoredTrip,
  TripsPayload,
} from '@transit/shared';
import { readCache, writeRecent } from './cache';
import { deviceId } from './device';

const BASE = process.env.EXPO_PUBLIC_API_URL ?? '';
// Ships inside the app, so it's not a secret; the server's rate limits do the real work.
const KEY = process.env.EXPO_PUBLIC_API_KEY ?? '';

export const hasApi = BASE !== '';

const TIMEOUT_MS = 15_000;
const CHAT_TIMEOUT_MS = 90_000; // the assistant may call several tools
// The server's own planner may load timetables for a new area (up to ~25 s) before it answers.
const PLAN_TIMEOUT_MS = 40_000;

/** Server error with its machine-readable code (`rate_limited`, `upstream`, `unknown_stop`, …). */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface Options {
  method?: 'GET' | 'PUT' | 'POST' | 'DELETE';
  body?: unknown;
  /** Sends x-device-id (the /me routes). */
  device?: boolean;
  timeoutMs?: number;
}

async function request<T>(path: string, { method = 'GET', body, device = false, timeoutMs = TIMEOUT_MS }: Options = {}): Promise<T> {
  // AbortController + timer rather than AbortSignal.timeout, which Hermes may lack.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(device ? { 'x-device-id': deviceId() } : {}),
        ...(KEY ? { authorization: `Bearer ${KEY}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: abort.signal,
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as ApiError | null;
      throw new ApiRequestError(res.status, err?.error ?? 'http', err?.message ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (abort.signal.aborted) throw new ApiRequestError(0, 'timeout', 'The server took too long to answer');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const qs = (params: Record<string, string | number | undefined>) =>
  new URLSearchParams(Object.entries(params).flatMap(([k, v]) => (v === undefined ? [] : [[k, String(v)]]))).toString();

// --- trip planning ---

const planKey = (q: PlanQuery) => `plan:${JSON.stringify(q)}`;

/** Last plan for this query from the device cache, for instant start. */
export const cachedPlan = (q: PlanQuery): PlanResponse | null => readCache<PlanResponse>(planKey(q));

/** Itineraries arriving by `q.arriveBy` (Tbilisi `YYYY-MM-DDTHH:mm`). Cached on the phone (last 30 queries). */
export async function fetchPlan(q: PlanQuery): Promise<PlanResponse> {
  // A hand-built route goes as a body; the planner's own search is a plain GET.
  const body = q.steps?.length
    ? await request<PlanResponse>('/plan/journey', {
        method: 'POST',
        timeoutMs: PLAN_TIMEOUT_MS,
        body: { from: q.from, to: q.to, arriveBy: q.arriveBy, steps: q.steps, avoid: q.avoid, locale: q.locale },
      })
    : await request<PlanResponse>(
        `/plan?${qs({
          from: `${q.from.lat},${q.from.lon}`,
          to: `${q.to.lat},${q.to.lon}`,
          arriveBy: q.arriveBy,
          modes: q.modes?.join(','),
          optimize: q.optimize,
          locale: q.locale,
          avoid: q.avoid?.routes?.length ? q.avoid.routes.join(',') : undefined,
          avoidMinibus: q.avoid?.minibus ? 'true' : undefined,
        })}`,
        { timeoutMs: PLAN_TIMEOUT_MS },
      );
  writeRecent('plans', planKey(q), body);
  return body;
}

// --- stops and places (Today countdown, Add-trip pickers) ---

/** Stops by name (ka or en) or stop code. */
export const searchStops = async (q: string, locale: Locale = 'en', limit = 5): Promise<StopHit[]> =>
  (await request<{ stops: StopHit[] }>(`/stops?${qs({ q, locale, limit })}`)).stops;

/** Closest stops to a point, nearest first, with `distanceM`. */
export const nearStops = async (
  p: { lat: number; lon: number },
  opts: { radiusM?: number; limit?: number; mode?: 'BUS' | 'SUBWAY' | 'GONDOLA'; locale?: Locale } = {},
): Promise<NearStopsResponse['stops']> =>
  (await request<NearStopsResponse>(`/stops/near?${qs({ lat: p.lat, lon: p.lon, radius: opts.radiusM, limit: opts.limit, mode: opts.mode, locale: opts.locale })}`)).stops;

/** Live countdown at a stop, soonest first. */
export const fetchArrivals = (stopId: string, locale: Locale = 'en'): Promise<ArrivalsResponse> =>
  request<ArrivalsResponse>(`/stops/${encodeURIComponent(stopId)}/arrivals?${qs({ locale })}`);

/** Addresses and landmarks in Tbilisi. */
export const searchPlaces = async (q: string, locale: Locale = 'en', limit = 5): Promise<PlaceHit[]> =>
  (await request<{ places: PlaceHit[] }>(`/places?${qs({ q, locale, limit })}`)).places;

/** The address at a point (for the map pin), or null when OSM has nothing close. */
export const reversePlace = async (p: { lat: number; lon: number }): Promise<PlaceHit | null> =>
  (await request<ReversePlaceResponse>(`/places/reverse?${qs({ lat: p.lat, lon: p.lon })}`)).place;

// --- chat ---

/** One chat turn: a short reply plus action cards (plans, arrivals, stops, trips/events to confirm). */
export const sendChat = (req: ChatRequest): Promise<ChatResponse> =>
  request<ChatResponse>('/chat', { method: 'POST', body: req, device: true, timeoutMs: CHAT_TIMEOUT_MS });

// --- this device's data on the server (alerts) ---

/** Replace this device's trips on the server (stops and times only). */
export const syncTrips = (trips: StoredTrip[]) => request<unknown>('/me/trips', { method: 'PUT', body: { trips }, device: true });

/** What the server holds for this device, e.g. to show on a privacy screen. */
export const fetchMyTrips = async (): Promise<StoredTrip[]> => (await request<TripsPayload>('/me/trips', { device: true })).trips;

export const registerPushToken = (token: string) => request<unknown>('/me/push', { method: 'PUT', body: { token }, device: true });

/** The delete-all button: removes this device's trips and push token from the server. */
export const deleteMyData = () => request<unknown>('/me', { method: 'DELETE', device: true });

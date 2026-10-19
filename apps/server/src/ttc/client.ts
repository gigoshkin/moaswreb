import { AsyncLocalStorage } from 'node:async_hooks';
import { config } from '../config.ts';
import type {
  ArrivalTime,
  RawGeocode,
  RawPlan,
  RouteDetail,
  RoutePositions,
  RouteStop,
  RouteSummary,
  ScheduleBlock,
  Stop,
} from './types.ts';

type Params = Record<string, string | number | boolean | undefined>;
export type Locale = 'ka' | 'en';

export class TtcError extends Error {
  readonly status: number;
  readonly path: string;

  constructor(status: number, path: string, body: string) {
    super(`TTC ${status} on ${path}: ${body.slice(0, 200)}`);
    this.status = status;
    this.path = path;
  }
}

/** The request queue is full; thrown without calling TTC. */
export class TtcBusyError extends Error {
  constructor() {
    super('TTC request queue is full');
  }
}

/** HTTP status for our caller when TTC fails: 502 if TTC rejected the request, 503 if it's down or throttling us. */
export const upstreamFailed = (err: unknown): 502 | 503 =>
  err instanceof TtcError && err.status < 500 && err.status !== 429 ? 502 : 503;

/** Requests started inside `TtcClient.background()` wait behind everyone else's. */
const backgroundScope = new AsyncLocalStorage<true>();

interface Job {
  run: () => void;
}

/** Requests in flight at once; the gap between starts still caps the rate. */
const MAX_IN_FLIGHT = 3;
/** Background work (network refresh, logger) may queue this many; it is never in a hurry. */
const MAX_BACKGROUND_QUEUE = 5000;

/**
 * Client for TTC's PIS gateway. The API key is the one TTC ships to every
 * visitor of transit.ttc.com.ge; we read it from that page at runtime (and
 * again on 401) instead of storing it. Requests start at most one per
 * minIntervalMs (~1.4 req/s). People waiting on an answer go first: work run
 * inside `background()` (network refresh, the data logger) only gets the
 * slots nobody else wants.
 */
export class TtcClient {
  private key: string | null = null;
  private keyLoading: Promise<string> | null = null;
  private readonly urgent: Job[] = [];
  private readonly later: Job[] = [];
  private inFlight = 0;
  private timer: NodeJS.Timeout | null = null;
  private lastRequestAt = 0;
  private consecutiveFailures = 0;

  /** While set, every request waits; set by backoff after throttling or server errors. */
  pausedUntil = 0;
  requests = 0;
  errors = 0;
  lastError: string | null = null;

  /** Runs `fn` with every TTC request it makes queued behind interactive ones. */
  background<T>(fn: () => Promise<T>): Promise<T> {
    return backgroundScope.run(true, fn);
  }

  /** Requests waiting to start (interactive, background). */
  get queued(): { urgent: number; background: number } {
    return { urgent: this.urgent.length, background: this.later.length };
  }

  loadKey(): Promise<string> {
    this.keyLoading ??= this.fetchKey().finally(() => (this.keyLoading = null));
    return this.keyLoading;
  }

  private async fetchKey(): Promise<string> {
    const res = await fetch(config.ttc.siteUrl, {
      headers: { 'User-Agent': config.ttc.userAgent },
    });
    const html = await res.text();
    const match = html.match(/"PIS_GATEWAY_KEY"\s*:\s*"([^"]+)"/);
    if (!match) throw new Error('PIS_GATEWAY_KEY not found on transit.ttc.com.ge');
    this.key = match[1];
    return this.key;
  }

  get hasKey(): boolean {
    return this.key !== null;
  }

  // --- stops (v2) ---
  stops(locale: Locale = 'ka') {
    return this.get<Stop[]>('v2/stops', { locale });
  }

  stopRoutes(stopId: string, locale: Locale = 'ka') {
    return this.get<RouteSummary[]>(`v2/stops/${stopId}/routes`, { locale });
  }

  arrivalTimes(stopId: string, locale: Locale = 'ka') {
    return this.get<ArrivalTime[]>(`v2/stops/${stopId}/arrival-times`, {
      locale,
      ignoreScheduledArrivalTimes: false,
    });
  }

  // --- routes (v3) ---
  routes(locale: Locale = 'ka', modes = 'BUS') {
    return this.get<RouteSummary[]>('v3/routes', { modes, locale });
  }

  route(routeId: string, locale: Locale = 'ka') {
    return this.get<RouteDetail>(`v3/routes/${routeId}`, { locale });
  }

  /** Stops of one pattern, in driving order. */
  routeStops(routeId: string, patternSuffix: string, locale: Locale = 'en') {
    return this.get<RouteStop[]>(`v3/routes/${routeId}/stops`, { patternSuffix, locale });
  }

  /** The full timetable of one pattern: every stop's arrival times, per service-date block. */
  schedule(routeId: string, patternSuffix: string, locale: Locale = 'en') {
    return this.get<ScheduleBlock[]>(`v3/routes/${routeId}/schedule`, { patternSuffix, locale });
  }

  /** The next few vehicles of one route at a stop (the stop-wide list only shows one per route). */
  routeArrivals(stopId: string, routeId: string, locale: Locale = 'en') {
    return this.get<ArrivalTime[]>(`v2/stops/${stopId}/arrival-times`, {
      locale,
      ignoreScheduledArrivalTimes: false,
      routeId,
      maxNumberOfArrivalTimes: 4,
    });
  }

  positions(routeId: string, patternSuffixes: string[]) {
    return this.get<RoutePositions>(`v3/routes/${routeId}/positions`, {
      patternSuffixes: patternSuffixes.join(','),
    });
  }

  // --- geocode (v2) ---
  /** OSM-based place search, limited to Tbilisi (TTC requires the bbox). */
  geocode(query: string, locale: Locale = 'ka') {
    return this.get<RawGeocode>('v2/geocode', {
      query,
      locale,
      bbox: '44.66221063,41.84319686,45.050854455,41.59149226',
    });
  }

  // --- trip planner (v2) ---
  /** `date` is `YYYY-MM-DD` and `time` is `HH:mm`, both Tbilisi local. */
  plan(params: {
    from: { lat: number; lon: number };
    to: { lat: number; lon: number };
    departMode: 'leaveNow' | 'departAt' | 'arriveBy';
    date: string;
    time: string;
    modes: string[];
    optimize: 'quick' | 'lessWalking' | 'fewerTransfers';
    locale?: Locale;
  }) {
    return this.get<RawPlan>('v2/plan', {
      fromPlace: `${params.from.lat},${params.from.lon}`,
      toPlace: `${params.to.lat},${params.to.lon}`,
      departMode: params.departMode,
      date: params.date,
      time: params.time,
      modes: params.modes.join(','),
      optimize: params.optimize,
      locale: params.locale ?? 'ka',
    });
  }

  // --- transport ---
  private get<T>(path: string, params: Params = {}): Promise<T> {
    const low = backgroundScope.getStore() === true;
    const queue = low ? this.later : this.urgent;
    // A full queue would delay every caller (alerts too) by minutes; fail fast instead.
    if (low ? queue.length >= MAX_BACKGROUND_QUEUE : queue.length + this.inFlight >= config.ttc.maxQueue) return Promise.reject(new TtcBusyError());
    return new Promise<T>((resolve, reject) => {
      queue.push({
        run: () => {
          this.inFlight++;
          this.request<T>(path, params, true)
            .then(resolve, reject)
            .finally(() => {
              this.inFlight--;
              this.pump();
            });
        },
      });
      this.pump();
    });
  }

  /** Starts the next request when the gap since the last one has passed: interactive first, then background. */
  private pump(): void {
    if (this.timer || this.inFlight >= MAX_IN_FLIGHT || (!this.urgent.length && !this.later.length)) return;
    const wait = Math.max(this.lastRequestAt + config.ttc.minIntervalMs, this.pausedUntil) - Date.now();
    if (wait > 0) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.pump();
      }, wait);
      return;
    }
    const job = this.urgent.shift() ?? this.later.shift()!;
    this.lastRequestAt = Date.now();
    job.run();
    this.pump();
  }

  private async request<T>(path: string, params: Params, retryOn401: boolean): Promise<T> {
    const key = this.key ?? (await this.loadKey());
    const url = new URL(`${config.ttc.apiBase}/${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    this.requests++;
    try {
      const res = await fetch(url, {
        headers: { 'X-Api-Key': key, 'User-Agent': config.ttc.userAgent, Accept: 'application/json' },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.status === 401 && retryOn401) {
        this.key = null;
        await this.loadKey();
        return this.request<T>(path, params, false);
      }
      if (!res.ok) {
        if (res.status === 403 || res.status === 429 || res.status >= 500) {
          this.backOff(Number(res.headers.get('retry-after')) || 0);
        }
        throw new TtcError(res.status, path, await res.text());
      }
      const data = (await res.json()) as T;
      this.consecutiveFailures = 0;
      return data;
    } catch (err) {
      this.errors++;
      this.lastError = `${new Date().toISOString()} ${(err as Error).message}`;
      if (!(err instanceof TtcError)) this.backOff(0); // network error or timeout
      throw err;
    }
  }

  /**
   * Throttled, blocked or failing: stop all traffic for 30 s, doubling per
   * consecutive failure up to 30 min. Retry-After wins if TTC sends it.
   */
  private backOff(retryAfterSec: number): void {
    this.consecutiveFailures++;
    const exponential = Math.min(30 * 60_000, 30_000 * 2 ** (this.consecutiveFailures - 1));
    this.pausedUntil = Date.now() + Math.max(exponential, retryAfterSec * 1000);
    console.warn(`[ttc] backing off until ${new Date(this.pausedUntil).toISOString()}`);
  }
}

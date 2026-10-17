import { config } from '../config.ts';
import type {
  ArrivalTime,
  RouteDetail,
  RoutePositions,
  RouteSummary,
  Stop,
} from './types.ts';

type Params = Record<string, string | number | boolean | undefined>;
type Locale = 'ka' | 'en';

export class TtcError extends Error {
  readonly status: number;
  readonly path: string;

  constructor(status: number, path: string, body: string) {
    super(`TTC ${status} on ${path}: ${body.slice(0, 200)}`);
    this.status = status;
    this.path = path;
  }
}

/**
 * Client for TTC's PIS gateway. The API key is the one TTC ships to every
 * visitor of transit.ttc.com.ge; we read it from that page at runtime (and
 * again on 401) instead of storing it. All requests go through one queue
 * with a minimum gap, so we never hit TTC harder than ~1.4 req/s.
 */
export class TtcClient {
  private key: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;
  private consecutiveFailures = 0;

  /** While set, every request waits; set by backoff after throttling or server errors. */
  pausedUntil = 0;
  requests = 0;
  errors = 0;
  lastError: string | null = null;

  async loadKey(): Promise<string> {
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

  positions(routeId: string, patternSuffixes: string[]) {
    return this.get<RoutePositions>(`v3/routes/${routeId}/positions`, {
      patternSuffixes: patternSuffixes.join(','),
    });
  }

  // --- transport ---
  private get<T>(path: string, params: Params = {}): Promise<T> {
    const run = () => this.request<T>(path, params, true);
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async request<T>(path: string, params: Params, retryOn401: boolean): Promise<T> {
    const wait = Math.max(this.lastRequestAt + config.ttc.minIntervalMs, this.pausedUntil) - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRequestAt = Date.now();

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

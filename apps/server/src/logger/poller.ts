import { config } from '../config.ts';
import type { TtcClient } from '../ttc/client.ts';
import type { RouteDetail, RouteSummary } from '../ttc/types.ts';
import type { Recorder, SnapshotKind } from './recorder.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Logs live TTC data so we can learn how late each line really runs.
 *
 * - Hot set: arrival boards for HOT_STOPS and positions for the routes that
 *   serve them (plus HOT_ROUTES), every HOT_INTERVAL_MS.
 * - Sweep: positions for every route, one request every SWEEP_INTERVAL_MS,
 *   so we also get city-wide coverage at lower resolution.
 */
export class Poller {
  private routes = new Map<string, RouteDetail>();
  private hotRouteIds = new Set<string>();
  private running = false;

  hotCycles = 0;
  sweepCycles = 0;
  startedAt: string | null = null;

  private readonly ttc: TtcClient;
  private readonly recorder: Recorder;

  constructor(ttc: TtcClient, recorder: Recorder) {
    this.ttc = ttc;
    this.recorder = recorder;
  }

  async start(): Promise<void> {
    this.running = true;
    this.startedAt = new Date().toISOString();
    await this.recorder.init();
    // Hot routes first so the hot loop starts within seconds, then everything else.
    const all = await this.capture('routes', 'BUS', () => this.ttc.routes());
    await this.resolveHotRoutes(all);
    await this.loadDetails(all.filter((r) => this.hotRouteIds.has(r.id)));
    void this.loop('hot', config.logger.hotIntervalMs, () => this.hotCycle());

    await this.loadDetails(all.filter((r) => !this.hotRouteIds.has(r.id)));
    void this.loop('routes', config.logger.routeRefreshMs, () => this.refreshRoutes(), true);
    if (config.logger.sweepIntervalMs > 0) void this.sweepLoop();
  }

  stop(): void {
    this.running = false;
  }

  stats() {
    return {
      startedAt: this.startedAt,
      routesKnown: this.routes.size,
      hotStops: config.logger.hotStops,
      hotRoutes: [...this.hotRouteIds].map((id) => this.routes.get(id)?.shortName ?? id),
      hotCycles: this.hotCycles,
      sweepCycles: this.sweepCycles,
      snapshotsWritten: this.recorder.written,
      ttcRequests: this.ttc.requests,
      ttcErrors: this.ttc.errors,
      lastError: this.ttc.lastError,
    };
  }

  private async loop(name: string, intervalMs: number, fn: () => Promise<void>, skipFirst = false) {
    if (skipFirst) await sleep(intervalMs);
    while (this.running) {
      const started = Date.now();
      try {
        await fn();
      } catch (err) {
        console.error(`[poller:${name}]`, (err as Error).message);
      }
      await sleep(Math.max(0, intervalMs - (Date.now() - started)));
    }
  }

  private async hotCycle(): Promise<void> {
    for (const stopId of config.logger.hotStops) {
      await this.capture('arrivals', stopId, () => this.ttc.arrivalTimes(stopId));
    }
    for (const routeId of this.hotRouteIds) await this.capturePositions(routeId);
    this.hotCycles++;
  }

  private async sweepLoop(): Promise<void> {
    while (this.running) {
      for (const routeId of [...this.routes.keys()]) {
        if (!this.running) return;
        if (!this.hotRouteIds.has(routeId)) {
          await this.capturePositions(routeId).catch(() => undefined);
          await sleep(config.logger.sweepIntervalMs);
        }
      }
      this.sweepCycles++;
    }
  }

  private async refreshRoutes(): Promise<void> {
    const list = await this.capture('routes', 'BUS', () => this.ttc.routes());
    await this.loadDetails(list);
  }

  private async loadDetails(list: RouteSummary[]): Promise<void> {
    for (const summary of list) {
      try {
        const detail = await this.capture('route', summary.id, () => this.ttc.route(summary.id));
        this.routes.set(summary.id, detail);
      } catch {
        // Keep the old detail if we had one; routes without patterns are skipped.
      }
    }
    console.log(`[poller] ${this.routes.size} routes loaded`);
  }

  private async resolveHotRoutes(all: RouteSummary[]): Promise<void> {
    const ids = new Set<string>();
    for (const stopId of config.logger.hotStops) {
      try {
        const served: RouteSummary[] = await this.capture('stop-routes', stopId, () =>
          this.ttc.stopRoutes(stopId),
        );
        served.forEach((r) => ids.add(r.id));
      } catch (err) {
        console.error(`[poller] routes for stop ${stopId}:`, (err as Error).message);
      }
    }
    for (const shortName of config.logger.hotRoutes) {
      const match = all.find((r) => r.shortName === shortName);
      if (match) ids.add(match.id);
      else console.warn(`[poller] HOT_ROUTES: no route with short name ${shortName}`);
    }
    this.hotRouteIds = ids;
    console.log(`[poller] hot set: ${config.logger.hotStops.length} stops, ${ids.size} routes`);
  }

  private async capturePositions(routeId: string): Promise<void> {
    const route = this.routes.get(routeId);
    if (!route?.patterns?.length) return;
    const suffixes = route.patterns.map((p) => p.patternSuffix);
    await this.capture('positions', routeId, () => this.ttc.positions(routeId, suffixes));
  }

  private async capture<T>(kind: SnapshotKind, key: string, fetcher: () => Promise<T>): Promise<T> {
    const data = await fetcher();
    await this.recorder.write({ t: new Date().toISOString(), kind, key, data });
    return data;
  }
}

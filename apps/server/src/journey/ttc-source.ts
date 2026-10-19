import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { LatLon, NearStop, StopHit } from '@transit/shared';
import type { TtcClient } from '../ttc/client.ts';
import { distanceM, type StopIndex } from '../ttc/stops.ts';
import type { RouteSummary, ScheduleBlock } from '../ttc/types.ts';
import { estimateWalk, type PatternRef, type Source, type Timetable } from './source.ts';

const HOUR = 3_600_000;
const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

/** "7:06,7:18,24:01" → minutes after midnight. */
const parseTimes = (s: string): number[] =>
  s
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    });

/** The block for a date: exact service date first, else the weekday range (for dates TTC lists no block for yet). */
export const blockFor = (blocks: ScheduleBlock[], date: string): ScheduleBlock | null => {
  const exact = blocks.find((b) => b.serviceDates?.includes(date));
  if (exact) return exact;
  const wd = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
  return (
    blocks.find((b) => {
      const from = DAYS.indexOf(b.fromDay);
      const to = DAYS.indexOf(b.toDay);
      return from >= 0 && to >= 0 && (from <= to ? wd >= from && wd <= to : wd >= from || wd <= to);
    }) ?? null
  );
};

/** A schedule block's times lined up with the pattern's stops, in order (a loop line visits its first stop twice, and `position` is not always 0-based). */
const alignTimes = (p: PatternRef, block: ScheduleBlock): Timetable => {
  const sched = [...block.stops].sort((a, b) => a.position - b.position);
  const times: number[][] = [];
  let cursor = 0;
  p.stops.forEach((st, i) => {
    for (let j = cursor; j < sched.length; j++) {
      if (sched[j].id === st.id) {
        times[i] = parseTimes(sched[j].arrivalTimes);
        cursor = j + 1;
        return;
      }
    }
  });
  return { times };
};

const hex = (c: string | undefined | null) => (c && /^#?[0-9a-f]{6}$/i.test(c) ? `#${c.replace(/^#/, '').toUpperCase()}` : null);

/**
 * The real network: TTC's stops, lines, timetables and live arrivals, kept in
 * memory so a trip is planned from a few cached lookups instead of dozens of
 * calls (TTC allows about 1.4 requests a second through our queue).
 */
export class TtcSource implements Source {
  private readonly ttc: TtcClient;
  private readonly stops: StopIndex;
  private readonly cache = new Map<string, { at: number; value: Promise<unknown> }>();
  /** Timetables and line shapes change rarely; they are kept on disk so a restart doesn't mean a minute of reloading. */
  private readonly saved = new Map<string, { at: number; value: unknown }>();
  private readonly refreshing = new Set<string>();
  private readonly file: string | null;
  private dirty = false;
  /** Every pattern of every line, once the network is loaded (warm()); patternsAt then needs no TTC call. */
  private all: PatternRef[] | null = null;
  private byStop = new Map<string, PatternRef[]>();
  /** Parsed timetables per pattern and schedule block (parsing the strings is the slow part). */
  private readonly parsed = new WeakMap<ScheduleBlock, Map<PatternRef, Timetable>>();
  private warming: Promise<void> | null = null;

  constructor(ttc: TtcClient, stops: StopIndex, file: string | null = null) {
    this.ttc = ttc;
    this.stops = stops;
    this.file = file;
    if (file && existsSync(file)) {
      try {
        const data = JSON.parse(readFileSync(file, 'utf8')) as Record<string, { at: number; value: unknown }>;
        for (const [k, v] of Object.entries(data)) {
          this.saved.set(k, v);
          this.cache.set(k, { at: v.at, value: Promise.resolve(v.value) });
        }
      } catch {
        // A damaged cache is just a cold start.
      }
    }
    if (file) setInterval(() => this.flush(), 60_000).unref();
  }

  private flush(): void {
    if (!this.file || !this.dirty) return;
    this.dirty = false;
    try {
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.saved)));
      renameSync(tmp, this.file);
    } catch {
      // Disk full or read-only: keep running from memory.
    }
  }

  /**
   * Cached, and concurrent callers share one request. A failure is not kept.
   * Network data (lines, stops, timetables: keys that are saved to disk) is
   * served stale past its TTL while a background request refreshes it, so a
   * rider never waits for a timetable reload.
   */
  private memo<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>;
    if (hit && this.saved.has(key)) {
      if (!this.refreshing.has(key)) {
        this.refreshing.add(key);
        void this.ttc
          .background(load)
          .then((v) => {
            this.cache.set(key, { at: Date.now(), value: Promise.resolve(v) });
            this.saved.set(key, { at: Date.now(), value: v });
            this.dirty = true;
          })
          .catch(() => undefined)
          .finally(() => this.refreshing.delete(key));
      }
      return hit.value as Promise<T>;
    }
    const value = load();
    this.cache.set(key, { at: Date.now(), value });
    value.then(
      (v) => {
        if (this.file && /^(route|stops|patterns|schedule|walk):/.test(key)) {
          this.saved.set(key, { at: Date.now(), value: v });
          this.dirty = true;
        }
      },
      () => this.cache.get(key)?.value === value && this.cache.delete(key),
    );
    if (this.cache.size > 4000) {
      const old = this.cache.keys().next().value!;
      this.cache.delete(old);
    }
    return value;
  }

  stopsNear(p: LatLon, radiusM: number, limit: number): Promise<NearStop[]> {
    return this.stops.near(p, { radiusM, limit });
  }

  stop(id: string): Promise<StopHit | null> {
    return this.stops.get(id, 'en');
  }

  private routes(): Promise<Map<string, RouteSummary>> {
    return this.memo('routes', 24 * HOUR, async () => new Map((await this.ttc.routes('en', 'BUS,SUBWAY,GONDOLA')).map((r) => [r.id, r])));
  }

  /** Short names that are minibus lines only, for marking a planner leg that has no route id. */
  async minibusNames(): Promise<Set<string>> {
    const all = [...(await this.routes()).values()];
    const names = new Set(all.map((r) => r.shortName));
    return new Set([...names].filter((n) => all.filter((r) => r.shortName === n).every((r) => /minibus/i.test(r.id))));
  }

  /**
   * Loads every line, pattern, stop list and timetable into memory (from the
   * disk cache when fresh, else from TTC in the background, behind riders'
   * requests), then indexes patterns by stop. Safe to call repeatedly: it
   * refreshes what has gone stale. A cold start takes ~15 min of background
   * requests; until then patternsAt asks TTC per stop as before.
   */
  warm(): Promise<void> {
    this.warming ??= this.ttc
      .background(async () => {
        const routes = [...(await this.routes()).values()];
        const out: PatternRef[] = [];
        for (const r of routes) {
          try {
            const detail = await this.memo(`route:${r.id}`, 24 * HOUR, () => this.ttc.route(r.id, 'en'));
            for (const pat of detail.patterns ?? []) {
              const stops = await this.memo(`stops:${r.id}:${pat.patternSuffix}`, 24 * HOUR, () => this.ttc.routeStops(r.id, pat.patternSuffix, 'en'));
              const ref = this.ref(r, pat.patternSuffix, pat.headsign ?? null, stops);
              await this.blocks(ref).catch(() => []);
              out.push(ref);
            }
          } catch {
            // One line failing to load leaves it out until the next warm.
          }
        }
        this.index(out);
        this.flush();
      })
      .finally(() => (this.warming = null));
    return this.warming;
  }

  /** True once warm() has indexed the whole network. */
  get ready(): boolean {
    return this.all !== null;
  }

  /** Every pattern of the network (empty until warm() has run). */
  patterns(): PatternRef[] {
    return this.all ?? [];
  }

  private index(all: PatternRef[]): void {
    const byStop = new Map<string, PatternRef[]>();
    for (const p of all) {
      for (const id of new Set(p.stops.map((s) => s.id))) {
        const list = byStop.get(id);
        if (list) list.push(p);
        else byStop.set(id, [p]);
      }
    }
    this.all = all;
    this.byStop = byStop;
  }

  private ref(r: Pick<RouteSummary, 'id' | 'shortName' | 'longName' | 'color' | 'mode'>, suffix: string, headsign: string | null, stops: Array<{ id: string; name: string; lat: number; lon: number }>): PatternRef {
    return {
      routeId: r.id,
      shortName: r.shortName,
      longName: r.longName ?? null,
      color: hex(r.color),
      minibus: /minibus/i.test(r.id),
      mode: r.mode,
      suffix,
      headsign,
      stops: stops.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon })),
    };
  }

  private blocks(p: PatternRef): Promise<ScheduleBlock[]> {
    return this.memo(`schedule:${p.routeId}:${p.suffix}`, 12 * HOUR, () => this.ttc.schedule(p.routeId, p.suffix, 'en'));
  }

  patternsAt(stopId: string): Promise<PatternRef[]> {
    if (this.all) return Promise.resolve(this.byStop.get(stopId) ?? []);
    return this.memo(`patterns:${stopId}`, 24 * HOUR, async () => {
      const routes = await this.ttc.stopRoutes(stopId, 'en');
      const out: PatternRef[] = [];
      for (const r of routes) {
        const detail = await this.memo(`route:${r.id}`, 24 * HOUR, () => this.ttc.route(r.id, 'en'));
        for (const pat of detail.patterns ?? []) {
          const stops = await this.memo(`stops:${r.id}:${pat.patternSuffix}`, 24 * HOUR, () => this.ttc.routeStops(r.id, pat.patternSuffix, 'en'));
          if (!stops.some((s) => s.id === stopId)) continue;
          out.push(this.ref(r, pat.patternSuffix, pat.headsign ?? null, stops));
        }
      }
      return out;
    });
  }

  async timetable(p: PatternRef, date: string): Promise<Timetable | null> {
    const block = blockFor(await this.blocks(p), date);
    if (!block) return null;
    let perPattern = this.parsed.get(block);
    if (!perPattern) this.parsed.set(block, (perPattern = new Map()));
    // Patterns are compared by identity; an index rebuild makes new ones, and the old entries go with their block.
    const hit = perPattern.get(p);
    if (hit) return hit;
    const tt = alignTimes(p, block);
    perPattern.set(p, tt);
    return tt;
  }

  async live(stopId: string, p: PatternRef): Promise<number[]> {
    // The stop's board (one TTC call for every line there, the next vehicle of each), shared by every pattern and rider for 15 s.
    const arrivals = await this.memo(`board:${stopId}`, 15_000, () => this.ttc.arrivalTimes(stopId, 'en'));
    return arrivals
      .filter((a) => a.realtime && a.shortName === p.shortName && a.patternSuffix === p.suffix && a.realtimeArrivalMinutes >= 0)
      .map((a) => a.realtimeArrivalMinutes)
      .sort((x, y) => x - y);
  }

  /**
   * Walking time by TTC's street router, cached a week. Asked only while
   * riders' requests aren't waiting; otherwise the estimate answers now and
   * the router's answer is fetched in the background for next time.
   */
  async walk(a: LatLon, b: LatLon): Promise<{ sec: number; m: number }> {
    const key = (p: LatLon) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
    const k = `walk:${key(a)}>${key(b)}`;
    const ask = () =>
      this.memo(k, 7 * 24 * HOUR, async () => {
        const now = new Date(Date.now() + 4 * HOUR).toISOString();
        const raw = await this.ttc.plan({ from: a, to: b, departMode: 'leaveNow', date: now.slice(0, 10), time: now.slice(11, 16), modes: ['WALK'], optimize: 'quick', locale: 'en' });
        const it = (raw.itineraries ?? raw.plan?.itineraries ?? [])[0];
        if (!it || !Number.isFinite(it.duration)) throw new Error('no walking route');
        return { sec: Math.round(it.duration), m: Math.round(it.walkDistance ?? distanceM(a, b)) };
      });
    try {
      if (this.cache.has(k) || this.ttc.queued.urgent < 2) return await ask();
      void this.ttc.background(ask).catch(() => undefined);
    } catch {
      // Router down: the estimate below. Not cached, so the next call asks TTC again.
    }
    return estimateWalk(a, b);
  }
}

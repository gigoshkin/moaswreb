import type { LatLon, NearStop, StopHit } from '@transit/shared';
import type { TtcClient } from '../ttc/client.ts';
import { distanceM, type StopIndex } from '../ttc/stops.ts';
import type { RouteSummary, ScheduleBlock } from '../ttc/types.ts';
import type { PatternRef, Source, Timetable } from './source.ts';

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

  constructor(ttc: TtcClient, stops: StopIndex) {
    this.ttc = ttc;
    this.stops = stops;
  }

  /** Cached, and concurrent callers share one request. A failure is not kept. */
  private memo<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>;
    const value = load();
    this.cache.set(key, { at: Date.now(), value });
    value.catch(() => this.cache.get(key)?.value === value && this.cache.delete(key));
    if (this.cache.size > 4000) this.cache.delete(this.cache.keys().next().value!);
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

  patternsAt(stopId: string): Promise<PatternRef[]> {
    return this.memo(`patterns:${stopId}`, 24 * HOUR, async () => {
      const routes = await this.ttc.stopRoutes(stopId, 'en');
      const out: PatternRef[] = [];
      for (const r of routes) {
        const detail = await this.memo(`route:${r.id}`, 24 * HOUR, () => this.ttc.route(r.id, 'en'));
        for (const pat of detail.patterns ?? []) {
          const stops = await this.memo(`stops:${r.id}:${pat.patternSuffix}`, 24 * HOUR, () => this.ttc.routeStops(r.id, pat.patternSuffix, 'en'));
          if (!stops.some((s) => s.id === stopId)) continue;
          out.push({
            routeId: r.id,
            shortName: r.shortName,
            longName: r.longName ?? null,
            color: hex(r.color),
            minibus: /minibus/i.test(r.id),
            mode: r.mode,
            suffix: pat.patternSuffix,
            headsign: pat.headsign ?? null,
            stops: stops.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon })),
          });
        }
      }
      return out;
    });
  }

  async timetable(p: PatternRef, date: string): Promise<Timetable | null> {
    const blocks = await this.memo(`schedule:${p.routeId}:${p.suffix}`, 6 * HOUR, () => this.ttc.schedule(p.routeId, p.suffix, 'en'));
    const block = blockFor(blocks, date);
    if (!block) return null;
    // Position in the pattern → times. Positions are the pattern's own order.
    const times: number[][] = [];
    for (const s of block.stops) times[s.position] = parseTimes(s.arrivalTimes);
    return { times };
  }

  live(stopId: string, p: PatternRef): Promise<number[]> {
    return this.memo(`live:${stopId}:${p.routeId}`, 15_000, async () => {
      const arrivals = await this.ttc.routeArrivals(stopId, p.routeId, 'en');
      return arrivals
        .filter((a) => a.realtime && a.patternSuffix === p.suffix && a.realtimeArrivalMinutes >= 0)
        .map((a) => a.realtimeArrivalMinutes)
        .sort((x, y) => x - y);
    });
  }

  async walk(a: LatLon, b: LatLon): Promise<{ sec: number; m: number }> {
    const key = (p: LatLon) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
    try {
      return await this.memo(`walk:${key(a)}>${key(b)}`, 7 * 24 * HOUR, async () => {
        const now = new Date(Date.now() + 4 * HOUR).toISOString();
        const raw = await this.ttc.plan({ from: a, to: b, departMode: 'leaveNow', date: now.slice(0, 10), time: now.slice(11, 16), modes: ['WALK'], optimize: 'quick', locale: 'en' });
        const it = (raw.itineraries ?? raw.plan?.itineraries ?? [])[0];
        if (!it || !Number.isFinite(it.duration)) throw new Error('no walking route');
        return { sec: Math.round(it.duration), m: Math.round(it.walkDistance ?? distanceM(a, b)) };
      });
    } catch {
      // TTC's router walks at about 0.9 m/s; the street is ~1.3x the straight line. Not cached, so the next call asks TTC again.
      const m = Math.round(distanceM(a, b) * 1.3);
      return { sec: Math.round(m / 0.9), m };
    }
  }
}

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TBILISI_UTC_OFFSET_MIN } from '@transit/shared';
import { config } from '../config.ts';
import { normalizePlan } from '../plan/normalize.ts';
import type { TtcClient } from '../ttc/client.ts';
import type { StopIndex } from '../ttc/stops.ts';

/** A leg of TTC's answer counts as "the same ride" when it starts and ends this close to the stops asked for. */
const MATCH_M = 200;
/** TTC had no matching leg: don't ask again for a day. */
const MISS_MS = 24 * 3_600_000;

const metres = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const rad = Math.PI / 180;
  return Math.hypot((b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad), (b.lat - a.lat) * rad) * 6_371_000;
};

/**
 * Road shapes for rides. TTC publishes no line geometry, but its trip planner
 * draws every leg along the real roads. For one ride (a line from stop A to
 * stop B) we ask the planner for exactly that trip once, keep the shape of the
 * leg that is the same line, and keep it for good (in memory and on disk), so a
 * ride is only ever looked up once. No match means the app draws a straight line.
 */
export class ShapeService {
  private readonly saved = new Map<string, string>();
  private readonly misses = new Map<string, number>();
  private readonly inflight = new Map<string, Promise<string | null>>();
  private readonly file = join(config.dataDir, 'shapes.json');
  private readonly ttc: TtcClient;
  private readonly stops: StopIndex;

  constructor(ttc: TtcClient, stops: StopIndex) {
    this.ttc = ttc;
    this.stops = stops;
    try {
      if (existsSync(this.file)) for (const [k, v] of Object.entries(JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, string>)) this.saved.set(k, v);
    } catch {
      // A damaged file just means shapes are looked up again.
    }
  }

  /** Encoded polyline for `route` between two stops, or null when TTC has none. */
  shape(fromId: string, toId: string, route: string): Promise<string | null> {
    const key = `${route}|${fromId}|${toId}`;
    const hit = this.saved.get(key);
    if (hit) return Promise.resolve(hit);
    const missAt = this.misses.get(key);
    if (missAt && Date.now() - missAt < MISS_MS) return Promise.resolve(null);
    const running = this.inflight.get(key);
    if (running) return running;
    const p = this.lookup(fromId, toId, route)
      .then((line) => {
        if (line) {
          this.saved.set(key, line);
          this.persist();
        } else this.misses.set(key, Date.now());
        return line;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async lookup(fromId: string, toId: string, route: string): Promise<string | null> {
    const [a, b] = await Promise.all([this.stops.get(fromId), this.stops.get(toId)]);
    if (!a || !b) return null;
    // Midday tomorrow, so the answer doesn't depend on what is running at this hour.
    const day = new Date(Date.now() + TBILISI_UTC_OFFSET_MIN * 60_000 + 86_400_000).toISOString().slice(0, 10);
    const modes = a.mode === 'SUBWAY' ? ['SUBWAY'] : ['BUS'];
    const raw = await this.ttc.plan({ from: a, to: b, departMode: 'departAt', date: day, time: '12:00', modes, optimize: 'quick', locale: 'en' });
    for (const it of normalizePlan(raw)) {
      for (const leg of it.legs) {
        if (leg.mode === 'WALK' || leg.route?.shortName !== route || !leg.polyline) continue;
        if (metres(leg.from, a) <= MATCH_M && metres(leg.to, b) <= MATCH_M) return leg.polyline;
      }
    }
    return null;
  }

  private persist(): void {
    try {
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.saved)));
      renameSync(tmp, this.file);
    } catch {
      // Not writable: shapes stay in memory.
    }
  }
}

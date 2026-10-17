import type { LatLon, Locale, NearStop, StopHit } from '@transit/shared';
import type { TtcClient } from './client.ts';
import type { Stop } from './types.ts';

const REFRESH_MS = 24 * 60 * 60 * 1000;

/** Equirectangular distance; exact enough within a city. */
export const distanceM = (a: LatLon, b: LatLon): number => {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.hypot(x, y) * 6_371_000;
};

interface Entry {
  hit: StopHit;
  /** Lowercased Georgian and English names, for matching. */
  keys: string[];
  nameEn: string;
}

/**
 * All TTC stops (≈2,760) in memory, Georgian and English names, refreshed
 * daily. Two TTC calls per day; searching never hits TTC.
 */
export class StopIndex {
  private entries: Entry[] = [];
  private loadedAt = 0;
  private loading: Promise<void> | null = null;
  private readonly ttc: TtcClient;

  constructor(ttc: TtcClient) {
    this.ttc = ttc;
  }

  private async ensure(): Promise<void> {
    if (this.entries.length && Date.now() - this.loadedAt < REFRESH_MS) return;
    this.loading ??= this.load().finally(() => (this.loading = null));
    await this.loading;
  }

  private async load(): Promise<void> {
    const [ka, en] = await Promise.all([this.ttc.stops('ka'), this.ttc.stops('en')]);
    const enById = new Map(en.map((s: Stop) => [s.id, s.name]));
    this.entries = ka.map((s) => {
      const nameEn = enById.get(s.id) ?? '';
      return {
        hit: { id: s.id, name: s.name, lat: s.lat, lon: s.lon, mode: s.vehicleMode },
        keys: [s.name.toLowerCase(), nameEn.toLowerCase(), s.code ?? ''].filter(Boolean),
        nameEn,
      };
    });
    this.loadedAt = Date.now();
  }

  /** English name when asked for and TTC has one; Georgian otherwise. */
  private named(e: Entry, locale: Locale): StopHit {
    return locale === 'en' && e.nameEn ? { ...e.hit, name: e.nameEn } : e.hit;
  }

  async get(id: string, locale: Locale = 'ka'): Promise<StopHit | null> {
    await this.ensure();
    const e = this.entries.find((e) => e.hit.id === id);
    return e ? this.named(e, locale) : null;
  }

  /** Closest stops to a point, nearest first. */
  async near(p: LatLon, { radiusM = 500, limit = 10, mode, locale = 'ka' }: { radiusM?: number; limit?: number; mode?: string; locale?: Locale } = {}): Promise<NearStop[]> {
    await this.ensure();
    const hits: NearStop[] = [];
    for (const e of this.entries) {
      if (mode && e.hit.mode !== mode) continue;
      const d = distanceM(p, e.hit);
      if (d <= radiusM) hits.push({ ...this.named(e, locale), distanceM: Math.round(d) });
    }
    return hits.sort((a, b) => a.distanceM - b.distanceM).slice(0, limit);
  }

  /**
   * The stop a plan leg starts or ends at. TTC's leg from/to carry no stop id
   * but sit exactly on the stop (0 m in live data, 17 Oct), while the
   * opposite-direction stop can be 7 m away, so: nearest of the same mode.
   */
  async snap(p: LatLon, mode: string, maxM = 25): Promise<string | null> {
    return (await this.near(p, { radiusM: maxM, limit: 1, mode }))[0]?.id ?? null;
  }

  /** Name or stop-code search; prefix matches rank above substring matches. */
  async search(query: string, limit = 5, locale: Locale = 'ka'): Promise<StopHit[]> {
    await this.ensure();
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const scored: Array<[number, Entry]> = [];
    for (const e of this.entries) {
      let best = -1;
      for (const k of e.keys) {
        if (k === q) best = Math.max(best, 3);
        else if (k.startsWith(q)) best = Math.max(best, 2);
        else if (k.includes(q)) best = Math.max(best, 1);
      }
      if (best >= 0) scored.push([best, e]);
    }
    return scored
      .sort((a, b) => b[0] - a[0] || a[1].hit.name.localeCompare(b[1].hit.name))
      .slice(0, limit)
      .map(([, e]) => this.named(e, locale));
  }
}

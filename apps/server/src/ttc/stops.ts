import type { StopHit } from '@transit/shared';
import type { TtcClient } from './client.ts';
import type { Stop } from './types.ts';

const REFRESH_MS = 24 * 60 * 60 * 1000;

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

  async get(id: string): Promise<StopHit | null> {
    await this.ensure();
    return this.entries.find((e) => e.hit.id === id)?.hit ?? null;
  }

  /** Name or stop-code search; prefix matches rank above substring matches. */
  async search(query: string, limit = 5): Promise<StopHit[]> {
    await this.ensure();
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const scored: Array<[number, StopHit]> = [];
    for (const e of this.entries) {
      let best = -1;
      for (const k of e.keys) {
        if (k === q) best = Math.max(best, 3);
        else if (k.startsWith(q)) best = Math.max(best, 2);
        else if (k.includes(q)) best = Math.max(best, 1);
      }
      if (best >= 0) scored.push([best, e.hit]);
    }
    return scored
      .sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name))
      .slice(0, limit)
      .map(([, hit]) => hit);
  }
}

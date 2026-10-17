import type { Itinerary, PlanQuery, PlanResponse } from '@transit/shared';
import type { TtcClient } from '../ttc/client.ts';
import type { StopIndex } from '../ttc/stops.ts';
import { normalizePlan } from './normalize.ts';

const CACHE_MS = 60_000;

/**
 * Trip planning shared by GET /plan, the chat agent and the MCP server.
 * Identical queries within a minute are served from memory so no caller can
 * multiply TTC traffic.
 */
export class PlanService {
  private readonly cache = new Map<string, { at: number; body: PlanResponse }>();
  private readonly ttc: TtcClient;
  private readonly stops: StopIndex;

  constructor(ttc: TtcClient, stops: StopIndex) {
    this.ttc = ttc;
    this.stops = stops;
  }

  /**
   * TTC sends no stop id on a ride's boarding and alighting places; saved
   * trips and alerts need them, so they are matched from the stop index.
   * If the index can't load, ids stay null rather than failing the plan.
   */
  private async fillStopIds(itineraries: Itinerary[]): Promise<void> {
    const rides = itineraries.flatMap((it) => it.legs.filter((l) => l.mode !== 'WALK'));
    try {
      for (const leg of rides) {
        leg.from.stopId ??= await this.stops.snap(leg.from, leg.mode);
        leg.to.stopId ??= await this.stops.snap(leg.to, leg.mode);
      }
    } catch {
      // Stop index unavailable (TTC down); the plan itself is still good.
    }
  }

  async plan(query: PlanQuery): Promise<PlanResponse> {
    const key = JSON.stringify(query);
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.body;

    const [date, time] = query.arriveBy.split('T');
    const raw = await this.ttc.plan({
      from: query.from,
      to: query.to,
      departMode: 'arriveBy',
      date,
      time,
      modes: query.modes ?? ['BUS', 'SUBWAY', 'GONDOLA'],
      optimize: query.optimize ?? 'quick',
      locale: query.locale,
    });
    const itineraries = normalizePlan(raw);
    await this.fillStopIds(itineraries);
    const body: PlanResponse = {
      query,
      itineraries,
      source: 'ttc',
      fetchedAt: new Date().toISOString(),
    };
    this.cache.set(key, { at: Date.now(), body });
    if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value!);
    return body;
  }
}

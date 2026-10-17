import type { PlanQuery, PlanResponse } from '@transit/shared';
import type { TtcClient } from '../ttc/client.ts';
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

  constructor(ttc: TtcClient) {
    this.ttc = ttc;
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
    const body: PlanResponse = {
      query,
      itineraries: normalizePlan(raw),
      source: 'ttc',
      fetchedAt: new Date().toISOString(),
    };
    this.cache.set(key, { at: Date.now(), body });
    if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value!);
    return body;
  }
}

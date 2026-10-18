import type { Itinerary, JourneyStep, PlanQuery, PlanResponse } from '@transit/shared';
import { TBILISI_UTC_OFFSET_MIN, tbilisiLocalToIso } from '@transit/shared';
import { Engine } from '../journey/engine.ts';
import { isAvoided } from '../journey/source.ts';
import type { TtcSource } from '../journey/ttc-source.ts';
import type { TtcClient } from '../ttc/client.ts';
import type { StopIndex } from '../ttc/stops.ts';
import { normalizePlan } from './normalize.ts';

const CACHE_MS = 60_000;
/** Longest we make a caller wait for our own planner (its first run for a new area loads timetables). */
const ENGINE_BUDGET_MS = 25_000;
const NEAR_FROM_M = 900;
const NEAR_TO_M = 900;
/** Stops considered at each end. Many lines pass within walking distance in the centre, and the nearest few are often one line's. */
const NEAR_LIMIT = 14;
/**
 * TTC's planner answers with at most 3 itineraries (numItineraries is ignored)
 * and, for one arrive-by time, often fills them with bus chains while a
 * bus + metro option arriving 10-20 min earlier is left out (Didi Dighomi →
 * Zurab Anjaparidze St, arrive 09:00: no metro; arrive 08:45: 314 > metro 2).
 * So it is asked once more this much earlier and the answers are merged.
 */
export const TTC_EARLIER_MIN = 15;

/** Tbilisi `YYYY-MM-DDTHH:mm` shifted by `min` minutes (crosses midnight correctly). */
export const shiftLocal = (local: string, min: number): string => {
  const ms = Date.parse(tbilisiLocalToIso(local) ?? '');
  if (!Number.isFinite(ms)) return local;
  return new Date(ms + (min + TBILISI_UTC_OFFSET_MIN) * 60_000).toISOString().slice(0, 16);
};

/** The lines of an itinerary in order, e.g. "314>2"; walking-only trips are "WALK". */
export const lineChain = (it: Itinerary): string =>
  it.legs.filter((l) => l.mode !== 'WALK').map((l) => `${l.mode}:${l.route?.shortName ?? ''}`).join('>') || 'WALK';

/**
 * One itinerary per distinct line chain: the latest-leaving one that still
 * arrives by `deadline`, or the earliest arrival when none does.
 */
export const onePerChain = (its: Itinerary[], deadline: number): Itinerary[] => {
  const best = new Map<string, Itinerary>();
  for (const it of its) {
    const k = lineChain(it);
    const cur = best.get(k);
    if (!cur) { best.set(k, it); continue; }
    const fits = Date.parse(it.arriveAt) <= deadline, curFits = Date.parse(cur.arriveAt) <= deadline;
    const better = fits !== curFits ? fits : fits ? it.departAt > cur.departAt : it.arriveAt < cur.arriveAt;
    if (better) best.set(k, it);
  }
  return [...best.values()];
};

/** Earliest arrival first; on the same arrival minute, fewer changes first. */
export const byArrivalThenTransfers = (a: Itinerary, b: Itinerary): number =>
  a.arriveAt.slice(0, 16).localeCompare(b.arriveAt.slice(0, 16)) || a.transfers - b.transfers || a.arriveAt.localeCompare(b.arriveAt);

/**
 * Trip planning shared by GET /plan, the chat agent, the alert watcher and the
 * MCP server. Our own planner (journey/engine.ts) compares every line that fits
 * link by link; TTC's planner adds trips with transfers. A trip's avoid list is
 * applied to both. Identical queries within a minute are served from memory so
 * no caller can multiply TTC traffic.
 */
export class PlanService {
  private readonly cache = new Map<string, { at: number; body: PlanResponse }>();
  private readonly ttc: TtcClient;
  private readonly stops: StopIndex;
  private readonly source: TtcSource | null;
  private readonly engine: Engine | null;

  constructor(ttc: TtcClient, stops: StopIndex, source: TtcSource | null = null) {
    this.ttc = ttc;
    this.stops = stops;
    this.source = source;
    this.engine = source ? new Engine(source) : null;
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

  /** Our planner: every line from stops near the start to stops near the end (or the hand-built steps). */
  private async ownOptions(query: PlanQuery): Promise<Itinerary[]> {
    if (!this.engine || !this.source) return [];
    const deadline = Date.parse(tbilisiLocalToIso(query.arriveBy) ?? '');
    if (!Number.isFinite(deadline)) return [];
    let steps: JourneyStep[];
    if (query.steps?.length) steps = query.steps;
    else {
      const [fromStops, toStops] = await Promise.all([
        this.source.stopsNear(query.from, NEAR_FROM_M, NEAR_LIMIT),
        this.source.stopsNear(query.to, NEAR_TO_M, NEAR_LIMIT),
      ]);
      if (!fromStops.length || !toStops.length) return [];
      steps = [{ fromStops: fromStops.map((s) => s.id), toStops: toStops.map((s) => s.id) }];
    }
    return this.engine.solve({ from: query.from, to: query.to, steps, avoid: query.avoid, deadline, now: Date.now(), modes: query.modes });
  }

  /** TTC's planner, minus anything the trip avoids. Asked again with other preferences when that leaves little. */
  private async ttcOptions(query: PlanQuery): Promise<Itinerary[]> {
    const ask = (optimize: 'quick' | 'lessWalking' | 'fewerTransfers', at = query.arriveBy) => {
      const [date, time] = at.split('T');
      return this.ttc.plan({ from: query.from, to: query.to, departMode: 'arriveBy', date, time, modes: query.modes ?? ['BUS', 'SUBWAY', 'GONDOLA'], optimize, locale: query.locale });
    };
    const first = normalizePlan(await ask(query.optimize ?? 'quick'));
    // A second, earlier ask finds what the 3-itinerary cap pushed out (often the metro).
    try {
      first.push(...normalizePlan(await ask(query.optimize ?? 'quick', shiftLocal(query.arriveBy, -TTC_EARLIER_MIN))));
    } catch {
      // The first answer stands.
    }
    const minibus = this.source ? await this.source.minibusNames().catch(() => new Set<string>()) : new Set<string>();
    const mark = (its: Itinerary[]) => {
      for (const it of its) for (const l of it.legs) if (l.route) l.route.minibus = minibus.has(l.route.shortName);
      return its;
    };
    const allowed = (its: Itinerary[]) => its.filter((it) => !it.legs.some((l) => l.route && isAvoided({ shortName: l.route.shortName, minibus: l.route.minibus === true }, query.avoid)));
    let out = allowed(mark(first));
    const avoiding = Boolean(query.avoid?.routes?.length || query.avoid?.minibus);
    if (avoiding && out.length < 3) {
      for (const o of ['lessWalking', 'fewerTransfers'] as const) {
        if (o === query.optimize) continue;
        try {
          out = [...out, ...allowed(mark(normalizePlan(await ask(o))))];
        } catch {
          // The first answer stands.
        }
      }
    }
    const deadline = Date.parse(tbilisiLocalToIso(query.arriveBy) ?? '') || Infinity;
    return onePerChain(out, deadline);
  }

  async plan(query: PlanQuery): Promise<PlanResponse> {
    const key = JSON.stringify(query);
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.body;

    const own = this.ownOptions(query);
    // A hand-built route is exactly what was asked for: TTC's planner has nothing to add.
    const ttc = query.steps?.length ? Promise.resolve<Itinerary[] | null>([]) : this.ttcOptions(query).catch(() => null as Itinerary[] | null);
    let ownDone: Itinerary[] = [];
    let ownError: unknown = null;
    const budget = new Promise<void>((resolve) => setTimeout(resolve, ENGINE_BUDGET_MS).unref());
    await Promise.race([
      own.then((r) => void (ownDone = r), (e: unknown) => void (ownError = e)),
      budget,
    ]);
    const theirs = await ttc;
    if (theirs === null && !ownDone.length) throw ownError ?? new Error('TTC trip planner unavailable');

    // Where our planner found a line, its numbers win over TTC's for the same lines.
    const key2 = (it: Itinerary) => it.legs.filter((l) => l.route).map((l) => l.route!.shortName).join('>');
    const ours = new Set(ownDone.map(key2));
    const itineraries = [...ownDone, ...(theirs ?? []).filter((it) => !ours.has(key2(it)))].sort(byArrivalThenTransfers);
    await this.fillStopIds(itineraries);
    const body: PlanResponse = { query, itineraries, source: 'ttc', fetchedAt: new Date().toISOString() };
    // An answer made without our planner (it was still loading) is not kept for the full minute.
    if (ownDone.length || !this.engine) {
      this.cache.set(key, { at: Date.now(), body });
      if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value!);
    }
    return body;
  }
}

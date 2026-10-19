import type { Itinerary, JourneyStep, PlanQuery, PlanResponse } from '@transit/shared';
import { groupWays, leaveAt, TBILISI_UTC_OFFSET_MIN, tbilisiLocalToIso } from '@transit/shared';
import { Engine } from '../journey/engine.ts';
import { alternatives, type Journey } from '../journey/raptor.ts';
import { isAvoided } from '../journey/source.ts';
import type { TtcSource } from '../journey/ttc-source.ts';
import type { TtcClient } from '../ttc/client.ts';
import type { StopIndex } from '../ttc/stops.ts';
import { normalizePlan } from './normalize.ts';
import { resolveCandidate, type GoogleRoutes } from './google-routes.ts';

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
/** Stops this close to a found ride's boarding / alighting stop are tried too (the other side, the next pole): they make the way's variations. */
const SIBLING_M = 150;
/** Different journeys the network search hands to the engine per plan. */
const MAX_NETWORK_JOURNEYS = 12;
/** Google line chains timed per request (each costs TTC lookups and walking times). */
const MAX_GOOGLE_CANDIDATES = 4;
/**
 * Itineraries returned at most. Not 3-5: the list is sorted by arrival, so a
 * small cap would cut the latest-leaving options, which are what "arrive by"
 * is about; the longest trips are cut instead.
 */
export const MAX_ITINERARIES = 10;
/** With this many different ways from the network search, TTC's planner and Google are not asked (they would only make the list jump). */
const MIN_NETWORK_WAYS = 2;

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
 * arrives by `deadline` (and, given `now`, can still be caught), or the
 * earliest arrival when none does.
 */
export const onePerChain = (its: Itinerary[], deadline: number, now = -Infinity): Itinerary[] => {
  const best = new Map<string, Itinerary>();
  // 2: on time and catchable, 1: catchable but late, 0: already gone.
  const tier = (it: Itinerary) => (Date.parse(it.departAt) < now ? 0 : Date.parse(it.arriveAt) <= deadline ? 2 : 1);
  for (const it of its) {
    const k = lineChain(it);
    const cur = best.get(k);
    if (!cur) { best.set(k, it); continue; }
    const t = tier(it), curT = tier(cur);
    const better = t !== curT ? t > curT : t === 2 ? it.departAt > cur.departAt : it.arriveAt < cur.arriveAt;
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
  /** TTC lookups under way, so the quick answer and the full plan of one query share them. */
  private readonly ttcRuns = new Map<string, Promise<Itinerary[]>>();
  private readonly ttc: TtcClient;
  private readonly stops: StopIndex;
  private readonly source: TtcSource | null;
  private readonly engine: Engine | null;
  private readonly google: GoogleRoutes | null;

  constructor(ttc: TtcClient, stops: StopIndex, source: TtcSource | null = null, google: GoogleRoutes | null = null) {
    this.ttc = ttc;
    this.stops = stops;
    this.source = source;
    this.google = google;
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

  /**
   * Our planner over the whole network in memory: the network search finds
   * which rides to take (with changes), the engine times each from timetables
   * and live data. Null until the network is loaded; then TTC's planner and
   * Google are only asked when it finds little.
   */
  private async networkOptions(query: PlanQuery): Promise<Itinerary[] | null> {
    if (!this.engine || !this.source?.ready || query.steps?.length) return null;
    const deadline = Date.parse(tbilisiLocalToIso(query.arriveBy) ?? '');
    if (!Number.isFinite(deadline)) return [];
    const found = await alternatives(this.source.view, { from: query.from, to: query.to, deadline, avoid: query.avoid, modes: query.modes }, MAX_NETWORK_JOURNEYS);
    const steps = await Promise.all(found.map((j) => this.stepsOf(j)));
    const engine = this.engine;
    const now = Date.now();
    const runs = steps.map((st) => engine.solve({ from: query.from, to: query.to, steps: st, avoid: query.avoid, deadline, now, modes: query.modes }).catch(() => [] as Itinerary[]));
    return simplest((await Promise.all(runs)).flat(), deadline);
  }

  /** A found journey as planner steps: each ride from its stop (or one beside it) to its stop (or one beside it), any line between them. */
  private async stepsOf(j: Journey): Promise<JourneyStep[]> {
    const around = async (id: string, at: { lat: number; lon: number }, mode: string) => {
      const near = await this.stops.near(at, { radiusM: SIBLING_M, limit: 8, mode }).catch(() => []);
      return [id, ...near.map((s) => s.id).filter((s) => s !== id)].slice(0, 8);
    };
    return Promise.all(
      j.rides.map(async (r) => {
        const board = r.p.stops[r.b];
        const alight = r.p.stops[r.a];
        return { fromStops: await around(board.id, board, r.p.mode), toStops: await around(alight.id, alight, r.p.mode) };
      }),
    );
  }

  /**
   * Google's line chains, timed by our planner from TTC data. Google only says
   * which lines to ride and roughly where; a chain whose rides don't match TTC
   * stops and lines is left out. Nothing when Google is off or fails.
   */
  private async googleOptions(query: PlanQuery): Promise<Itinerary[]> {
    if (!this.google || !this.engine || !this.source || query.steps?.length) return [];
    const deadline = Date.parse(tbilisiLocalToIso(query.arriveBy) ?? '');
    if (!Number.isFinite(deadline)) return [];
    const candidates = await this.google(query.from, query.to, deadline);
    if (!candidates?.length) return [];
    const engine = this.engine;
    const source = this.source;
    const now = Date.now();
    const runs = candidates.slice(0, MAX_GOOGLE_CANDIDATES).map(async (c) => {
      const steps = await resolveCandidate(c, source);
      if (!steps) return [];
      return engine.solve({ from: query.from, to: query.to, steps, avoid: query.avoid, deadline, now, modes: query.modes });
    });
    return (await Promise.all(runs.map((r) => r.catch(() => [] as Itinerary[])))).flat();
  }

  /** ttcOptions, once at a time per query: GET /plan?part=ttc and the full plan of the same query ask TTC once. */
  private sharedTtcOptions(query: PlanQuery): Promise<Itinerary[]> {
    const key = JSON.stringify(query);
    let run = this.ttcRuns.get(key);
    if (!run) {
      run = this.ttcOptions(query);
      this.ttcRuns.set(key, run);
      const done = () => void this.ttcRuns.delete(key);
      run.then(done, done);
    }
    return run;
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

  /**
   * The quick part of a plan: only TTC's planner, without waiting for our own
   * planner (which loads timetables for a new area, up to ~25 s) or Google.
   * Marked `partial`, kept in its own cache and never as the full answer. When
   * the full plan of this query is already in memory, that is returned instead
   * (unmarked), since it is better and just as fast. Failures throw, like plan().
   */
  async planTtc(query: PlanQuery): Promise<PlanResponse> {
    // With the network loaded the full plan takes about as long as TTC's alone, and doesn't change under the rider.
    if (this.source?.ready) return this.plan(query);
    const full = this.cache.get(JSON.stringify(query));
    if (full && Date.now() - full.at < CACHE_MS) return full.body;
    const key = `ttc:${JSON.stringify(query)}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.body;
    const itineraries = [...(await this.sharedTtcOptions(query))].sort(byArrivalThenTransfers);
    await this.fillStopIds(itineraries);
    const body: PlanResponse = { query, itineraries, source: 'ttc', fetchedAt: new Date().toISOString(), partial: true };
    this.remember(key, body);
    return body;
  }

  private remember(key: string, body: PlanResponse): void {
    this.cache.set(key, { at: Date.now(), body });
    if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value!);
  }

  /** Full plans being made, so the same query asked twice at once (the app's quick and full part, two riders) is planned once. */
  private readonly running = new Map<string, Promise<PlanResponse>>();

  plan(query: PlanQuery): Promise<PlanResponse> {
    const key = JSON.stringify(query);
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return Promise.resolve(hit.body);
    let run = this.running.get(key);
    if (!run) {
      run = this.makePlan(query, key).finally(() => this.running.delete(key));
      this.running.set(key, run);
    }
    return run;
  }

  private async makePlan(query: PlanQuery, key: string): Promise<PlanResponse> {

    const network = await this.networkOptions(query).catch(() => null);
    if (network && groupWays(network).length >= MIN_NETWORK_WAYS) {
      const itineraries = withGoogle(network, [], query);
      await this.fillStopIds(itineraries);
      const body: PlanResponse = { query, itineraries, source: 'ttc', fetchedAt: new Date().toISOString() };
      this.remember(key, body);
      return body;
    }

    const own = network ? Promise.resolve(network) : this.ownOptions(query);
    const google = this.googleOptions(query).catch(() => [] as Itinerary[]);
    // A hand-built route is exactly what was asked for: TTC's planner has nothing to add.
    const ttc = query.steps?.length ? Promise.resolve<Itinerary[] | null>([]) : this.sharedTtcOptions(query).catch(() => null as Itinerary[] | null);
    let ownDone: Itinerary[] = [];
    let googleDone: Itinerary[] = [];
    let ownError: unknown = null;
    let ownSettled = false;
    const budget = new Promise<void>((resolve) => setTimeout(resolve, ENGINE_BUDGET_MS).unref());
    await Promise.race([
      Promise.all([
        own.then((r) => void ((ownDone = r), (ownSettled = true)), (e: unknown) => void ((ownError = e), (ownSettled = true))),
        google.then((r) => void (googleDone = r)),
      ]),
      budget,
    ]);
    const theirs = await ttc;
    if (theirs === null && !ownDone.length) throw ownError ?? new Error('TTC trip planner unavailable');
    // A hand-built route has only our planner. When it failed (TTC busy or down) or ran out of time, that is an
    // error, not "no ride fits": an empty answer would replace the phone's last good plan of the trip, and a trip
    // saved on it loses its stops (and its alerts).
    if (query.steps?.length && !ownDone.length && (ownError || !ownSettled)) throw ownError ?? new Error('Journey planner still loading');

    // Where our planner found a line, its numbers win over TTC's for the same lines.
    const key2 = (it: Itinerary) => it.legs.filter((l) => l.route).map((l) => l.route!.shortName).join('>');
    const ours = new Set(ownDone.map(key2));
    const merged = [...ownDone, ...(theirs ?? []).filter((it) => !ours.has(key2(it)))];
    const itineraries = withGoogle(merged, googleDone, query);
    await this.fillStopIds(itineraries);
    const body: PlanResponse = { query, itineraries, source: 'ttc', fetchedAt: new Date().toISOString() };
    // An answer made without our planner (it was still loading) is not kept for the full minute.
    if (ownDone.length || !this.engine) this.remember(key, body);
    return body;
  }
}

/** One more change has to let you leave this much later (or arrive this much sooner) to be listed. */
const CHANGE_WORTH_MIN = 5;

/** Changes that count: a change between metro lines (Station Square) is part of riding the metro. */
const changes = (it: Itinerary): number => {
  const rides = it.legs.filter((l) => l.mode !== 'WALK');
  return rides.slice(1).filter((l, i) => !(l.mode === 'SUBWAY' && rides[i].mode === 'SUBWAY')).length;
};

/**
 * Drops options with two or more changes that a simpler one beats: fewer
 * changes, no more than 5 min more walking, and leaving no more than 5 min per
 * saved change earlier (both on time, or the simpler one arriving no later).
 * "518 > 422 > 541 > metro 2" is not worth listing beside "541 > metro 2"; a
 * bus + metro way is always listed beside a direct bus.
 */
export const simplest = (its: Itinerary[], deadline: number): Itinerary[] => {
  const onTime = (it: Itinerary) => Date.parse(it.arriveAt) <= deadline;
  return its.filter(
    (b) =>
      changes(b) < 2 ||
      !its.some((a) => {
        const saved = changes(b) - changes(a);
        if (saved <= 0 || a.walkSec > b.walkSec + 300) return false;
        const slack = saved * CHANGE_WORTH_MIN * 60_000;
        if (onTime(b)) return onTime(a) && leaveAt(a) >= leaveAt(b) - slack;
        return Date.parse(a.arriveAt) <= Date.parse(b.arriveAt) + slack;
      }),
  );
};

/**
 * Google-suggested chains (timed by our planner) merged into the list: one
 * itinerary per line chain, the latest-leaving one still on time; then at most
 * MAX_ITINERARIES, one per different way first (see `groupWays`), then the
 * on-time, shortest ones; earliest arrival first.
 */
export const withGoogle = (base: Itinerary[], google: Itinerary[], query: Pick<PlanQuery, 'arriveBy'>, now = Date.now()): Itinerary[] => {
  const deadline = Date.parse(tbilisiLocalToIso(query.arriveBy) ?? '') || Infinity;
  const fits = (it: Itinerary) => Date.parse(it.arriveAt) <= deadline;
  const all = onePerChain([...base, ...google], deadline, now);
  if (all.length <= MAX_ITINERARIES) return all.sort(byArrivalThenTransfers);
  // Every different way keeps its best option before any way gets a second one: a slower metro way must not be cut
  // just because several buses of one way are shorter. Then the rest, on-time and shortest first.
  const order = (a: Itinerary, b: Itinerary) => Number(fits(b)) - Number(fits(a)) || a.durationSec - b.durationSec;
  const leads = groupWays(all).map((w) => [...w.its].sort(order)[0]).sort(order);
  const rest = all.filter((it) => !leads.includes(it)).sort(order);
  return [...leads, ...rest].slice(0, MAX_ITINERARIES).sort(byArrivalThenTransfers);
};

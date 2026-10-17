import type { Itinerary, StoredTrip } from '@transit/shared';
import type { PlanService } from '../plan/service.ts';
import type { StopIndex } from '../ttc/stops.ts';
import type { TripStore } from '../store/trips.ts';
import type { PushMessage, SendPush } from './push.ts';

const TBILISI_MS = 4 * 3600_000;
const WATCH_BEFORE_MIN = 120; // start watching 2 h before the arrive-by time
const LEAVE_SOON_MIN = 10; // "leave in 10 min"
const CHANGE_MIN = 3; // a shift this big counts as a changed plan

interface TripState {
  leaveAt: number;
  sentSoon: boolean;
}

/** Tbilisi date `YYYY-MM-DD` and ISO weekday (1 = Monday) for a UTC instant. */
const tbilisiDay = (now: number) => {
  const d = new Date(now + TBILISI_MS);
  return { date: d.toISOString().slice(0, 10), weekday: d.getUTCDay() || 7 };
};

const hm = (ms: number) => new Date(ms + TBILISI_MS).toISOString().slice(11, 16);
const DAY_MS = 24 * 3600_000;

/** The latest departure that still arrives on time. */
const bestItinerary = (its: Itinerary[], arriveByMs: number): Itinerary | null =>
  its
    .filter((it) => Date.parse(it.arriveAt) <= arriveByMs)
    .sort((a, b) => Date.parse(b.departAt) - Date.parse(a.departAt))[0] ?? null;

const routesOf = (it: Itinerary) =>
  it.legs
    .filter((l) => l.route)
    .map((l) => l.route!.shortName)
    .join(' → ');

/**
 * Watches every stored trip on its days, from 2 h before the arrive-by time,
 * and pushes when it's time to leave or when the plan shifts. Runs on the
 * server so alerts don't depend on the phone waking up.
 */
export class AlertWatcher {
  private readonly state = new Map<string, TripState>();
  private timer: NodeJS.Timeout | null = null;
  private readonly store: TripStore;
  private readonly stops: StopIndex;
  private readonly plans: PlanService;
  private readonly send: SendPush;

  sent = 0;
  lastError: string | null = null;

  constructor(store: TripStore, stops: StopIndex, plans: PlanService, send: SendPush) {
    this.store = store;
    this.stops = stops;
    this.plans = plans;
    this.send = send;
  }

  start(intervalMs = 60_000): void {
    const run = () =>
      this.tick().catch((err) => {
        this.lastError = `${new Date().toISOString()} ${(err as Error).message}`;
      });
    void run();
    this.timer = setInterval(run, intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * One pass over all devices. Public for tests. A message's state is only
   * recorded once Expo accepts it, so a failed send is retried next tick.
   */
  async tick(now = Date.now()): Promise<PushMessage[]> {
    // Today and tomorrow: a 00:30 arrive-by is watched from 22:30 the day before.
    const days = [tbilisiDay(now), tbilisiDay(now + DAY_MS)];
    const out: Array<{ msg: PushMessage; key: string; next: TripState }> = [];
    for (const dev of this.store.all()) {
      if (!dev.pushToken) continue;
      for (const trip of dev.trips) {
        for (const { date, weekday } of days) {
          if (!trip.days.includes(weekday)) continue;
          const arriveByMs = Date.parse(`${date}T${trip.arriveBy}:00Z`) - TBILISI_MS;
          if (now > arriveByMs || now < arriveByMs - WATCH_BEFORE_MIN * 60_000) continue;
          try {
            const res = await this.check(dev.device, dev.pushToken, trip, date, arriveByMs, now);
            if (res) out.push(res);
          } catch (err) {
            this.lastError = `${new Date(now).toISOString()} ${(err as Error).message}`;
          }
        }
      }
    }
    this.forgetOld(days.map((d) => d.date));
    if (!out.length) return [];
    const delivered = await this.send(out.map((o) => o.msg));
    const sent = out.filter((o, i) => delivered[i]);
    for (const o of sent) this.state.set(o.key, o.next);
    this.sent += sent.length;
    if (sent.length < out.length) this.lastError = `${new Date(now).toISOString()} ${out.length - sent.length} push(es) not accepted`;
    return sent.map((o) => o.msg);
  }

  private async check(
    device: string,
    to: string,
    trip: StoredTrip,
    date: string,
    arriveByMs: number,
    now: number,
  ): Promise<{ msg: PushMessage; key: string; next: TripState } | null> {
    const [from, dest] = await Promise.all([this.stops.get(trip.fromStopId), this.stops.get(trip.toStopId)]);
    if (!from || !dest) return null;
    const plan = await this.plans.plan({
      from: { lat: from.lat, lon: from.lon },
      to: { lat: dest.lat, lon: dest.lon },
      arriveBy: `${date}T${trip.arriveBy}`,
      locale: 'en',
    });
    const best = bestItinerary(plan.itineraries, arriveByMs);
    if (!best) return null;

    const leaveAt = Date.parse(best.departAt) - trip.walkMin * 60_000;
    const key = `${device}|${trip.id}|${date}`;
    const prev = this.state.get(key);
    const data = (kind: PushMessage['data']['kind']) => ({ kind, tripId: trip.id, leaveAt: new Date(leaveAt).toISOString() });
    const routes = routesOf(best);
    let msg: PushMessage | null = null;

    if (prev && Math.abs(leaveAt - prev.leaveAt) >= CHANGE_MIN * 60_000 && now < leaveAt) {
      msg = {
        to,
        title: 'Departure time changed',
        body: `Leave at ${hm(leaveAt)} (was ${hm(prev.leaveAt)}). ${routes}`,
        data: data('plan_changed'),
      };
    } else if (!prev?.sentSoon && now >= leaveAt - LEAVE_SOON_MIN * 60_000 && now < leaveAt + 60_000) {
      const mins = Math.max(0, Math.round((leaveAt - now) / 60_000));
      msg = {
        to,
        title: mins > 0 ? `Leave in ${mins} min` : 'Leave now',
        body: `${hm(leaveAt)} · ${routes}`,
        data: data('leave_soon'),
      };
    }
    if (!msg) {
      // Nothing to send: just track the latest plan.
      this.state.set(key, { leaveAt, sentSoon: prev?.sentSoon ?? false });
      return null;
    }
    return { msg, key, next: { leaveAt, sentSoon: (prev?.sentSoon ?? false) || msg.data.kind === 'leave_soon' } };
  }

  private forgetOld(keep: string[]): void {
    for (const key of this.state.keys()) if (!keep.some((d) => key.endsWith(`|${d}`))) this.state.delete(key);
  }
}

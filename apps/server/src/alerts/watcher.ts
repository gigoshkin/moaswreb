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

  /** One pass over all devices. Public for tests. */
  async tick(now = Date.now()): Promise<PushMessage[]> {
    const { date, weekday } = tbilisiDay(now);
    const out: PushMessage[] = [];
    for (const dev of this.store.all()) {
      if (!dev.pushToken) continue;
      for (const trip of dev.trips) {
        if (!trip.days.includes(weekday)) continue;
        const arriveByMs = Date.parse(`${date}T${trip.arriveBy}:00Z`) - TBILISI_MS;
        if (now > arriveByMs || now < arriveByMs - WATCH_BEFORE_MIN * 60_000) continue;
        try {
          const msg = await this.check(dev.device, dev.pushToken, trip, date, arriveByMs, now);
          if (msg) out.push(msg);
        } catch (err) {
          this.lastError = `${new Date(now).toISOString()} ${(err as Error).message}`;
        }
      }
    }
    this.forgetOld(date);
    await this.send(out);
    this.sent += out.length;
    return out;
  }

  private async check(
    device: string,
    to: string,
    trip: StoredTrip,
    date: string,
    arriveByMs: number,
    now: number,
  ): Promise<PushMessage | null> {
    const [from, dest] = await Promise.all([this.stops.get(trip.fromStopId), this.stops.get(trip.toStopId)]);
    if (!from || !dest) return null;
    const plan = await this.plans.plan({
      from: { lat: from.lat, lon: from.lon },
      to: { lat: dest.lat, lon: dest.lon },
      arriveBy: `${date}T${trip.arriveBy}`,
      locale: 'ka',
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
        title: 'გასვლის დრო შეიცვალა',
        body: `გასვლა ${hm(leaveAt)}-ზე (იყო ${hm(prev.leaveAt)}). ${routes}`,
        data: data('plan_changed'),
      };
    } else if (!prev?.sentSoon && now >= leaveAt - LEAVE_SOON_MIN * 60_000 && now < leaveAt + 60_000) {
      const mins = Math.max(0, Math.round((leaveAt - now) / 60_000));
      msg = {
        to,
        title: mins > 0 ? `გასვლა ${mins} წუთში` : 'გასვლა ახლა',
        body: `${hm(leaveAt)} · ${routes}`,
        data: data('leave_soon'),
      };
    }
    const sentSoon = (prev?.sentSoon ?? false) || msg?.data.kind === 'leave_soon';
    this.state.set(key, { leaveAt, sentSoon });
    return msg;
  }

  private forgetOld(today: string): void {
    for (const key of this.state.keys()) if (!key.endsWith(`|${today}`)) this.state.delete(key);
  }
}

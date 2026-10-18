import { leaveAtMs, type Itinerary, type StoredTrip } from '@transit/shared';
import type { PlanService } from '../plan/service.ts';
import type { StopIndex } from '../ttc/stops.ts';
import type { TripStore } from '../store/trips.ts';
import type { PushMessage, SendPush } from './push.ts';

const TBILISI_MS = 4 * 3600_000;
const WATCH_BEFORE_MIN = 120; // start watching 2 h before the arrive-by time
const LEAVE_SOON_MIN = 10; // "leave in 10 min"
const CHANGE_MIN = 3; // a shift this big counts as a changed plan
const LATE_MIN = 3; // the chosen line's next ride this much later than first seen counts as late
const LATE_MAX_MIN = 30; // a bigger gap is another run of the line, not a delay
const SWITCH_MIN = 3; // another line has to arrive this much earlier to be worth the alert

interface TripState {
  leaveAt: number;
  sentSoon: boolean;
  /** The first line of the chosen plan and when its ride first showed up, to measure a delay against. */
  watch?: { line: string; departAt: number };
  /** `306>17` pairs already pushed today. */
  switched?: string[];
}

/** Tbilisi date `YYYY-MM-DD` and ISO weekday (1 = Monday) for a UTC instant. */
const tbilisiDay = (now: number) => {
  const d = new Date(now + TBILISI_MS);
  return { date: d.toISOString().slice(0, 10), weekday: d.getUTCDay() || 7 };
};

const hm = (ms: number) => new Date(ms + TBILISI_MS).toISOString().slice(11, 16);
const DAY_MS = 24 * 3600_000;

/** Minutes of walking one change counts as; keep in step with the app's `choose`. */
const TRANSFER_WALK_MIN = 8;
const effort = (it: Itinerary) => Math.round(it.walkSec / 60) + TRANSFER_WALK_MIN * it.transfers;

/** Departures this close to the latest one count as equal; then less walking and fewer changes win. */
const NEAR_TIE_MS = 5 * 60_000;

/** The latest departure that still arrives on time (ties within 5 min: least walking plus 8 min per change). */
export const bestItinerary = (its: Itinerary[], arriveByMs: number): Itinerary | null => {
  const fits = its
    .filter((it) => Date.parse(it.arriveAt) <= arriveByMs)
    .sort((a, b) => Date.parse(b.departAt) - Date.parse(a.departAt) || Date.parse(a.arriveAt) - Date.parse(b.arriveAt));
  if (!fits.length) return null;
  const latest = Date.parse(fits[0].departAt);
  return (
    fits
      .filter((it) => Date.parse(it.departAt) >= latest - NEAR_TIE_MS)
      .sort((a, b) => effort(a) - effort(b) || Date.parse(b.departAt) - Date.parse(a.departAt))[0] ?? null
  );
};

const routesOf = (it: Itinerary) =>
  it.legs
    .filter((l) => l.route)
    .map((l) => l.route!.shortName)
    .join(' → ');

const firstRide = (it: Itinerary) => it.legs.find((l) => l.route);

/**
 * The watched line's next ride is running late on live data and another line,
 * leaving within the leave-soon window, arrives {@link SWITCH_MIN} earlier.
 * The delay is measured against the departure first seen (TTC's own delay
 * field is not trusted, see normalizePlan).
 */
export const findSwitch = (
  its: Itinerary[],
  watch: { line: string; departAt: number },
  walkMin: number,
  now: number,
): { lateMin: number; late: Itinerary; alt: Itinerary } | null => {
  const late = its
    .filter((it) => firstRide(it)?.route?.shortName === watch.line && Date.parse(firstRide(it)!.departAt) >= watch.departAt - 60_000)
    .sort((a, b) => Date.parse(firstRide(a)!.departAt) - Date.parse(firstRide(b)!.departAt))[0];
  if (!late || !firstRide(late)!.realtime) return null;
  const lateMin = Math.round((Date.parse(firstRide(late)!.departAt) - watch.departAt) / 60_000);
  if (lateMin < LATE_MIN || lateMin > LATE_MAX_MIN) return null;
  const lateArrive = Date.parse(late.arriveAt);
  const alt = its
    .filter((it) => {
      const line = firstRide(it)?.route?.shortName;
      const leave = leaveAtMs(Date.parse(it.departAt), walkMin);
      return line && line !== watch.line && leave >= now - 60_000 && leave <= now + LEAVE_SOON_MIN * 60_000 && Date.parse(it.arriveAt) <= lateArrive - SWITCH_MIN * 60_000;
    })
    .sort((a, b) => Date.parse(a.arriveAt) - Date.parse(b.arriveAt))[0];
  return alt ? { lateMin, late, alt } : null;
};

/**
 * Watches every stored trip on its days, from 2 h before the arrive-by time,
 * and pushes when it's time to leave, when the plan shifts or when the chosen
 * line runs late and another gets there earlier. Runs on the
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
  /** A pass still running (slow TTC answers can take longer than the interval): the next tick skips, so no push goes out twice. */
  private running = false;

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
    if (this.running) return [];
    this.running = true;
    try {
      return await this.pass(now);
    } finally {
      this.running = false;
    }
  }

  private async pass(now: number): Promise<PushMessage[]> {
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
    const base = {
      from: { lat: from.lat, lon: from.lon },
      to: { lat: dest.lat, lon: dest.lon },
      arriveBy: `${date}T${trip.arriveBy}`,
      locale: 'en' as const,
      ...(trip.avoid ? { avoid: trip.avoid } : {}),
    };
    let best: Itinerary | null = null;
    let its: Itinerary[] = [];
    if (trip.steps?.length) {
      // A hand-built route: exactly its rides, from the first stop to the last.
      const first = await this.stops.get(trip.steps[0].fromStops[0]);
      const last = await this.stops.get(trip.steps.at(-1)!.toStops[0]);
      if (!first || !last) return null;
      const plan = await this.plans.plan({ ...base, from: { lat: first.lat, lon: first.lon }, to: { lat: last.lat, lon: last.lon }, steps: trip.steps });
      its = plan.itineraries;
      best = bestItinerary(its, arriveByMs);
    } else {
      // Every line between the two stops first (the stops the walk was measured to), then TTC's planner for trips that need a transfer.
      const direct = await this.plans.plan({ ...base, steps: [{ fromStops: [trip.fromStopId], toStops: [trip.toStopId] }] });
      its = direct.itineraries;
      best = bestItinerary(its, arriveByMs);
      if (!best) {
        its = (await this.plans.plan(base)).itineraries;
        best = bestItinerary(its, arriveByMs);
      }
    }
    if (!best) return null;

    // Walk plus a margin for buses that come early.
    const leaveAt = leaveAtMs(Date.parse(best.departAt), trip.walkMin);
    const key = `${device}|${trip.id}|${date}`;
    const prev = this.state.get(key);
    const data = (kind: PushMessage['data']['kind']) => ({ kind, tripId: trip.id, leaveAt: new Date(leaveAt).toISOString() });
    const routes = routesOf(best);
    let msg: PushMessage | null = null;

    // Which line the plan was built on, and when its ride was first seen; kept while it is the same ride.
    const ride = firstRide(best);
    const dep = ride ? Date.parse(ride.departAt) : 0;
    const w = prev?.watch;
    const sameRun = w && w.line === ride?.route?.shortName && dep >= w.departAt - 60_000 && dep - w.departAt <= LATE_MAX_MIN * 60_000;
    const watch = sameRun || (w && w.departAt + LATE_MAX_MIN * 60_000 > now) ? w : ride?.route ? { line: ride.route.shortName, departAt: dep } : undefined;
    const switched = prev?.switched ?? [];
    const sw = watch ? findSwitch(its, watch, trip.walkMin, now) : null;
    const swKey = sw ? `${watch!.line}>${firstRide(sw.alt)!.route!.shortName}` : '';

    if (sw && !switched.includes(swKey)) {
      const altLeave = leaveAtMs(Date.parse(sw.alt.departAt), trip.walkMin);
      const mins = Math.max(0, Math.round((altLeave - now) / 60_000));
      msg = {
        to,
        title: `${mins > 0 ? `Leave in ${mins} min` : 'Leave now'} · switch to ${firstRide(sw.alt)!.route!.shortName}`,
        body: `${watch!.line} is ${sw.lateMin} min late. ${firstRide(sw.alt)!.route!.shortName} gets you there by ${hm(Date.parse(sw.alt.arriveAt))}.`,
        data: { kind: 'line_switch', tripId: trip.id, leaveAt: new Date(altLeave).toISOString() },
      };
    } else if (prev && Math.abs(leaveAt - prev.leaveAt) >= CHANGE_MIN * 60_000 && now < leaveAt) {
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
      this.state.set(key, { leaveAt, sentSoon: prev?.sentSoon ?? false, watch, switched });
      return null;
    }
    const isSwitch = msg.data.kind === 'line_switch';
    return {
      msg,
      key,
      // The switch alert is also the "leave now" one, so no "Leave in N min" after it.
      next: { leaveAt, sentSoon: (prev?.sentSoon ?? false) || msg.data.kind === 'leave_soon' || isSwitch, watch, switched: isSwitch ? [...switched, swKey] : switched },
    };
  }

  private forgetOld(keep: string[]): void {
    for (const key of this.state.keys()) if (!keep.some((d) => key.endsWith(`|${d}`))) this.state.delete(key);
  }
}

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { leaveMarginMin, type PlanResponse } from '@transit/shared';
import { AlertWatcher, bestItinerary } from '../src/alerts/watcher.ts';
import type { PushMessage } from '../src/alerts/push.ts';
import { normalizePlan } from '../src/plan/normalize.ts';
import type { PlanService } from '../src/plan/service.ts';
import { Sealer } from '../src/store/crypto.ts';
import { TripStore } from '../src/store/trips.ts';
import { StopIndex } from '../src/ttc/stops.ts';
import { fakeTtc, rawPlan } from './fakes.ts';

// Synthetic fixture (Mon 19 Oct 2026): bus 306+347 leaves 08:15, arrives 08:58 Tbilisi;
// metro leaves 08:10, arrives 08:57 (the metro here is moved 3 min earlier below, so it is not a near tie).
// Latest departure that arrives by 09:00 = 08:15.
const at = (hhmm: string) => Date.parse(`2026-10-19T${hhmm}:00+04:00`);
const DEVICE = 'dev-0123456789abcdefghijkl';

const setup = () => {
  const ttc = fakeTtc();
  let itineraries = normalizePlan(rawPlan).map((it) => (it.legs.some((l) => l.mode === 'SUBWAY') ? { ...it, departAt: new Date(Date.parse(it.departAt) - 3 * 60_000).toISOString() } : it));
  const queries: string[] = [];
  const plans = {
    plan: async (query: { arriveBy: string }) => (queries.push(query.arriveBy), { query, itineraries, source: 'ttc', fetchedAt: '' }) as unknown as PlanResponse,
  };
  const store = new TripStore('', new Sealer(randomBytes(32).toString('base64')), ':memory:');
  store.putTrips(DEVICE, [{ id: 't1', fromStopId: '1:1000', toStopId: '1:1405', arriveBy: '09:00', days: [1], walkMin: 5 }]);
  store.putPushToken(DEVICE, 'ExponentPushToken[x]');
  const sent: PushMessage[] = [];
  let expoUp = true;
  const watcher = new AlertWatcher(store, new StopIndex(ttc), plans as unknown as PlanService, async (m) => {
    if (expoUp) sent.push(...m);
    return m.map(() => expoUp);
  });
  const setExpo = (up: boolean) => (expoUp = up);
  /** The 306 run runs `min` late on live data (its trip arrives that much later too). */
  const delay306 = (min: number) => {
    itineraries = itineraries.map((it) => {
      if (!it.legs.some((l) => l.route?.shortName === '306')) return it;
      const add = (iso: string) => new Date(Date.parse(iso) + min * 60_000).toISOString();
      return { ...it, departAt: add(it.departAt), arriveAt: add(it.arriveAt), legs: it.legs.map((l) => ({ ...l, departAt: add(l.departAt), arriveAt: add(l.arriveAt), realtime: l.route?.shortName === '306' ? true : l.realtime })) };
    });
  };
  const shift = (min: number) => {
    itineraries = itineraries.map((it) => ({ ...it, departAt: new Date(Date.parse(it.departAt) + min * 60_000).toISOString() }));
  };
  return { watcher, sent, store, shift, setExpo, queries, delay306 };
};

test('silent until 10 min before leaving (08:15 bus − 5 min walk − 1 min margin = leave 08:09), then one push', async () => {
  const { watcher, sent } = setup();
  assert.equal((await watcher.tick(at('06:30'))).length, 0, 'not watched yet (> 2 h before)');
  assert.equal((await watcher.tick(at('07:55'))).length, 0);
  const [msg] = await watcher.tick(at('08:01'));
  assert.equal(msg.title, 'Leave in 8 min');
  assert.equal(msg.body, '08:09 · 306 → 347');
  assert.equal(msg.data.kind, 'leave_soon');
  assert.equal((await watcher.tick(at('08:02'))).length, 0, 'no repeat');
  assert.equal(sent.length, 1);
});

test('pushes when the plan shifts by 3+ minutes', async () => {
  const { watcher, shift } = setup();
  await watcher.tick(at('07:40'));
  shift(4);
  const [msg] = await watcher.tick(at('07:45'));
  assert.equal(msg.data.kind, 'plan_changed');
  assert.equal(msg.body, 'Leave at 08:13 (was 08:09). 306 → 347');
  shift(1);
  assert.equal((await watcher.tick(at('07:46'))).length, 0, 'small drift is ignored');
});

test('skips other weekdays and devices without a push token', async () => {
  const { watcher, store } = setup();
  assert.equal((await watcher.tick(Date.parse('2026-10-20T08:01:00+04:00'))).length, 0, 'Tuesday');
  store.putTrips('dev-zzzzzzzzzzzzzzzzzzzzzzzzz', [{ id: 't2', fromStopId: '1:1000', toStopId: '1:1405', arriveBy: '09:00', days: [1], walkMin: 0 }]);
  assert.equal((await watcher.tick(at('08:01'))).length, 1, 'only the device with a token');
});

test('a push Expo did not accept is retried on the next tick', async () => {
  const { watcher, sent, setExpo } = setup();
  setExpo(false);
  assert.equal((await watcher.tick(at('08:01'))).length, 0);
  assert.match(watcher.lastError ?? '', /not accepted/);
  setExpo(true);
  const [msg] = await watcher.tick(at('08:02'));
  assert.equal(msg.data.kind, 'leave_soon');
  assert.equal((await watcher.tick(at('08:03'))).length, 0, 'then no repeat');
  assert.equal(sent.length, 1);
});

test('a trip arriving just after midnight is watched from the evening before', async () => {
  const { watcher, store, queries } = setup();
  store.putTrips(DEVICE, [{ id: 't3', fromStopId: '1:1000', toStopId: '1:1405', arriveBy: '00:30', days: [1], walkMin: 0 }]);
  await watcher.tick(Date.parse('2026-10-18T23:00:00+04:00')); // Sunday 23:00, trip is Monday 00:30
  assert.deepEqual([...new Set(queries)], ['2026-10-19T00:30']); // asked directly first, then with TTC's planner
});

test('leave margin is 20% of the walk, 1 to 4 min', () => {
  assert.deepEqual([0, 5, 10, 12, 15, 20, 40].map(leaveMarginMin), [1, 1, 2, 2, 3, 4, 4]);
});

test('within 5 min of the latest departure, less walking beats a later start', () => {
  const [bus, metro] = normalizePlan(rawPlan);
  const base = Date.parse(bus.departAt);
  const arrive = base + 3600_000;
  const far = { ...bus, id: 'far', departAt: new Date(base).toISOString(), arriveAt: new Date(arrive).toISOString(), walkSec: 900, transfers: 0 };
  const near = { ...bus, id: 'near', departAt: new Date(base - 60_000).toISOString(), arriveAt: new Date(arrive).toISOString(), walkSec: 300, transfers: 0 };
  const way = { ...metro, id: 'way', departAt: new Date(base - 8 * 60_000).toISOString(), arriveAt: new Date(arrive).toISOString(), walkSec: 0, transfers: 0 };
  assert.equal(bestItinerary([far, near], arrive)?.id, 'near', 'one minute earlier, ten minutes less walking');
  assert.equal(bestItinerary([far, near, way], arrive)?.id, 'near', 'eight minutes earlier is no tie: not chosen over the latest pool');
});

test('overlapping ticks (a pass slower than the interval) send the push once', async () => {
  const { watcher, sent } = setup();
  const [a, b] = await Promise.all([watcher.tick(at('08:01')), watcher.tick(at('08:01'))]);
  assert.equal(a.length + b.length, 1);
  assert.equal(sent.length, 1);
});

test('a late line with a faster alternative pushes one "switch to" alert', async () => {
  const { watcher, sent, delay306 } = setup();
  await watcher.tick(at('07:40')); // 306 → 347 is the plan: leave 08:09
  delay306(4); // 306 now 08:24 and arrives 09:02; the metro still arrives 08:57 and leaves home 08:01
  assert.equal((await watcher.tick(at('07:45'))).filter((m) => m.data.kind === 'line_switch').length, 0, 'the metro is not leaving yet');
  const [msg] = await watcher.tick(at('08:01'));
  assert.equal(msg.title, 'Leave now · switch to M1');
  assert.equal(msg.body, '306 is 4 min late. M1 gets you there by 08:57.');
  assert.equal(msg.data.kind, 'line_switch');
  assert.equal(msg.data.tripId, 't1');
  assert.equal((await watcher.tick(at('08:02'))).length, 0, 'once per switch');
  assert.equal(sent.length, 2, 'plan change at 07:45, then the switch');
});

test('no switch alert for a small delay, an alternative that is not 3 min faster, or a timetable-only time', async () => {
  const a = setup();
  await a.watcher.tick(at('07:40'));
  a.delay306(2);
  assert.deepEqual((await a.watcher.tick(at('08:01'))).map((m) => m.data.kind), ['leave_soon'], '2 min late is jitter');

  const b = setup();
  await b.watcher.tick(at('07:40'));
  b.delay306(1);
  assert.deepEqual((await b.watcher.tick(at('08:01'))).map((m) => m.data.kind), ['leave_soon'], 'the metro is only 2 min faster than a 1 min late bus');

  const c = setup();
  await c.watcher.tick(at('07:40'));
  c.delay306(4);
  // Timetable data only: the shift is not a live delay.
  const plans = (c.watcher as unknown as { plans: { plan: (q: unknown) => Promise<PlanResponse> } }).plans;
  const plan = plans.plan.bind(plans);
  plans.plan = async (q) => {
    const res = await plan(q);
    return { ...res, itineraries: res.itineraries.map((it) => ({ ...it, legs: it.legs.map((l) => ({ ...l, realtime: false })) })) } as PlanResponse;
  };
  assert.deepEqual((await c.watcher.tick(at('08:01'))).map((m) => m.data.kind), ['leave_soon']);
});

test('a failed switch push is retried', async () => {
  const { watcher, sent, delay306, setExpo } = setup();
  await watcher.tick(at('07:40'));
  delay306(4);
  setExpo(false);
  assert.equal((await watcher.tick(at('08:01'))).length, 0);
  setExpo(true);
  const [msg] = await watcher.tick(at('08:02'));
  assert.equal(msg.data.kind, 'line_switch');
  assert.equal(sent.length, 1);
});

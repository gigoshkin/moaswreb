import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import type { PlanResponse } from '@transit/shared';
import { AlertWatcher } from '../src/alerts/watcher.ts';
import type { PushMessage } from '../src/alerts/push.ts';
import { normalizePlan } from '../src/plan/normalize.ts';
import type { PlanService } from '../src/plan/service.ts';
import { Sealer } from '../src/store/crypto.ts';
import { TripStore } from '../src/store/trips.ts';
import { StopIndex } from '../src/ttc/stops.ts';
import { fakeTtc, rawPlan } from './fakes.ts';

// Synthetic fixture (Mon 19 Oct 2026): bus 306+347 leaves 08:15, arrives 08:58 Tbilisi;
// metro leaves 08:10, arrives 08:57. Latest departure that arrives by 09:00 = 08:15.
const at = (hhmm: string) => Date.parse(`2026-10-19T${hhmm}:00+04:00`);
const DEVICE = 'dev-0123456789abcdefghijkl';

const setup = () => {
  const ttc = fakeTtc();
  let itineraries = normalizePlan(rawPlan);
  const plans = { plan: async (query: never) => ({ query, itineraries, source: 'ttc', fetchedAt: '' }) as unknown as PlanResponse };
  const store = new TripStore('', new Sealer(randomBytes(32).toString('base64')), ':memory:');
  store.putTrips(DEVICE, [{ id: 't1', fromStopId: '1:1000', toStopId: '1:1405', arriveBy: '09:00', days: [1], walkMin: 5 }]);
  store.putPushToken(DEVICE, 'ExponentPushToken[x]');
  const sent: PushMessage[] = [];
  const watcher = new AlertWatcher(store, new StopIndex(ttc), plans as unknown as PlanService, async (m) => void sent.push(...m));
  const shift = (min: number) => {
    itineraries = itineraries.map((it) => ({ ...it, departAt: new Date(Date.parse(it.departAt) + min * 60_000).toISOString() }));
  };
  return { watcher, sent, store, shift };
};

test('silent until 10 min before leaving (08:15 bus − 5 min walk = leave 08:10), then one push', async () => {
  const { watcher, sent } = setup();
  assert.equal((await watcher.tick(at('06:30'))).length, 0, 'not watched yet (> 2 h before)');
  assert.equal((await watcher.tick(at('07:55'))).length, 0);
  const [msg] = await watcher.tick(at('08:01'));
  assert.equal(msg.title, 'გადი 9 წუთში');
  assert.equal(msg.body, '08:10 · 306 → 347');
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
  assert.equal(msg.body, 'გადი 08:14-ზე (იყო 08:10). 306 → 347');
  shift(1);
  assert.equal((await watcher.tick(at('07:46'))).length, 0, 'small drift is ignored');
});

test('skips other weekdays and devices without a push token', async () => {
  const { watcher, store } = setup();
  assert.equal((await watcher.tick(Date.parse('2026-10-20T08:01:00+04:00'))).length, 0, 'Tuesday');
  store.putTrips('dev-zzzzzzzzzzzzzzzzzzzzzzzzz', [{ id: 't2', fromStopId: '1:1000', toStopId: '1:1405', arriveBy: '09:00', days: [1], walkMin: 0 }]);
  assert.equal((await watcher.tick(at('08:01'))).length, 1, 'only the device with a token');
});

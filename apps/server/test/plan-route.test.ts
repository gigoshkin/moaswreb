import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import Fastify from 'fastify';
import { registerPlanRoute } from '../src/plan/route.ts';
import { PlanService, TTC_EARLIER_MIN, byArrivalThenTransfers, lineChain, onePerChain, shiftLocal } from '../src/plan/service.ts';
import type { Itinerary } from '@transit/shared';
import { StopIndex } from '../src/ttc/stops.ts';
import { TtcError, type TtcClient } from '../src/ttc/client.ts';

const raw = JSON.parse(await readFile(new URL('./fixtures/plan-otp-synthetic.json', import.meta.url), 'utf8'));

const setup = (plan: (p: unknown) => Promise<unknown>) => {
  const calls: unknown[] = [];
  const app = Fastify();
  const fake = { plan: (p: unknown) => (calls.push(p), plan(p)) } as unknown as TtcClient;
  registerPlanRoute(app, new PlanService(fake, new StopIndex(fake)));
  return { app, calls };
};

const url = '/plan?from=41.7151,44.8271&to=41.7099,44.7929&arriveBy=2026-10-19T09:00';

test('maps query to TTC arriveBy call and normalises', async () => {
  const { app, calls } = setup(async () => raw);
  const res = await app.inject(url + '&modes=BUS');
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.itineraries.length, 2);
  assert.equal(body.source, 'ttc');
  assert.deepEqual(calls[0], {
    from: { lat: 41.7151, lon: 44.8271 },
    to: { lat: 41.7099, lon: 44.7929 },
    departMode: 'arriveBy',
    date: '2026-10-19',
    time: '09:00',
    modes: ['BUS'],
    optimize: 'quick',
    locale: 'en',
  });
});

test('caches identical queries', async () => {
  const { app, calls } = setup(async () => raw);
  await app.inject(url);
  await app.inject(url);
  // One ask at the deadline and one TTC_EARLIER_MIN earlier; none for the cached repeat.
  assert.equal(calls.length, 2);
});

test('rejects bad input without calling TTC', async () => {
  const { app, calls } = setup(async () => raw);
  for (const bad of [
    '/plan?from=44.8271,41.7151&to=41.7099,44.7929&arriveBy=2026-10-19T09:00',
    '/plan?from=41.7151,44.8271&to=41.7099,44.7929&arriveBy=2026-02-31T09:00',
    '/plan?from=41.7151,44.8271&to=41.7099,44.7929&arriveBy=9am',
    url + '&modes=TRAM',
  ]) {
    assert.equal((await app.inject(bad)).statusCode, 400, bad);
  }
  assert.equal(calls.length, 0);
});

test('upstream failure → 503', async () => {
  const { app } = setup(async () => { throw new TtcError(500, 'v2/plan', 'boom'); });
  const res = await app.inject(url);
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().error, 'upstream');
});

// Shapes from the live TTC planner, Didi Dighomi -> Zurab Anjaparidze St, Mon 19 Oct 2026
// (18 Oct probe): arrive by 09:00 gave 539>531>298, 539>476, 539>310 (no metro);
// arrive by 08:45 gave 335>384>metro 2, 314>metro 2, 302.
const leg = (mode: string, name: string | null, dep: string, arr: string) => ({
  mode, from: { name: 'a', lat: 41.79, lon: 44.73, stopId: null }, to: { name: 'b', lat: 41.72, lon: 44.71, stopId: null },
  startTime: Date.parse(dep), endTime: Date.parse(arr), duration: (Date.parse(arr) - Date.parse(dep)) / 1000, distance: 100,
  ...(name ? { route: { shortName: name } } : {}),
});
const rawIt = (rides: Array<[string, string]>, dep: string, arr: string) => ({
  startTime: Date.parse(dep), endTime: Date.parse(arr), duration: (Date.parse(arr) - Date.parse(dep)) / 1000,
  legs: [leg('WALK', null, dep, dep), ...rides.map(([m, n]) => leg(m, n, dep, arr)), leg('WALK', null, arr, arr)],
});
const at09 = { itineraries: [
  rawIt([['BUS', '539'], ['BUS', '531'], ['BUS', '298']], '2026-10-19T03:58:00Z', '2026-10-19T04:54:00Z'),
  rawIt([['BUS', '539'], ['BUS', '476']], '2026-10-19T03:58:00Z', '2026-10-19T04:55:00Z'),
  rawIt([['BUS', '539'], ['BUS', '310']], '2026-10-19T03:58:00Z', '2026-10-19T04:58:00Z'),
] };
const at0845 = { itineraries: [
  rawIt([['BUS', '314'], ['SUBWAY', '2']], '2026-10-19T03:27:00Z', '2026-10-19T04:33:00Z'),
  rawIt([['BUS', '539'], ['BUS', '310']], '2026-10-19T03:40:00Z', '2026-10-19T04:42:00Z'),
] };

test('asks TTC again earlier and keeps the bus + metro option it finds', async () => {
  const { app, calls } = setup(async (p) => ((p as { time: string }).time === '09:00' ? at09 : at0845));
  const res = await app.inject(url);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.map((c) => (c as { time: string }).time), ['09:00', '08:45']);
  const its = res.json().itineraries as Itinerary[];
  const chains = its.map(lineChain);
  assert.ok(chains.includes('BUS:314>SUBWAY:2'), chains.join(' | '));
  // 539>310 came back from both asks: listed once, the later-leaving one that still fits.
  const b310 = its.filter((it) => lineChain(it) === 'BUS:539>BUS:310');
  assert.equal(b310.length, 1);
  assert.equal(b310[0].departAt, '2026-10-19T03:58:00.000Z');
  // Earliest arrival first.
  assert.equal(lineChain(its[0]), 'BUS:314>SUBWAY:2');
});

test('the earlier ask failing leaves the first answer', async () => {
  const { app } = setup(async (p) => {
    if ((p as { time: string }).time !== '09:00') throw new TtcError(500, 'v2/plan', 'boom');
    return at09;
  });
  const res = await app.inject(url);
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().itineraries.length, 3);
});

test('shiftLocal crosses midnight; ranking breaks arrival ties by fewer changes', () => {
  assert.equal(shiftLocal('2026-10-19T00:10', -TTC_EARLIER_MIN), '2026-10-18T23:55');
  assert.equal(shiftLocal('2026-10-19T09:00', -15), '2026-10-19T08:45');
  const mk = (arriveAt: string, transfers: number, departAt = '2026-10-19T04:00:00.000Z') => ({ id: `${arriveAt}${transfers}`, departAt, arriveAt, transfers, durationSec: 0, walkSec: 0, walkM: 0, legs: [] }) as Itinerary;
  const sorted = [mk('2026-10-19T04:50:30.000Z', 2), mk('2026-10-19T04:50:10.000Z', 1), mk('2026-10-19T04:40:00.000Z', 3)].sort(byArrivalThenTransfers);
  assert.deepEqual(sorted.map((i) => i.transfers), [3, 1, 2]);
  // One per chain: a late one never beats one that fits the deadline.
  const deadline = Date.parse('2026-10-19T05:00:00Z');
  const late = { ...mk('2026-10-19T05:10:00.000Z', 0, '2026-10-19T04:20:00.000Z'), legs: [] };
  const early = { ...mk('2026-10-19T04:50:00.000Z', 0, '2026-10-19T03:50:00.000Z'), legs: [] };
  assert.deepEqual(onePerChain([late, early], deadline), [early]);
});

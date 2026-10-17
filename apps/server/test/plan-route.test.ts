import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import Fastify from 'fastify';
import { registerPlanRoute } from '../src/plan/route.ts';
import { TtcError, type TtcClient } from '../src/ttc/client.ts';

const raw = JSON.parse(await readFile(new URL('./fixtures/plan-otp-synthetic.json', import.meta.url), 'utf8'));

const setup = (plan: (p: unknown) => Promise<unknown>) => {
  const calls: unknown[] = [];
  const app = Fastify();
  const fake = { plan: (p: unknown) => (calls.push(p), plan(p)) } as unknown as TtcClient;
  registerPlanRoute(app, fake);
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
    locale: 'ka',
  });
});

test('caches identical queries', async () => {
  const { app, calls } = setup(async () => raw);
  await app.inject(url);
  await app.inject(url);
  assert.equal(calls.length, 1);
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

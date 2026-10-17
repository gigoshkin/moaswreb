import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { config } from '../src/config.ts';
import { registerRateLimit } from '../src/ratelimit.ts';
import { TtcBusyError, TtcClient } from '../src/ttc/client.ts';

test('rate limit: per IP and bucket, chat stricter, health exempt, resets each minute', async () => {
  let t = 0;
  const app = Fastify();
  registerRateLimit(app, { perMin: 3, chatPerMin: 1, chatPerDay: 0, chatPerDayTotal: 0 }, () => t);
  app.get('/plan', async () => ({ ok: true }));
  app.post('/chat', async () => ({ ok: true }));
  app.get('/health', async () => ({ ok: true }));
  const get = (url: string, ip = '1.1.1.1') => app.inject({ url, remoteAddress: ip }).then((r) => r.statusCode);

  assert.deepEqual([await get('/plan'), await get('/plan'), await get('/plan'), await get('/plan')], [200, 200, 200, 429]);
  assert.equal(await get('/plan', '2.2.2.2'), 200, 'other clients unaffected');
  assert.equal(await get('/health'), 200, 'health is never limited');
  const chat = () => app.inject({ method: 'POST', url: '/chat', remoteAddress: '1.1.1.1' });
  assert.equal((await chat()).statusCode, 200);
  const limited = await chat();
  assert.equal(limited.statusCode, 429);
  assert.ok(Number(limited.headers['retry-after']) > 0);
  t += 60_000;
  assert.equal(await get('/plan'), 200, 'new window');
});

test('TTC queue: past maxQueue waiting requests, callers fail fast without calling TTC', async () => {
  const ttc = new TtcClient();
  let calls = 0;
  // Stand-in for the network call so nothing leaves the machine.
  (ttc as unknown as { request: () => Promise<unknown> }).request = () => (calls++, new Promise((r) => setTimeout(() => r([]), 1)));
  const waiting = Array.from({ length: config.ttc.maxQueue }, () => ttc.stops());
  await assert.rejects(ttc.stops(), TtcBusyError);
  await Promise.all(waiting);
  assert.equal(calls, config.ttc.maxQueue);
  await ttc.stops();
  assert.equal(calls, config.ttc.maxQueue + 1, 'accepts again once drained');
});

test('chat daily quota: per IP, per device, and a total cap; resets at midnight in Tbilisi', async () => {
  let t = Date.UTC(2026, 9, 17, 8, 0);
  const app = Fastify();
  registerRateLimit(app, { perMin: 100, chatPerMin: 100, chatPerDay: 2, chatPerDayTotal: 5 }, () => t);
  app.post('/chat', async () => ({ ok: true }));
  const chat = (ip: string, device?: string) =>
    app.inject({ method: 'POST', url: '/chat', remoteAddress: ip, headers: device ? { 'x-device-id': device } : {} });

  assert.deepEqual([(await chat('1.1.1.1')).statusCode, (await chat('1.1.1.1')).statusCode], [200, 200]);
  const third = await chat('1.1.1.1');
  assert.equal(third.statusCode, 429);
  assert.equal(third.json().error, 'quota');
  assert.equal((await chat('2.2.2.2', 'phone-a')).statusCode, 200);
  assert.equal((await chat('3.3.3.3', 'phone-a')).statusCode, 200);
  assert.equal((await chat('4.4.4.4', 'phone-a')).statusCode, 429, 'same device from a new IP');
  assert.equal((await chat('5.5.5.5')).statusCode, 200, 'fifth request of the day');
  assert.equal((await chat('6.6.6.6')).statusCode, 429, 'total cap reached');
  t += 24 * 60 * 60_000;
  assert.equal((await chat('1.1.1.1')).statusCode, 200, 'next day');
});

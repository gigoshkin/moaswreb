import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import Fastify from 'fastify';
import type { StoredTrip } from '@transit/shared';
import { Sealer, deviceHash } from '../src/store/crypto.ts';
import { registerMeRoutes } from '../src/store/route.ts';
import { TripStore } from '../src/store/trips.ts';

const key = randomBytes(32).toString('base64');
const trip: StoredTrip = { id: 't1', fromStopId: '1:1405', toStopId: '1:2000', arriveBy: '09:00', days: [1, 2, 3, 4, 5], walkMin: 5 };
const DEVICE = 'dev-0123456789abcdefghijkl';

test('sealer round-trips and rejects tampering or a wrong key', () => {
  const s = new Sealer(key);
  const sealed = s.seal({ a: 1 });
  assert.deepEqual(s.open(sealed), { a: 1 });
  const bad = Buffer.from(sealed, 'base64');
  bad[bad.length - 1] ^= 1;
  assert.throws(() => s.open(bad.toString('base64')));
  assert.throws(() => new Sealer(randomBytes(32).toString('base64')).open(sealed));
  assert.throws(() => new Sealer('short'));
});

test('the database file holds no stop ids, times or device ids in the clear', () => {
  const dir = mkdtempSync(join(tmpdir(), 'trips-'));
  const store = new TripStore(dir, new Sealer(key));
  store.putTrips(DEVICE, [trip]);
  store.putPushToken(DEVICE, 'ExponentPushToken[abc]');
  assert.deepEqual(store.get(DEVICE), [trip]);
  const raw = readFileSync(join(dir, 'app.sqlite')).toString('latin1');
  for (const secret of ['1:1405', '09:00', DEVICE, 'ExponentPushToken']) assert.ok(!raw.includes(secret), secret);
  assert.ok(raw.includes(deviceHash(DEVICE)));
});

test('purge removes devices idle for 30 days; delete removes everything', () => {
  const store = new TripStore('', new Sealer(key), ':memory:');
  store.putTrips(DEVICE, [trip]);
  assert.equal(store.purge(Date.now() + 29 * 86400_000), 0);
  assert.equal(store.purge(Date.now() + 31 * 86400_000), 1);
  store.putTrips(DEVICE, [trip]);
  store.delete(DEVICE);
  assert.deepEqual(store.all(), []);
});

test('/me routes validate input and scope data to the device', async () => {
  const store = new TripStore('', new Sealer(key), ':memory:');
  const app = Fastify();
  registerMeRoutes(app, store);
  const h = { 'x-device-id': DEVICE };
  assert.equal((await app.inject({ method: 'PUT', url: '/me/trips', headers: h, payload: { trips: [trip] } })).statusCode, 200);
  assert.deepEqual((await app.inject({ method: 'GET', url: '/me/trips', headers: h })).json(), { trips: [trip] });
  assert.deepEqual((await app.inject({ method: 'GET', url: '/me/trips', headers: { 'x-device-id': 'other-0123456789abcdefghij' } })).json(), { trips: [] });
  // Unknown fields (e.g. an address sent by mistake) are stripped by Fastify, never stored.
  const withAddress = { trips: [{ ...trip, address: 'Vazha-Pshavela 1' }] };
  assert.equal((await app.inject({ method: 'PUT', url: '/me/trips', headers: h, payload: withAddress })).statusCode, 200);
  assert.deepEqual(store.get(DEVICE), [trip]);
  // No device id, a short id and bad times are rejected.
  assert.equal((await app.inject({ method: 'GET', url: '/me/trips' })).statusCode, 400);
  assert.equal((await app.inject({ method: 'GET', url: '/me/trips', headers: { 'x-device-id': 'short' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'PUT', url: '/me/trips', headers: h, payload: { trips: [{ ...trip, arriveBy: '9am' }] } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'PUT', url: '/me/push', headers: h, payload: { token: 'nope' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'DELETE', url: '/me', headers: h })).statusCode, 200);
  assert.deepEqual(store.all(), []);
});

test('DELETE /me works with no body and no content-type (as the app sends it)', async () => {
  const store = new TripStore('', new Sealer(key), ':memory:');
  const app = Fastify();
  registerMeRoutes(app, store);
  store.putTrips(DEVICE, [trip]);
  const res = await app.inject({ method: 'DELETE', url: '/me', headers: { 'x-device-id': DEVICE } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(store.all(), []);
});

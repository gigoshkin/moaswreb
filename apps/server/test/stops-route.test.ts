import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { registerStopRoutes } from '../src/stops/route.ts';
import { TtcError, type TtcClient } from '../src/ttc/client.ts';
import { StopIndex } from '../src/ttc/stops.ts';
import { fakeTtc } from './fakes.ts';

const setup = (ttc = fakeTtc()) => {
  const app = Fastify();
  registerStopRoutes(app, { ttc, stops: new StopIndex(ttc) });
  return { app, ttc };
};

test('GET /stops matches Georgian or English names; English by default, Georgian on request', async () => {
  const { app } = setup();
  const en = (await app.inject('/stops?q=უნივერსიტეტი')).json();
  assert.equal(en.stops[0].id, '1:1405');
  assert.equal(en.stops[0].name, 'Free University');
  const ka = (await app.inject('/stops?q=free&locale=ka')).json();
  assert.equal(ka.stops[0].name, 'თავისუფალი უნივერსიტეტი');
  assert.equal((await app.inject('/stops')).statusCode, 400);
});

test('GET /stops/near returns nearest first with distance, filters by mode, rejects points outside Tbilisi', async () => {
  const { app } = setup();
  const body = (await app.inject('/stops/near?lat=41.7099&lon=44.7929&radius=2000')).json();
  assert.deepEqual(body.stops.map((s: { id: string }) => s.id), ['1:1405', '1:1000', '1:3000']);
  assert.equal(body.stops[0].distanceM, 0);
  assert.ok(body.stops[1].distanceM > 900);
  const metro = (await app.inject('/stops/near?lat=41.72&lon=44.8&mode=SUBWAY')).json();
  assert.deepEqual(metro.stops.map((s: { id: string }) => s.id), ['1:3000']);
  assert.equal((await app.inject('/stops/near?lat=51.5&lon=-0.12')).statusCode, 400);
});

test('GET /stops/:id/arrivals sorts live first and skips TTC for unknown or malformed ids', async () => {
  const { app, ttc } = setup();
  const body = (await app.inject('/stops/1:1405/arrivals')).json();
  assert.equal(body.stop.name, 'Free University');
  assert.deepEqual(body.arrivals.map((a: { route: string }) => a.route), ['306', '347', '558']);
  assert.equal(body.arrivals[2].realtime, false);
  assert.equal((await app.inject('/stops/1:9999/arrivals')).statusCode, 404);
  assert.equal((await app.inject('/stops/abc/arrivals')).statusCode, 400);
  assert.equal((await app.inject('/stops/1:metro_1_11/arrivals')).statusCode, 404); // valid metro id shape, not in the fake index
  assert.equal(ttc.calls.filter((c) => c.startsWith('arrivals:')).length, 1);
});

test('GET /places maps OSM features to places', async () => {
  const { app } = setup();
  const body = (await app.inject('/places?q=delisi')).json();
  assert.deepEqual(body.places, [{ name: 'Delisi', address: null, lat: 41.7286, lon: 44.7712, kind: null }]);
});

test('TTC failure → 503', async () => {
  const ttc = fakeTtc();
  (ttc as unknown as { geocode: TtcClient['geocode'] }).geocode = async () => {
    throw new TtcError(500, 'v2/geocode', 'boom');
  };
  const { app } = setup(ttc);
  const res = await app.inject('/places?q=delisi');
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().error, 'upstream');
});

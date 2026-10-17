import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { normalizePlan } from '../src/plan/normalize.ts';

const raw = JSON.parse(await readFile(new URL('./fixtures/plan-otp-synthetic.json', import.meta.url), 'utf8'));

test('sorts itineraries by arrival and keeps all legs', () => {
  const its = normalizePlan(raw);
  assert.equal(its.length, 2);
  assert.equal(its[0].legs[1].mode, 'SUBWAY');
  assert.equal(its[1].legs.length, 4);
});

test('reads epoch ms and ISO times as UTC ISO', () => {
  const bus = normalizePlan(raw)[1];
  assert.equal(bus.departAt, '2026-10-19T04:15:00.000Z');
  assert.equal(bus.legs[2].departAt, '2026-10-19T04:42:00.000Z');
});

test('reads route as string or object, normalises colour', () => {
  const legs = normalizePlan(raw)[1].legs;
  assert.deepEqual(legs[0].route, null);
  assert.deepEqual(legs[1].route, { shortName: '306', longName: 'Rustaveli - Vazha-Pshavela', color: '#E02B2B' });
  assert.deepEqual(legs[2].route, { shortName: '347', longName: null, color: '#1E88E5' });
});

test('derives walk totals and transfers when TTC omits them', () => {
  const [metro, bus] = normalizePlan(raw);
  assert.equal(metro.walkSec, 420);
  assert.equal(metro.transfers, 0);
  assert.equal(bus.walkM, 610);
  assert.equal(bus.transfers, 1);
  assert.equal(bus.id, '08:15-306-347');
});

test('legs keep stops, polyline and realtime flag', () => {
  const leg = normalizePlan(raw)[1].legs[1];
  assert.equal(leg.intermediateStops, 4);
  assert.equal(leg.polyline, 'abc~');
  assert.equal(leg.realtime, false);
  assert.equal(leg.from.stopId, '1:1000');
});

test('empty or wrapped responses', () => {
  assert.deepEqual(normalizePlan({}), []);
  assert.equal(normalizePlan({ plan: { itineraries: raw.itineraries } }).length, 2);
});

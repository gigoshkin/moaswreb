import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PlanService } from '../src/plan/service.ts';
import type { TtcClient } from '../src/ttc/client.ts';
import { StopIndex } from '../src/ttc/stops.ts';

// Real TTC v2/plan response (17 Oct 2026): ride legs' from/to have no stop id.
const live = JSON.parse(await readFile(new URL('./fixtures/plan-ttc-live-2026-10-17.json', import.meta.url), 'utf8'));
const firstRide = live.itineraries[0].legs.find((l: { mode: string }) => l.mode !== 'WALK');

const stopAt = (id: string, p: { lat: number; lon: number }, vehicleMode = 'BUS') => ({ id, code: null, name: id, lat: p.lat, lon: p.lon, vehicleMode });

// Itineraries come back sorted by arrival, so find the ride by its boarding point.
const rideOf = (plan: { itineraries: Array<{ legs: Array<{ mode: string; from: { lat: number; lon: number; stopId: string | null }; to: { stopId: string | null } }> }> }) =>
  plan.itineraries.flatMap((it) => it.legs).find((l) => l.mode !== 'WALK' && l.from.lat === firstRide.from.lat && l.from.lon === firstRide.from.lon)!;

const service = (stops: unknown[]) => {
  const ttc = { plan: async () => live, stops: async () => stops } as unknown as TtcClient;
  return new PlanService(ttc, new StopIndex(ttc));
};
const query = { from: { lat: 41.7151, lon: 44.8271 }, to: { lat: 41.7099, lon: 44.7929 }, arriveBy: '2026-10-19T09:00' };

test('fills boarding/alighting stop ids from the stop index, preferring the exact stop over a close one', async () => {
  const { from, to } = firstRide;
  const plan = await service([
    stopAt('1:7', { lat: from.lat + 0.00006, lon: from.lon }), // ~7 m away, other direction
    stopAt('1:1767', from),
    stopAt('1:20148', to),
  ]).plan(query);
  const ride = rideOf(plan);
  assert.equal(ride.from.stopId, '1:1767');
  assert.equal(ride.to.stopId, '1:20148');
  for (const walk of plan.itineraries.flatMap((it) => it.legs).filter((l) => l.mode === 'WALK')) {
    assert.equal(walk.from.stopId, null);
  }
});

test('ignores stops of another mode or too far away; a failing stop index leaves ids null', async () => {
  const { from, to } = firstRide;
  const plan = await service([stopAt('1:1', from, 'SUBWAY'), stopAt('1:2', { lat: to.lat + 0.001, lon: to.lon })]).plan(query);
  const ride = rideOf(plan);
  assert.equal(ride.from.stopId, null);
  assert.equal(ride.to.stopId, null);

  const ttc = { plan: async () => live, stops: async () => { throw new Error('TTC down'); } } as unknown as TtcClient;
  const down = await new PlanService(ttc, new StopIndex(ttc)).plan(query);
  assert.equal(down.itineraries.length, 3);
});

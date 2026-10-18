/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { leaveAtMs, type Itinerary, type PlanLeg } from '@transit/shared';
import { choose, firstWalkMin, lastWalkMin, leaveAt } from '../src/lib/plans.ts';

const place = { name: 'x', lat: 41.7, lon: 44.7, stopId: null };
const leg = (mode: string, dep: string, arr: string, name?: string): PlanLeg => ({
  mode, from: place, to: place, departAt: dep, arriveAt: arr, durationSec: (Date.parse(arr) - Date.parse(dep)) / 1000, distanceM: 0,
  route: name ? { shortName: name, longName: null, color: null } : null, headsign: null, realtime: false, intermediateStops: 0, polyline: null,
}) as PlanLeg;

// Walk 6 > bus 314 > walk 4 > metro 2 > walk 3 (Didi Dighomi -> Zurab Anjaparidze St shape).
const busMetro: Itinerary = {
  id: '07:27-314-2', departAt: '2026-10-19T03:27:00.000Z', arriveAt: '2026-10-19T04:33:00.000Z', durationSec: 3960, walkSec: 780, walkM: 900, transfers: 1,
  legs: [
    leg('WALK', '2026-10-19T03:27:00.000Z', '2026-10-19T03:33:00.000Z'),
    leg('BUS', '2026-10-19T03:35:00.000Z', '2026-10-19T04:05:00.000Z', '314'),
    leg('WALK', '2026-10-19T04:05:00.000Z', '2026-10-19T04:09:00.000Z'),
    leg('SUBWAY', '2026-10-19T04:12:00.000Z', '2026-10-19T04:30:00.000Z', '2'),
    leg('WALK', '2026-10-19T04:30:00.000Z', '2026-10-19T04:33:00.000Z'),
  ],
};

test('multi-leg: leave from the first ride minus the first walk only; arrival from the last leg', () => {
  assert.equal(firstWalkMin(busMetro), 6);
  assert.equal(lastWalkMin(busMetro), 3);
  assert.equal(leaveAt(busMetro), leaveAtMs(Date.parse('2026-10-19T03:35:00.000Z'), 6));
  const c = choose([busMetro], '2026-10-19T09:00', Date.parse('2026-10-19T03:00:00Z'));
  assert.equal(c.kind, 'onTime');
  if (c.kind === 'onTime') assert.equal(c.it.arriveAt, busMetro.legs.at(-1)!.arriveAt);
});

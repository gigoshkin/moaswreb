/// <reference types="node" />
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import type { Itinerary, PlanLeg } from '@transit/shared';

// The app imports its own files without an extension (Metro resolves them); let Node do the same here.
registerHooks({
  resolve: (spec, ctx, next) => {
    try {
      return next(spec, ctx);
    } catch (e) {
      if (spec.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(spec)) return next(`${spec}.ts`, ctx);
      throw e;
    }
  },
});
const { groupWays, sameWay, variantSteps, rideChoice, toggleRideLine } = await import('../src/lib/ways.ts');
const { wireSteps } = await import('../src/lib/plans.ts');

// SYNTHETIC stops in the shape of Didi Dighomi -> Caucasus University: 321, 335 and minibus 518
// stop a few dozen metres apart near the same metro station, then metro 1, then 490.
const P = (stopId: string, lat: number, lon: number) => ({ name: stopId, stopId, lat, lon });
const home = P('1:home321', 41.791, 44.738);
const home335 = P('1:home335', 41.7912, 44.7383); // ~30 m from home
const homeFar = P('1:far', 41.80, 44.738); // ~1 km away
const metroBus = P('1:m-bus', 41.7225, 44.797);
const metroBus518 = P('1:m-bus-518', 41.7231, 44.7975); // ~80 m from metroBus
const metroA = P('1:metro_1_a', 41.722, 44.796);
const metroB = P('1:metro_1_b', 41.70, 44.80);
const b490a = P('1:490a', 41.699, 44.801);
const b490b = P('1:490b', 41.706, 44.811);

const ride = (mode: string, line: string, from: PlanLeg['from'], to: PlanLeg['to'], minibus = false): PlanLeg =>
  ({ mode, from, to, departAt: '', arriveAt: '', durationSec: 0, distanceM: 0, route: { shortName: line, longName: null, color: null, minibus }, headsign: null, realtime: false, intermediateStops: 0, polyline: null }) as PlanLeg;
const it = (arr: string, legs: PlanLeg[]): Itinerary => ({
  id: legs.map((l) => l.route?.shortName).join('-') + arr, departAt: '2026-10-19T09:30:00.000Z', arriveAt: `2026-10-19T${arr}:00.000Z`,
  durationSec: 0, walkSec: 0, walkM: 0, transfers: legs.length - 1, legs,
});
const tail = [ride('SUBWAY', '1', metroA, metroB), ride('BUS', '490', b490a, b490b)];
const via321 = it('10:50', [ride('BUS', '321', home, metroBus), ...tail]);
const via335 = it('10:52', [ride('BUS', '335', home335, metroBus), ...tail]);
const via518 = it('10:55', [ride('BUS', '518', home, metroBus518, true), ...tail]);

test('rides boarding and leaving at stops within 150 m stack into one way', () => {
  const ways = groupWays([via518, via335, via321], 0);
  assert.equal(ways.length, 1);
  assert.deepEqual(ways[0].its.map((i) => i.legs[0].route!.shortName), ['321', '335', '518']);
  assert.deepEqual(ways[0].slots.map((s) => s.map((l) => l.label)), [['321', '335', '518'], ['1'], ['490']]);
});

test('far stops, other modes, other ride counts or two differing rides stay apart', () => {
  const far = it('10:51', [ride('BUS', '330', homeFar, metroBus), ...tail]);
  assert.equal(sameWay(via321, far), false);
  const bus1 = it('10:51', [ride('BUS', '321', home, metroBus), ride('BUS', '1', metroA, metroB), tail[1]]);
  assert.equal(sameWay(via321, bus1), false);
  assert.equal(sameWay(via321, it('10:51', [ride('BUS', '321', home, metroBus), tail[0]])), false);
  // First ride from a neighbouring stop AND last ride from a neighbouring stop: two rides differ.
  const twoNear = it('10:51', [ride('BUS', '335', home335, metroBus), tail[0], ride('BUS', '451', P('1:451a', 41.6992, 44.8012), b490b)]);
  assert.equal(sameWay(via321, twoNear), false);
  assert.equal(groupWays([via321, far, twoNear], 0).length, 3);
});

test('a picked way becomes its rides: every variation of each ride allowed, its own stops first', () => {
  const far = it('10:51', [ride('BUS', '330', homeFar, metroBus), ...tail]);
  const steps = variantSteps(via335, [via321, via335, via518, far])!;
  assert.equal(steps.length, 3, 'the rides stay: bus, metro, bus');
  assert.deepEqual(steps[0].fromStops, ['1:home335', '1:home321']);
  assert.deepEqual(steps[0].toStops, ['1:m-bus', '1:m-bus-518']);
  assert.deepEqual(steps[0].routes, ['335', '321', '518'], '330 from a stop 1 km away is another way, not a variation');
  assert.deepEqual(steps[0].lines!.map((l) => l.kind), ['bus', 'bus', 'minibus']);
  assert.deepEqual(steps[1], { fromStops: ['1:metro_1_a'], toStops: ['1:metro_1_b'], routes: ['1'], lines: [{ label: '1', kind: 'metro' }] });
  assert.deepEqual(steps[2].routes, ['490']);
  // What the server gets: stops and allowed lines only.
  assert.deepEqual(wireSteps(steps)[0], { fromStops: ['1:home335', '1:home321'], toStops: ['1:m-bus', '1:m-bus-518'], routes: ['335', '321', '518'] });
  // A ride without a stop id can't be pinned.
  assert.equal(variantSteps(it('10:50', [ride('BUS', '321', { ...home, stopId: null }, metroBus)]), []), undefined);
});

test('ticking lines of a ride: at least one stays, unticked ones can come back', () => {
  const [first] = variantSteps(via321, [via321, via335, via518])!;
  let s = toggleRideLine(first, '335');
  assert.deepEqual(s.routes, ['321', '518']);
  s = toggleRideLine(toggleRideLine(s, '518'), '321');
  assert.deepEqual(s.routes, ['321'], 'the last ticked line stays');
  assert.deepEqual(rideChoice(s).lines.map((l) => l.label), ['321', '335', '518'], 'unticked lines are still offered');
  assert.deepEqual(toggleRideLine(s, '335').routes, ['321', '335']);
});

test('a ride saved without its line list (older trips) offers the planned lines, all ticked, and pins them once changed', () => {
  const old = { fromStops: ['1:home321'], toStops: ['1:m-bus'] };
  const planned = [{ label: '321', kind: 'bus' as const }, { label: '335', kind: 'bus' as const }];
  assert.deepEqual(rideChoice(old, planned).on, ['321', '335']);
  const s = toggleRideLine(old, '321', planned);
  assert.deepEqual(s.routes, ['335']);
  assert.deepEqual(s.lines, planned);
  // Allowed lines the plan didn't return are still listed.
  assert.deepEqual(rideChoice({ ...old, routes: ['321', '999'] }, planned).on, ['321', '999']);
});

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
const { groupWays, sameWay, variantSteps, fitsWay, isTicked, toggleWay, tripWays, waysFields } = await import('../src/lib/ways.ts');
const { wireSteps, mergeItineraries, mergePlans } = await import('../src/lib/plans.ts');

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

// Two more ways for the same trip: 314 then metro 1 then 490 from other stops, and 315 > 550 (never metro).
const s314a = P('1:314a', 41.79, 44.75);
const metroC = P('1:metro_1_c', 41.73, 44.79);
const via314 = it('10:48', [ride('BUS', '314', s314a, P('1:314b', 41.731, 44.791)), { ...tail[0], from: metroC }, tail[1]]);
const via315 = it('10:45', [ride('BUS', '315', P('1:315a', 41.78, 44.76), P('1:315b', 41.71, 44.80)), ride('BUS', '550', P('1:550a', 41.709, 44.801), b490b)]);
const all = [via321, via335, via518, via314, via315];

test('a kept way fits only its own rides, stops and lines', () => {
  const kept = variantSteps(via335, all)!;
  assert.ok(fitsWay(kept, via321) && fitsWay(kept, via518), 'every variation of the ticked row');
  assert.equal(fitsWay(kept, via314), false, 'another way to the same metro');
  assert.equal(fitsWay(kept, via315), false, 'never 315 > 550');
  // Same stops, a line the way never had: not this way.
  assert.equal(fitsWay(kept, it('10:50', [ride('BUS', '999', home, metroBus), ...tail])), false);
});

test('ticking rows: each tick keeps a whole row, unticking drops it, the last one stays', () => {
  const rows = groupWays(all, 0);
  const row = (line: string) => rows.find((w) => w.its.some((i) => i.legs[0].route!.shortName === line))!;
  assert.equal(rows.length, 3);
  let kept = toggleWay([], row('335'), all);
  assert.equal(kept.length, 1);
  assert.deepEqual(kept[0][0].routes, ['321', '335', '518'], 'the row with all its variations');
  assert.ok(isTicked(row('321'), kept) && !isTicked(row('314'), kept) && !isTicked(row('315'), kept));
  kept = toggleWay(kept, row('314'), all);
  assert.equal(kept.length, 2);
  assert.ok(isTicked(row('314'), kept));
  kept = toggleWay(kept, row('321'), all);
  assert.deepEqual(kept.map((k) => k[0].routes), [['314']], 'unticked');
  assert.deepEqual(toggleWay(kept, row('314'), all), kept, 'the last ticked way stays');
});

test('kept ways on the trip: the first stays `steps`, `ways` only when there are several', () => {
  const a = variantSteps(via321, all)!;
  const b = variantSteps(via314, all)!;
  assert.deepEqual(tripWays({}), []);
  assert.deepEqual(tripWays({ steps: a }), [a], 'trips saved before ways');
  assert.deepEqual(waysFields([a]), { steps: a, ways: undefined });
  assert.deepEqual(waysFields([a, b]), { steps: a, ways: [a, b] });
  assert.deepEqual(tripWays(waysFields([a, b])), [a, b]);
  assert.deepEqual(waysFields([]), { steps: undefined, ways: undefined });
});

test('plans of several ways merge: each option once, earliest arrival first, unique ids', () => {
  const dup = { ...via321 };
  const clash = { ...via314, id: via321.id };
  const merged = mergeItineraries([[via335, via321], [dup, clash]]);
  assert.deepEqual(merged.map((i) => i.legs[0].route!.shortName), ['314', '321', '335']);
  assert.equal(new Set(merged.map((i) => i.id)).size, 3);
  const plan = (its: Itinerary[]) => ({ query: { from: home, to: b490b, arriveBy: '2026-10-19T11:00' }, itineraries: its, source: 'ttc' as const, fetchedAt: '' });
  const one = plan([via321]);
  assert.equal(mergePlans([one]), one, 'one way: the plan as it came');
  assert.equal(mergePlans([]), null);
  assert.equal(mergePlans([one, plan([via314])])!.itineraries.length, 2);
});

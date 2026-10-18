/// <reference types="node" />
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import type { Itinerary, PlanLeg } from '@transit/shared';

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
// The app's helpers are the shared ones: one implementation for the app, the chat and the server.
const app = await import('../src/lib/ways.ts');
const shared = await import('@transit/shared');
const { choose, suggestOther } = await import('../src/lib/plans.ts');
const { groupWays, sameWay, fitsWay, variantSteps, isTicked, wayLabel, namesWay, defaultKept, bestWay, structureOf } = shared;

// SYNTHETIC trip in the shape of Didi Dighomi -> Liberty Square, arrive by 09:00 (05:00Z).
const P = (stopId: string, lat: number, lon: number) => ({ name: stopId, stopId, lat, lon });
const home = P('1:home', 41.791, 44.738);
const home335 = P('1:home335', 41.7912, 44.7383); // ~30 m away
const metroBus = P('1:m-bus', 41.7225, 44.797);
const metroBus518 = P('1:m-bus-518', 41.7231, 44.7975); // ~80 m away
const metroA = P('1:metro_1_a', 41.722, 44.796);
const metroB = P('1:metro_1_b', 41.70, 44.80);
const s302a = P('1:302a', 41.7905, 44.7385); // ~60 m from home: a direct line from almost the same stop
const s302b = P('1:302b', 41.7002, 44.8002); // ~25 m from the metro exit

const ride = (mode: string, line: string, from: PlanLeg['from'], to: PlanLeg['to'], dep: string, arr: string, minibus = false): PlanLeg =>
  ({ mode, from, to, departAt: `2026-10-19T${dep}:00.000Z`, arriveAt: `2026-10-19T${arr}:00.000Z`, durationSec: 0, distanceM: 0, route: { shortName: line, longName: null, color: null, minibus }, headsign: null, realtime: false, intermediateStops: 0, polyline: null }) as PlanLeg;
const it = (legs: PlanLeg[]): Itinerary => ({
  id: legs.map((l) => `${l.route?.shortName}@${l.departAt.slice(11, 16)}`).join('-'), departAt: legs[0].departAt, arriveAt: legs.at(-1)!.arriveAt,
  durationSec: (Date.parse(legs.at(-1)!.arriveAt) - Date.parse(legs[0].departAt)) / 1000, walkSec: 0, walkM: 0, transfers: legs.length - 1, legs,
});
const metro = (dep: string, arr: string) => ride('SUBWAY', '1', metroA, metroB, dep, arr);
const via321 = it([ride('BUS', '321', home, metroBus, '04:10', '04:35'), metro('04:40', '04:52')]);
const via335 = it([ride('BUS', '335', home335, metroBus, '04:12', '04:37'), metro('04:42', '04:54')]);
const via518 = it([ride('BUS', '518', home, metroBus518, '04:14', '04:39'), metro('04:44', '04:56')]);
const direct302 = it([ride('BUS', '302', s302a, s302b, '04:05', '04:50')]);
const all = [via321, via335, via518, direct302];

test('the app uses the shared implementation, not a copy', () => {
  assert.equal(app.groupWays, shared.groupWays);
  assert.equal(app.sameWay, shared.sameWay);
  assert.equal(app.variantSteps, shared.variantSteps);
  assert.equal(app.fitsWay, shared.fitsWay);
});

test('a direct 302 is a different way from 321|335|518 -> metro 1', () => {
  assert.deepEqual(structureOf(direct302), ['bus']);
  assert.deepEqual(structureOf(via321), ['bus', 'metro']);
  assert.equal(sameWay(direct302, via321), false);
  assert.equal(sameWay(via321, direct302), false);
  const ways = groupWays(all);
  assert.equal(ways.length, 2);
  assert.deepEqual(ways.map((w) => wayLabel(w.slots)).sort(), ['321|335|518 -> metro 1', 'direct 302']);
});

test('a kept 321|335|518 -> M1 way never fits a direct 302, and the other way round', () => {
  const transfer = variantSteps(via321, all)!;
  const direct = variantSteps(direct302, all)!;
  assert.deepEqual(transfer[0].routes, ['321', '335', '518']);
  assert.deepEqual(direct.map((s) => s.routes), [['302']]);
  assert.equal(fitsWay(transfer, direct302), false);
  assert.equal(fitsWay(direct, via321), false);
  assert.ok(fitsWay(transfer, via518) && fitsWay(direct, direct302));
  const rows = groupWays(all);
  const row302 = rows.find((w) => w.slots.length === 1)!;
  const rowM1 = rows.find((w) => w.slots.length === 2)!;
  assert.equal(isTicked(row302, [transfer]), false);
  assert.equal(isTicked(rowM1, [direct]), false);
});

test('a 2-ride way never matches a 3-ride way', () => {
  const p490a = P('1:490a', 41.6995, 44.8005);
  const three = it([ride('BUS', '321', home, metroBus, '04:10', '04:35'), metro('04:40', '04:52'), ride('BUS', '490', p490a, P('1:490b', 41.69, 44.81), '04:55', '05:00')]);
  assert.equal(sameWay(three, via321), false);
  assert.equal(fitsWay(variantSteps(via321, all)!, three), false);
  assert.equal(fitsWay(variantSteps(three, [three])!, via321), false);
  assert.equal(groupWays([three, via321]).length, 2);
});

test('bus and minibus are one family, metro is another: same stops, same way only within a family', () => {
  const minibus = it([ride('BUS', '518', home, metroBus, '04:14', '04:39', true), metro('04:44', '04:56')]);
  // 518 (minibus) stands in for 321 (bus): one row, 321|518 -> metro 1.
  assert.equal(sameWay(via321, minibus), true);
  assert.equal(groupWays([via321, minibus]).length, 1);
  assert.equal(wayLabel(groupWays([via321, minibus])[0].slots), '321|518 -> metro 1');
  assert.equal(wayLabel(groupWays([minibus])[0].slots), 'minibus 518 -> metro 1');
  // A kept bus way takes the minibus over the same stops.
  const busOnly = variantSteps(via321, [via321])!.map(({ routes: _r, ...s }) => s);
  assert.ok(fitsWay(busOnly, minibus));
  assert.ok(fitsWay(busOnly, via321));
  // A metro ride is not a bus ride between the same stops.
  const busOnMetroStops = it([ride('BUS', '321', home, metroBus, '04:10', '04:35'), ride('BUS', '1', metroA, metroB, '04:40', '04:52')]);
  assert.equal(sameWay(via321, busOnMetroStops), false);
});

test('ways are named the same for the app and the chat, and a name finds its way', () => {
  const [a, b] = groupWays(all).sort((x, y) => x.slots.length - y.slots.length);
  assert.equal(wayLabel(a.slots), 'direct 302');
  assert.ok(namesWay(a, 'direct 302') && namesWay(a, '302'));
  assert.ok(namesWay(b, '321|335|518 -> metro 1') && namesWay(b, '335 > 1'));
  assert.equal(namesWay(b, '302'), false);
  assert.equal(namesWay(a, '321 -> metro 1'), false);
});

test('saving a plan with nothing ticked keeps the best way only; named ways win', () => {
  const now = Date.parse('2026-10-19T03:30:00Z');
  const ways = groupWays(all);
  const best = bestWay(ways, '2026-10-19T09:00', now)!;
  const kept = defaultKept(all, '2026-10-19T09:00', now);
  assert.equal(kept.length, 1);
  assert.ok(isTicked(best, kept));
  const named = defaultKept(all, '2026-10-19T09:00', now, 0, ['direct 302', '321 -> metro 1']);
  assert.equal(named.length, 2);
  assert.ok(ways.every((w) => isTicked(w, named)));
});

test('another way only when every kept way missed, and only when it is faster', () => {
  const deadline = '2026-10-19T09:00';
  const now = Date.parse('2026-10-19T03:30:00Z');
  const onTime = choose([via321], deadline, now);
  const other = choose([direct302], deadline, now);
  assert.equal(onTime.kind, 'onTime');
  assert.equal(suggestOther({ keepsWays: true, kept: onTime, other }), null, 'a kept way works: nothing else is shown');
  assert.equal(suggestOther({ keepsWays: false, kept: { kind: 'none' }, other }), null, 'no kept ways: the app already picks');
  const lateRide = it([ride('BUS', '321', home, metroBus, '04:40', '05:05'), metro('05:08', '05:20')]);
  const late = choose([lateRide], deadline, now);
  assert.equal(late.kind, 'late');
  const s = suggestOther({ keepsWays: true, kept: late, other })!;
  assert.equal(s.it, direct302);
  assert.equal(s.onTime, true);
  assert.equal(suggestOther({ keepsWays: true, kept: { kind: 'none' }, other })?.it, direct302, 'no kept ride at all');
  // The other way is late too: only offered when it arrives sooner than the kept one.
  const later302 = it([ride('BUS', '302', s302a, s302b, '04:45', '05:30')]);
  assert.equal(suggestOther({ keepsWays: true, kept: late, other: choose([later302], deadline, now) }), null);
  const sooner302 = it([ride('BUS', '302', s302a, s302b, '04:35', '05:10')]);
  assert.equal(suggestOther({ keepsWays: true, kept: late, other: choose([sooner302], deadline, now) })?.onTime, false);
  assert.equal(suggestOther({ keepsWays: true, kept: late, other: { kind: 'none' } }), null);
});

test('a kept way opened in the hand builder comes back the same way, variations included', async () => {
  const { rideFromStep, stepOf, toggleLine } = await import('../src/lib/chain.ts');
  const kept = variantSteps(via335, all)!;
  const stop = (p: typeof home) => ({ id: p.stopId, name: p.name, lat: p.lat, lon: p.lon, mode: 'BUS' });
  const rides = [rideFromStep(kept[0], stop(home335), stop(metroBus), { label: '335', kind: 'bus' }), rideFromStep(kept[1], stop(metroA), stop(metroB), { label: '1', kind: 'metro' })];
  const back = rides.map(stepOf);
  assert.deepEqual(back.map((s) => s.fromStops), kept.map((s) => s.fromStops));
  assert.deepEqual(back.map((s) => s.toStops), kept.map((s) => s.toStops));
  assert.deepEqual(back[0].lines!.map((l) => l.label), ['335', '321', '518']);
  for (const x of [via321, via335, via518]) assert.ok(fitsWay(back, x), 'still every variation');
  assert.equal(fitsWay(back, direct302), false);
  // The built way joins the kept ways in the first place, the others stay, no copy of it twice.
  const direct = variantSteps(direct302, all)!;
  assert.deepEqual(shared.withBuiltWay([kept, direct], back), [back, direct]);
  assert.deepEqual(shared.withBuiltWay([kept, back], back), [back]);
  assert.deepEqual(shared.withBuiltWay([], back), [back]);
  // Switching a line off in the builder narrows the way to the lines left.
  const narrowed = stepOf(toggleLine(rides[0], '518'));
  assert.deepEqual(narrowed.routes, ['335', '321']);
  assert.equal(fitsWay([narrowed, back[1]], via518), false);
});

test('chat cards save exactly the ticked ways, through the same fields as every screen', () => {
  const { cardKept, waysFields, tripWays, toggleWay } = shared;
  const now = Date.parse('2026-10-19T03:30:00Z');
  const plan = { query: { from: home, to: s302b, arriveBy: '2026-10-19T09:00' }, itineraries: all, source: 'ttc' as const, fetchedAt: '' };
  const direct = variantSteps(direct302, all)!;
  // The server ticked the direct 302: the card starts with exactly that.
  assert.deepEqual(cardKept({ ways: [direct], plan }, now), [direct]);
  // A hand-built route is its own way.
  const built = [{ fromStops: ['1:home'], toStops: ['1:m-bus'], routes: ['321'] }];
  assert.deepEqual(cardKept({ steps: built, plan }, now), [built]);
  assert.deepEqual(cardKept({ plan: { ...plan, query: { ...plan.query, steps: built } } }, now), [built]);
  // Nothing ticked (an older server): the best way only, never an empty, unpinned trip.
  const dflt = cardKept({ plan }, now);
  assert.equal(dflt.length, 1);
  assert.ok(isTicked(bestWay(groupWays(all), '2026-10-19T09:00', now)!, dflt));
  assert.deepEqual(cardKept({}, now), [], 'no plan yet: nothing to tick');
  // Ticking a second row on the card and saving: both ways, the first as steps (what alerts plan with).
  const rows = groupWays(all);
  const other = rows.find((w) => !isTicked(w, dflt))!;
  const two = toggleWay(dflt, other, all);
  const saved = waysFields(two);
  assert.equal(saved.steps, two[0]);
  assert.deepEqual(tripWays(saved), two);
  assert.ok(rows.every((w) => isTicked(w, tripWays(saved))));
});

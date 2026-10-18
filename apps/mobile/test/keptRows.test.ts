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
const { keptRows } = await import('../src/lib/keptRows.ts');
const { stepSlots, variantSteps, wayLabel } = await import('../src/lib/ways.ts');

// SYNTHETIC stops: 321 and 335 from the same stop to a metro station, then metro 1; 314 is another way.
const P = (stopId: string, lat: number, lon: number) => ({ name: stopId, stopId, lat, lon });
const home = P('1:home', 41.791, 44.738);
const busStop = P('1:bus', 41.7225, 44.797);
const metroA = P('1:metro_a', 41.722, 44.796);
const metroB = P('1:metro_b', 41.7, 44.8);
const other = P('1:other', 41.79, 44.75);
const otherEnd = P('1:other_end', 41.73, 44.79);

const ride = (mode: string, line: string, from: PlanLeg['from'], to: PlanLeg['to'], at: string): PlanLeg =>
  ({ mode, from, to, departAt: `2026-10-19T${at}:00.000Z`, arriveAt: `2026-10-19T${at}:00.000Z`, durationSec: 600, distanceM: 0, route: { shortName: line, longName: null, color: null, minibus: false }, headsign: null, realtime: false, intermediateStops: 0, polyline: null }) as PlanLeg;
const it = (id: string, arr: string, legs: PlanLeg[]): Itinerary => ({ id, departAt: legs[0].departAt, arriveAt: `2026-10-19T${arr}:00.000Z`, durationSec: 3000, walkSec: 0, walkM: 0, transfers: legs.length - 1, legs });

const via321 = it('a', '10:50', [ride('BUS', '321', home, busStop, '10:00'), ride('SUBWAY', '1', metroA, metroB, '10:10')]);
const via335 = it('b', '10:55', [ride('BUS', '335', home, busStop, '10:05'), ride('SUBWAY', '1', metroA, metroB, '10:15')]);
const via314 = it('c', '10:40', [ride('BUS', '314', other, otherEnd, '09:50'), ride('SUBWAY', '1', metroA, metroB, '10:00')]);
const all = [via321, via335, via314];
const arriveBy = '2026-10-19T15:00'; // Tbilisi wall clock (UTC+4): 11:00Z
const now = Date.parse('2026-10-19T05:00:00.000Z');

test('a kept way is a chain from its own steps, before any plan', () => {
  const steps = variantSteps(via321, [via321, via335])!;
  assert.equal(wayLabel(stepSlots(steps)), '321|335 -> metro 1');
  const [row] = keptRows([steps], [], arriveBy, now);
  assert.equal(wayLabel(row.slots), '321|335 -> metro 1');
  assert.equal(row.it, null);
  assert.equal(row.leave, null);
});

test('a switched-off line is left out of the chain, and a route-only step is a bus', () => {
  const steps = variantSteps(via321, [via321, via335])!;
  const narrowed = [{ ...steps[0], routes: ['335'] }, steps[1]];
  assert.equal(wayLabel(stepSlots(narrowed)), '335 -> metro 1');
  assert.deepEqual(stepSlots([{ fromStops: ['x'], toStops: ['y'], routes: ['7', '8'] }]), [[{ label: '7', kind: 'bus' }, { label: '8', kind: 'bus' }]]);
});

test('one row per kept way, each with the option of its own way', () => {
  const kept = [variantSteps(via321, all)!, variantSteps(via314, all)!];
  const rows = keptRows(kept, all, arriveBy, now);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => wayLabel(r.slots)), ['321|335 -> metro 1', '314 -> metro 1']);
  assert.equal(rows[1].it, via314, 'the 314 row shows 314, never the other way');
  // The 321 / 335 way: the later leaving one that still arrives in time.
  assert.equal(rows[0].it, via335);
  assert.ok(rows[0].leave !== null && !rows[0].late);
  assert.notEqual(rows[0].key, rows[1].key);
});

test('a way that cannot arrive in time shows its soonest option, marked late', () => {
  const rows = keptRows([variantSteps(via321, all)!], all, '2026-10-19T14:30', now);
  assert.equal(rows[0].it, via321);
  assert.equal(rows[0].late, true);
});

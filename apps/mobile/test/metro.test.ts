/// <reference types="node" />
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import type { StopLine } from '@transit/shared';

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
const M = await import('../src/lib/metro.ts');

// SYNTHETIC metro in the shape of Tbilisi's: line 1 runs north-south through "Square 1",
// line 2 starts at "Square 2" (~170 m from Square 1, its own station id) and runs west.
const st = (id: string, lat: number, lon: number) => ({ id, name: id, lat, lon });
const n2 = st('North 2', 41.76, 44.79);
const n1 = st('North 1', 41.74, 44.795);
const sq1 = st('Square 1', 41.7221, 44.7977);
const s1 = st('South 1', 41.7, 44.8);
const s2 = st('South 2', 41.69, 44.82);
const sq2 = st('Square 2', 41.7225, 44.7958);
const w1 = st('West 1', 41.72, 44.78);
const w2 = st('West 2', 41.72, 44.76);
const line = (shortName: string, next: ReturnType<typeof st>[]): StopLine => ({ shortName, color: null, minibus: false, mode: 'SUBWAY', headsign: null, next });

// What GET /stops/:id/lines gives: line 1 at Square 1 in both directions, line 2 at its first station one way.
const atSq1 = [line('1', [s1, s2]), line('1', [n1, n2])];
const atSq2 = [line('2', [w1, w2])];
const net = M.addLines(M.addLines(M.emptyNet(), sq1, atSq1), sq2, atSq2);
const atN2 = [line('1', [n1, sq1, s1, s2])];

const legs = (r: ReturnType<typeof M.metroRides>) => r?.map((x) => `${x.lines[0].label}:${x.board.id}-${x.off.id}`);

test('boarding anywhere offers every station of every connected line', () => {
  const north = M.addLines(net, n2, atN2);
  assert.deepEqual(M.metroReach(north, 'North 2').map((s) => s.id).sort(), ['North 1', 'South 1', 'South 2', 'Square 1', 'Square 2', 'West 1', 'West 2']);
  // Both directions: from South 2, back north on the same line.
  assert.ok(M.metroReach(net, 'South 2').some((s) => s.id === 'North 2'));
  // The other station of the interchange is not a ride away from its twin.
  assert.ok(!M.metroReach(net, 'Square 1').some((s) => s.id === 'Square 2'));
});

test('a trip onto the other line is a ride to the interchange and a ride on, one line each', () => {
  const rides = M.metroRides(net, 'North 2', 'West 2')!;
  assert.deepEqual(legs(rides), ['1:North 2-Square 1', '2:Square 2-West 2']);
  assert.equal(rides[0].path.length, 3);
  assert.ok(rides.every((r) => r.board.mode === 'SUBWAY' && r.lines[0].kind === 'metro'));
  assert.ok(M.metroChange(rides[0].off, rides[1].board));
  // And the way back, against the direction it was asked in.
  assert.deepEqual(legs(M.metroRides(net, 'West 1', 'South 2')), ['2:West 1-Square 2', '1:Square 1-South 2']);
  // Boarding at the interchange's other station walks over first: the ride starts at line 2's station.
  assert.deepEqual(legs(M.metroRides(net, 'Square 1', 'West 2')), ['2:Square 2-West 2']);
});

test('a trip on one line is one ride; no ride to the same station or its twin', () => {
  const rides = M.metroRides(net, 'North 1', 'South 2')!;
  assert.equal(rides.length, 1);
  assert.equal(rides[0].path.length, 4);
  assert.equal(M.metroRides(net, 'Square 1', 'Square 1'), null);
  assert.equal(M.metroRides(net, 'Square 1', 'Square 2'), null);
  assert.equal(M.metroRides(net, 'Square 1', 'Nowhere'), null);
});

test('adding a station twice changes nothing; non-metro lines are left out', () => {
  assert.equal(M.addLines(net, sq1, atSq1), net);
  const withBus = M.addLines(M.emptyNet(), sq1, [{ ...line('9', [s1]), mode: 'BUS' }]);
  assert.equal(withBus.runs.length, 0);
  assert.equal(M.metroLinesDrawn(net).length, 3);
});

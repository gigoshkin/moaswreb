/// <reference types="node" />
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import type { StopHit, StopLine } from '@transit/shared';

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
const F = await import('../src/lib/buildFlow.ts');

// SYNTHETIC stops in the shape of the Sarajishvili change: bus 150 gets off at the bus stop
// "M/S Sarajishvili", the metro station of the same name is ~50 m away.
const S = (id: string, lat: number, lon: number, mode = 'BUS'): StopHit => ({ id, name: id, lat, lon, mode });
const home = { lat: 41.79, lon: 44.75, label: 'Home' };
const office = { lat: 41.70, lon: 44.80, label: 'Office' };
const busA = S('Bus A', 41.791, 44.751);
const busMid = S('Bus mid', 41.78, 44.76);
const sarBus = S('M/S Sarajishvili', 41.7740, 44.7700);
const sarMetro = S('M/S Sarajishvili metro', 41.7744, 44.7703, 'SUBWAY');
const metroEnd = S('Metro end', 41.701, 44.801, 'SUBWAY');
const line = (shortName: string, mode: string, next: StopHit[]): StopLine => ({ shortName, color: null, minibus: false, mode, headsign: null, next });
const atBusA = [line('150', 'BUS', [busMid, sarBus]), line('151', 'BUS', [busMid])];
const atSarMetro = [line('1', 'SUBWAY', [metroEnd])];
const at = (s: StopHit) => ({ lat: s.lat, lon: s.lon, label: s.name });

const fresh = () => F.initFlow(null, null);

test('a pin on the ground first is the walk Start; the pin floats for the walk End', () => {
  const f = F.pinDropped(fresh(), home, null);
  assert.equal(F.phaseOf(fresh()), 'first');
  assert.deepEqual(f.start, home);
  assert.equal(F.phaseOf(f), 'walkEnd');
  assert.equal(f.board, null);
  const rows = F.rowsOf(f);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'walk');
  assert.equal(rows[0].kind === 'walk' && rows[0].to, null);
});

test('the next pin on a bus stop ends the walk there and boards a ride at it', () => {
  const f = F.pinDropped(F.pinDropped(fresh(), home, null), at(busA), busA);
  assert.equal(F.phaseOf(f), 'awaitingOff');
  assert.equal(f.board?.id, 'Bus A');
  const rows = F.rowsOf(f);
  assert.deepEqual(rows.map((r) => r.kind), ['walk', 'boarding']);
  assert.equal(rows[0].kind === 'walk' && rows[0].to?.stop?.id, 'Bus A');
  // Only a stop the lines reach ends the ride; a ground pin does nothing now.
  assert.equal(F.pinDropped(f, home, null), f);
  assert.equal(F.groundOk(f), false);
  assert.deepEqual(F.reachableFrom(busA, atBusA).map((s) => s.id), ['Bus mid', 'M/S Sarajishvili']);
});

test('ending a ride lets the pin float with no boarding stop (no black lines), never a ride started for you', () => {
  let f = F.pinDropped(F.pinDropped(fresh(), home, null), at(busA), busA);
  f = F.rideEnded(f, sarBus, atBusA);
  assert.equal(f.rides.length, 1);
  assert.equal(f.rides[0].off.id, 'M/S Sarajishvili');
  assert.deepEqual(f.rides[0].lines.map((l) => l.label), ['150']); // 151 doesn't go there
  assert.equal(f.board, null);
  assert.equal(F.phaseOf(f), 'floating');
  assert.equal(F.floating(f), true);
  assert.deepEqual(F.rowsOf(f).map((r) => r.kind), ['walk', 'ride']);
  // A stop no line reaches doesn't end the ride.
  const g = F.pinDropped(F.pinDropped(fresh(), home, null), at(busA), busA);
  assert.equal(F.rideEnded(g, metroEnd, atBusA), g);
});

test('a floating pin on the ground after a ride is a walk from the get-off stop to it', () => {
  let f = F.rideEnded(F.pinDropped(fresh(), at(busA), busA), sarBus, atBusA);
  f = F.pinDropped(f, office, null);
  assert.deepEqual(f.end, office);
  assert.equal(F.phaseOf(f), 'floating');
  const rows = F.rowsOf(f);
  assert.deepEqual(rows.map((r) => r.kind), ['ride', 'walk']);
  const w = rows[1];
  assert.ok(w.kind === 'walk' && w.from.stop?.id === 'M/S Sarajishvili' && w.to?.label === 'Office' && w.minutes! > 0);
  // Another ground pin moves that walk's End.
  const moved = F.pinDropped(f, home, null);
  assert.deepEqual(moved.end, home);
  assert.equal(F.rowsOf(moved).length, 2);
});

test('a floating pin on a metro station starts a metro ride there, with the walk from the bus stop', () => {
  let f = F.rideEnded(F.pinDropped(F.pinDropped(fresh(), home, null), at(busA), busA), sarBus, atBusA);
  f = F.pinDropped(f, at(sarMetro), sarMetro);
  assert.equal(f.board?.id, 'M/S Sarajishvili metro');
  const rows = F.rowsOf(f);
  assert.deepEqual(rows.map((r) => r.kind), ['walk', 'ride', 'walk', 'boarding']);
  const w = rows[2];
  assert.ok(w.kind === 'walk' && w.from.stop?.id === 'M/S Sarajishvili' && w.to?.stop?.id === 'M/S Sarajishvili metro');
  assert.ok(w.kind === 'walk' && w.metres! > 30 && w.metres! < 80);
  f = F.rideEnded(f, metroEnd, atSarMetro);
  assert.deepEqual(f.rides.map((r) => r.lines[0].kind), ['bus', 'metro']);
  assert.deepEqual(F.rowsOf(f).map((r) => r.kind), ['walk', 'ride', 'walk', 'ride']);
  // A walk that had ended on the ground ends at the stop instead when a ride boards there.
  const g = F.pinDropped(F.pinDropped(F.rideEnded(F.pinDropped(fresh(), at(busA), busA), sarBus, atBusA), office, null), at(sarMetro), sarMetro);
  assert.equal(g.end, null);
});

test('boarding again at the same stop is a change on the spot, not a walk', () => {
  let f = F.rideEnded(F.pinDropped(fresh(), at(busA), busA), sarBus, atBusA);
  f = F.pinDropped(f, at(sarBus), sarBus);
  assert.deepEqual(F.rowsOf(f).map((r) => r.kind), ['ride', 'boarding']);
});

test('a first pin on a stop boards straight away (no walk); the trip starts at that stop', () => {
  let f = F.pinDropped(fresh(), at(busA), busA);
  assert.equal(F.phaseOf(f), 'awaitingOff');
  assert.equal(F.canFinish(f), false);
  assert.equal(F.finish(f), null);
  f = F.rideEnded(f, sarBus, atBusA);
  const done = F.finish(f)!;
  assert.equal(done.from.label, 'Bus A');
  assert.equal(done.to.label, 'M/S Sarajishvili');
  assert.deepEqual(done.steps, [{ fromStops: ['Bus A'], toStops: ['M/S Sarajishvili'], lines: [{ label: '150', kind: 'bus' }] }]);
});

test('finish: the ends are the first walk Start and the last walk End; Done needs a ride', () => {
  let f = F.pinDropped(fresh(), home, null);
  assert.equal(F.canFinish(f), false);
  f = F.pinDropped(f, at(busA), busA);
  f = F.rideEnded(f, sarBus, atBusA);
  assert.equal(F.canFinish(f), true);
  f = F.pinDropped(f, office, null);
  const done = F.finish(f)!;
  assert.deepEqual(done.from, home);
  assert.deepEqual(done.to, office);
  // A ride boarded but not ended is left out.
  const half = F.pinDropped(F.rideEnded(F.pinDropped(fresh(), at(busA), busA), sarBus, atBusA), at(sarMetro), sarMetro);
  assert.equal(F.canFinish(half), true);
  assert.equal(F.finish(half)!.steps.length, 1);
  assert.equal(F.finish(half)!.to.label, 'M/S Sarajishvili');
});

test('ends given by the caller stay: ground pins do nothing, rides fit between them', () => {
  let f = F.initFlow(home, office);
  assert.equal(F.phaseOf(f), 'floating');
  assert.equal(F.groundOk(f), false);
  assert.equal(F.pinDropped(f, at(busMid), null), f);
  f = F.rideEnded(F.pinDropped(f, at(busA), busA), sarBus, atBusA);
  assert.deepEqual(F.finish(f)!.from, home);
  assert.deepEqual(F.finish(f)!.to, office);
  assert.deepEqual(F.rowsOf(f).map((r) => r.kind), ['walk', 'ride', 'walk']);
});

test('insert and replace take a boarding stop from the pin, the rest of the rides stay', () => {
  let f = F.rideEnded(F.pinDropped(fresh(), at(busA), busA), sarBus, atBusA);
  f = F.rideEnded(F.pinDropped(f, at(sarMetro), sarMetro), metroEnd, atSarMetro);
  // Replace the bus ride: only a stop is taken.
  let r = F.replaceAt(f, 0);
  assert.equal(F.phaseOf(r), 'insertBoard');
  assert.equal(F.groundOk(r), false);
  r = F.pinDropped(r, at(busA), busA);
  assert.equal(r.board?.id, 'Bus A');
  r = F.rideEnded(r, busMid, atBusA);
  assert.deepEqual(r.rides.map((x) => x.off.id), ['Bus mid', 'Metro end']);
  assert.deepEqual(r.rides[0].lines.map((l) => l.label), ['150', '151']);
  assert.equal(F.phaseOf(r), 'floating');
  // Remove and line toggles.
  assert.equal(F.removeRide(f, 0).rides.length, 1);
  const two = F.rideEnded(F.pinDropped(F.replaceAt(f, 0), at(busA), busA), busMid, atBusA);
  assert.deepEqual(F.toggleRideLine(two, 0, '151').rides[0].skipped, ['151']);
});

test('undo takes each change back, one at a time', () => {
  let b = F.builder(fresh());
  b = F.commit(b, F.pinDropped(b.flow, home, null));
  b = F.commit(b, F.pinDropped(b.flow, at(busA), busA));
  b = F.commit(b, F.rideEnded(b.flow, sarBus, atBusA));
  b = F.commit(b, F.rideEnded(b.flow, sarBus, atBusA)); // nothing changes: not kept
  assert.equal(b.past.length, 3);
  b = F.undo(b);
  assert.equal(F.phaseOf(b.flow), 'awaitingOff');
  b = F.undo(b);
  assert.equal(F.phaseOf(b.flow), 'walkEnd');
  b = F.undo(b);
  assert.equal(F.phaseOf(b.flow), 'first');
  assert.equal(F.undo(b), b);
});

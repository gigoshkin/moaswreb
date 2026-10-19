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

// SYNTHETIC round-trip minibus in the shape of 457 at Station Square: out along one side of
// the road, back along the other, past the stop across the road and into the boarding stop again.
const sq = S('Square', 41.722, 44.7967);
const out1 = S('Out 1', 41.7205, 44.7969); // ~170 m: the next stop, not "back"
const out2 = S('Out 2', 41.715, 44.8);
const far1 = S('Far', 41.71, 44.81);
const back2 = S('Back 2', 41.7151, 44.8001);
const across = S('Square across', 41.7206, 44.797); // across the road from Out 1, on the way back
const roundTrip = [sq, out1, out2, far1, back2, across, sq];

test('a bus pattern offers only the stops after the boarding stop, and not its way back', () => {
  assert.deepEqual(F.onwardOnPattern(out1, roundTrip).map((s) => s.id), ['Out 2', 'Far', 'Back 2']);
  assert.deepEqual(F.onwardOnPattern(sq, roundTrip).map((s) => s.id), ['Out 1', 'Out 2', 'Far', 'Back 2']);
  // Nothing before the boarding stop; a stop not on the pattern gets nothing.
  assert.deepEqual(F.onwardOnPattern(far1, roundTrip).map((s) => s.id), ['Back 2', 'Square across', 'Square']);
  assert.deepEqual(F.onwardOnPattern(S('Elsewhere', 41.8, 44.8), roundTrip), []);
  // A plain one-way pattern is left as it is.
  assert.deepEqual(F.onwardStops(busA, [busMid, sarBus]).map((s) => s.id), ['Bus mid', 'M/S Sarajishvili']);
});

test('the lines from a stop and the stops to get off at leave out the way back; metro keeps both directions', () => {
  const lines = [line('457', 'BUS', roundTrip.slice(2)), line('1', 'SUBWAY', [metroEnd])];
  const onward = F.onwardLines(out1, lines);
  assert.deepEqual(onward[0].next.map((s) => s.id), ['Out 2', 'Far', 'Back 2']);
  assert.deepEqual(onward[1].next.map((s) => s.id), ['Metro end']);
  const reach = F.reachableFrom(out1, lines).map((s) => s.id);
  assert.ok(!reach.includes('Square across') && !reach.includes('Square'));
  assert.equal(F.rideBetween(out1, across, lines), null);
  assert.equal(F.rideBetween(out1, back2, lines)?.lines[0].label, '457');
});

test('a ride drawn along a known road shape is cut at the get-off stop', () => {
  const road = [busA, { lat: 41.785, lon: 44.755 }, busMid, { lat: 41.776, lon: 44.768 }, sarBus];
  const r = F.rideBetween(busA, busMid, atBusA, new Map([['150', road]]));
  assert.equal(r?.path.length, 4);
  assert.deepEqual(r?.path.at(-1), busMid);
  assert.deepEqual(F.shapeTo([], busMid), [busMid]);
});

test('the stop of the same name across the road can be boarded instead', () => {
  const near = { ...S('Tevdore', 41.720637, 44.796943), id: '4335' };
  const other = { ...S('Tevdore', 41.720555, 44.796992), id: '4336' };
  const stops = [near, { ...other, id: 'far', lat: 41.73 }, other, S('Other', 41.72056, 44.79699)];
  assert.equal(F.twinAcross(near, stops)?.id, '4336');
  assert.equal(F.twinAcross(sarMetro, [sarMetro, { ...sarMetro, id: 'x' }]), null);
  const f = F.pinDropped(fresh(), at(near), near);
  assert.equal(F.reboard(f, other).board, other);
  assert.equal(F.reboard(fresh(), other).board, null);
});

test('an unnamed Start or End gets its name when the lookup answers, through the undo history too', () => {
  const unnamed = (l: string) => l === 'Dropped pin';
  const pin = { lat: 41.79, lon: 44.75, label: 'Dropped pin' };
  let b = F.builder(fresh());
  b = F.commit(b, F.pinDropped(b.flow, pin, null));
  b = F.commit(b, F.pinDropped(b.flow, at(busA), busA));
  const n = F.namedAll(b, { ...pin, label: 'Tsereteli Ave 5' }, unnamed);
  assert.equal(n.flow.start?.label, 'Tsereteli Ave 5');
  assert.equal(F.undo(n).flow.start?.label, 'Tsereteli Ave 5');
  // Another point, a named end or a lookup that found nothing: nothing changes.
  assert.equal(F.namedAll(b, { ...pin, lat: 41.7, label: 'Elsewhere' }, unnamed), b);
  assert.equal(F.namedAll(b, pin, unnamed), b);
  assert.equal(F.named(n.flow, { ...pin, label: 'Other' }, unnamed), n.flow);
});

test('several rides end the ride being built in a row, in its slot', () => {
  const a = S('A', 41.7, 44.8, 'SUBWAY');
  const b = S('B', 41.71, 44.8, 'SUBWAY');
  const c = S('C', 41.72, 44.8, 'SUBWAY');
  const ride = (x: StopHit, y: StopHit) => ({ board: x, off: y, lines: [{ label: 'x', kind: 'metro' as const }], skipped: [], path: [x, y] });
  let f = F.pinDropped(fresh(), at(a), a);
  f = F.ridesEnded(f, [ride(a, b), ride(b, c)]);
  assert.deepEqual(f.rides.map((r) => `${r.board.id}-${r.off.id}`), ['A-B', 'B-C']);
  assert.equal(F.phaseOf(f), 'floating');
  // Changing between two rides at the same station is a change on the spot.
  const rows = F.rowsOf(f);
  assert.deepEqual(rows.map((r) => r.kind), ['ride', 'walk', 'ride']);
  assert.equal(rows[1].kind === 'walk' && rows[1].metres, 0);
  // Replace the first ride with two: the second ride stays after them.
  let g = F.pinDropped(F.replaceAt(f, 0), at(a), a);
  g = F.ridesEnded(g, [ride(a, c), ride(c, b)]);
  assert.deepEqual(g.rides.map((r) => `${r.board.id}-${r.off.id}`), ['A-C', 'C-B', 'B-C']);
  assert.equal(F.ridesEnded(f, []), f);
});

test('the pin on a stop: the nearest within reach, and the one it is on keeps it (no back and forth between two stops)', () => {
  // The bus stop and its metro station ~50 m apart, zoomed out so both are within reach (60 m).
  const stops = [sarBus, sarMetro];
  const mid = { lat: (sarBus.lat + sarMetro.lat) / 2, lon: (sarBus.lon + sarMetro.lon) / 2 };
  const nearBus = { lat: mid.lat - 0.00003, lon: mid.lon - 0.00002 };
  const nearMetro = { lat: mid.lat + 0.00003, lon: mid.lon + 0.00002 };
  assert.equal(F.pinStop(nearBus, stops, 60, null)?.s.id, 'M/S Sarajishvili');
  assert.equal(F.pinStop(nearMetro, stops, 60, null)?.s.id, 'M/S Sarajishvili metro');
  // Moving a few metres past the middle doesn't hand the pin over...
  assert.equal(F.pinStop(nearMetro, stops, 60, 'M/S Sarajishvili')?.s.id, 'M/S Sarajishvili');
  assert.equal(F.pinStop(nearBus, stops, 60, 'M/S Sarajishvili metro')?.s.id, 'M/S Sarajishvili metro');
  // ...right onto the other stop does.
  assert.equal(F.pinStop(sarMetro, stops, 60, 'M/S Sarajishvili')?.s.id, 'M/S Sarajishvili metro');
  // Out of reach (x PIN_KEEP for the one it is on): the ground.
  const far = { lat: sarBus.lat - 0.002, lon: sarBus.lon };
  assert.equal(F.pinStop(far, stops, 60, 'M/S Sarajishvili'), null);
  // The boarding stop is never a stop to get off at.
  assert.equal(F.pinStop(sarBus, stops, 60, null, 'M/S Sarajishvili')?.s.id, 'M/S Sarajishvili metro');
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PatternRef, Timetable } from '../src/journey/source.ts';
import { composeRoute } from '../src/journey/compose.ts';
import { alternatives, raptor } from '../src/journey/raptor.ts';

// SYNTHETIC network. Home at A; work at D, far away. Bus 1 A→B, metro M B'→D (B' 100 m from B), slow bus 9 A→D direct.
const stop = (id: string, lat: number, lon: number) => ({ id, name: id, lat, lon });
const A = stop('1:A', 41.79, 44.74);
const B = stop('1:B', 41.78, 44.8);
const B2 = stop('1:B2', 41.7809, 44.8);
const X = stop('1:X', 41.75, 44.78);
const D = stop('1:D', 41.72, 44.72);
const home = { lat: 41.7905, lon: 44.74 };
const work = { lat: 41.7205, lon: 44.72 };
const DATE = '2026-10-19';
const deadline = Date.parse(`${DATE}T09:00:00+04:00`);

const pat = (shortName: string, mode: string, stops: (typeof A)[]): PatternRef => ({
  routeId: `1:${shortName}`, shortName, longName: null, color: null, minibus: false, mode, suffix: '0:01', headsign: null, stops,
});
const bus1 = pat('1', 'BUS', [A, X, B]);
const metro = pat('M', 'SUBWAY', [B2, D]);
const bus9 = pat('9', 'BUS', [A, X, D]);

/** Trips as minutes after midnight per stop. */
const tables = new Map<PatternRef, Timetable>([
  // 07:30 → 07:50 at B, every 10 min.
  [bus1, { times: [[450, 460, 470, 480], [460, 470, 480, 490], [470, 480, 490, 500]] }],
  // Metro 08:00 → 08:20, 08:10 → 08:30 ... 08:40 → 09:00.
  [metro, { times: [[480, 490, 500, 510, 520], [500, 510, 520, 530, 540]] }],
  // Slow bus: 07:00 → 08:55 at D.
  [bus9, { times: [[420, 430], [470, 480], [535, 545]] }],
]);
const net = { patterns: [bus1, metro, bus9], timetable: async (p: PatternRef, d: string) => (d === DATE ? tables.get(p) ?? null : null) };

test('raptor: the direct line and the faster bus + metro way, each leaving as late as it can', async () => {
  const js = await raptor(net, { from: home, to: work, deadline });
  const shape = js.map((j) => j.rides.map((r) => `${r.p.shortName}:${r.p.stops[r.b].id}>${r.p.stops[r.a].id}`).join(' then '));
  assert.deepEqual(shape, ['9:1:A>1:D', '1:1:A>1:B then M:1:B2>1:D']);
  // Bus 1 at 08:00 reaches B at 08:20, metro 08:40 arrives 09:00: later than the 07:50 slow bus.
  assert.ok(js[1].leave > js[0].leave);
});

test('raptor: avoided lines and modes are never used', async () => {
  const noMetro = await raptor(net, { from: home, to: work, deadline, modes: ['BUS'] });
  assert.ok(noMetro.every((j) => j.rides.every((r) => r.p.mode === 'BUS')));
  const no9 = await raptor(net, { from: home, to: work, deadline, avoid: { routes: ['9'] } });
  assert.ok(no9.every((j) => j.rides.every((r) => r.p.shortName !== '9')));
  assert.equal(no9.length, 1);
});

test('raptor: nothing arrives in time, nothing found', async () => {
  const early = Date.parse(`${DATE}T07:10:00+04:00`);
  assert.deepEqual(await raptor(net, { from: home, to: work, deadline: early }), []);
});

test('alternatives: the same answer every time (no jumping), distinct ways', async () => {
  const a = await alternatives(net, { from: home, to: work, deadline });
  const b = await alternatives(net, { from: home, to: work, deadline });
  const key = (js: typeof a) => js.map((j) => j.rides.map((r) => r.p.shortName).join('>'));
  assert.deepEqual(key(a), key(b));
  assert.equal(new Set(key(a)).size, key(a).length);
});

test('composeRoute: the described route even when a direct line exists; metro needs no line name', async () => {
  const siblings = async (id: string) => [id];
  const c = await composeRoute({ ...net, ready: true }, { from: home, to: work, deadline, rides: [{ lines: ['1'] }, { mode: 'SUBWAY' }] }, siblings);
  assert.ok(c);
  assert.deepEqual(c.steps, [{ fromStops: ['1:A'], toStops: ['1:B'], routes: ['1'] }, { fromStops: ['1:B2'], toStops: ['1:D'] }]);
  // Getting off where the line doesn't stop: nothing.
  assert.equal(await composeRoute({ ...net, ready: true }, { from: home, to: work, deadline, rides: [{ lines: ['1'], getOffAt: ['1:D'] }, { mode: 'SUBWAY' }] }, siblings), null);
  assert.equal(await composeRoute({ ...net, ready: false }, { from: home, to: work, deadline, rides: [{ lines: ['1'] }] }, siblings), null);
});

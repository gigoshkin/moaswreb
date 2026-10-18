import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LatLon, NearStop, StopHit } from '@transit/shared';
import { Engine } from '../src/journey/engine.ts';
import { encodePolyline } from '../src/journey/polyline.ts';
import type { PatternRef, Source, StopRef, Timetable } from '../src/journey/source.ts';
import { blockFor, TtcSource } from '../src/journey/ttc-source.ts';
import type { TtcClient } from '../src/ttc/client.ts';
import type { StopIndex } from '../src/ttc/stops.ts';
import type { ScheduleBlock } from '../src/ttc/types.ts';

// A made-up network (SYNTHETIC): home — A — B (metro side) — work, lines 321, 335 and
// the minibus 518 between A and B, plus 10 (A→X) and 20 (X→B) for a transfer.

const at = (lat: number, lon: number): LatLon => ({ lat, lon });
const stop = (id: string, lat: number, lon: number): StopRef => ({ id, name: id, lat, lon });
const A = stop('1:A', 41.7, 44.7);
const B = stop('1:B', 41.71, 44.75);
const X = stop('1:X', 41.705, 44.72);
const HOME = at(41.699, 44.699);
const WORK = at(41.711, 44.751);

// Tbilisi 2026-10-19 (Monday) minutes after midnight.
const hm = (h: number, m: number) => h * 60 + m;
const line = (shortName: string, stops: StopRef[], opts: { minibus?: boolean; trips: number[][] }): PatternRef & { trips: number[][] } => ({
  routeId: opts.minibus ? `1:minibusR${shortName}` : `1:R${shortName}`,
  shortName,
  longName: null,
  color: '#112233',
  minibus: Boolean(opts.minibus),
  mode: 'BUS',
  suffix: '0:01',
  headsign: null,
  stops,
  trips: opts.trips,
});

// trips[k] = the time at each stop of the pattern for trip k.
const l321 = line('321', [A, B], { trips: [[hm(8, 0), hm(8, 20)], [hm(8, 20), hm(8, 40)], [hm(8, 40), hm(9, 0)]] });
const l335 = line('335', [A, B], { trips: [[hm(8, 5), hm(8, 20)], [hm(8, 25), hm(8, 40)], [hm(8, 45), hm(9, 0)]] });
const l518 = line('518', [A, B], { minibus: true, trips: [[hm(8, 10), hm(8, 35)], [hm(8, 30), hm(8, 55)]] });
const l10 = line('10', [A, X], { trips: [[hm(8, 0), hm(8, 10)], [hm(8, 15), hm(8, 25)], [hm(8, 30), hm(8, 40)]] });
const l20 = line('20', [X, B], { trips: [[hm(8, 11), hm(8, 20)], [hm(8, 26), hm(8, 35)], [hm(8, 41), hm(8, 50)]] });
const lines = [l321, l335, l518, l10, l20];

const network = (live: Record<string, number[]> = {}): Source => ({
  stopsNear: async () => [] as NearStop[],
  stop: async () => null as StopHit | null,
  patternsAt: async (id) => lines.filter((l) => l.stops.some((s) => s.id === id)),
  timetable: async (p, date): Promise<Timetable | null> => {
    if (date !== '2026-10-19') return null;
    const l = lines.find((x) => x.routeId === p.routeId)!;
    return { times: l.stops.map((_, i) => l.trips.map((t) => t[i])) };
  },
  live: async (id, p) => live[`${id}|${p.shortName}`] ?? [],
  walk: async (a, b) => {
    const mins = a === HOME ? 5 : b === WORK ? 2 : 1;
    return { sec: mins * 60, m: mins * 80 };
  },
});

const deadline = Date.parse('2026-10-19T09:00:00+04:00');
const now = Date.parse('2026-10-19T06:00:00+04:00');
const ride = { fromStops: ['1:A'], toStops: ['1:B'] };
const lineOf = (it: { legs: Array<{ route: { shortName: string } | null }> }) => it.legs.filter((l) => l.route).map((l) => l.route!.shortName).join('>');
const clock = (iso: string) => new Date(Date.parse(iso) + 4 * 3600e3).toISOString().slice(11, 16);

test('every line is compared against the same deadline; the latest start wins', async () => {
  const out = await new Engine(network()).solve({ from: HOME, to: WORK, steps: [ride], deadline, now });
  assert.deepEqual(out.map(lineOf).sort(), ['321', '335', '518']);
  const by = Object.fromEntries(out.map((it) => [lineOf(it), it]));
  // 321: last bus 8:40→9:00 would arrive 9:02 with the walk: too late, so 8:20→8:40, leave 8:15.
  assert.equal(clock(by['321'].departAt), '08:15');
  assert.equal(clock(by['335'].departAt), '08:20'); // 8:25 → 8:40 + 2 walk, boards 8:25, leave 8:20
  assert.equal(clock(by['518'].departAt), '08:25'); // 8:30 → 8:55 +2 = 8:57
  for (const it of out) assert.ok(Date.parse(it.arriveAt) <= deadline);
  // Ride time is the timetable difference, to the second.
  const leg = by['321'].legs.find((l) => l.route)!;
  assert.equal(leg.durationSec, 20 * 60);
  assert.equal(leg.from.stopId, '1:A');
  assert.equal(leg.to.stopId, '1:B');
});

test('a trip never considers a line it avoids; minibus can be skipped as a kind', async () => {
  const base = { from: HOME, to: WORK, steps: [ride], deadline, now };
  const no518 = await new Engine(network()).solve({ ...base, avoid: { routes: ['518'] } });
  assert.deepEqual(no518.map(lineOf).sort(), ['321', '335']);
  const noMini = await new Engine(network()).solve({ ...base, avoid: { minibus: true } });
  assert.deepEqual(noMini.map(lineOf).sort(), ['321', '335']);
  const only = await new Engine(network()).solve({ ...base, steps: [{ ...ride, routes: ['335'] }] });
  assert.deepEqual(only.map(lineOf), ['335']);
});

test('live vehicles replace the timetable while TTC reports them', async () => {
  const soon = Date.parse('2026-10-19T08:05:00+04:00');
  const out = await new Engine(network({ '1:A|321': [10, 40] })).solve({ from: HOME, to: WORK, steps: [ride], deadline, now: soon - 10 * 60_000 });
  const by = Object.fromEntries(out.map((it) => [lineOf(it), it]));
  const leg = by['321'].legs.find((l) => l.route)!;
  assert.equal(leg.realtime, true);
  assert.equal(clock(leg.departAt), '08:35'); // now + 40 min, not a timetable slot (8:40 would arrive too late)
  assert.equal(leg.durationSec, 20 * 60); // ride time still comes from the timetable
});

test('catching a connection: the second bus leaves after the first arrives, a walk and a margin', async () => {
  const steps = [
    { fromStops: ['1:A'], toStops: ['1:X'] },
    { fromStops: ['1:X'], toStops: ['1:B'] },
  ];
  const out = await new Engine(network()).solve({ from: HOME, to: WORK, steps, deadline, now });
  const it = out.find((i) => lineOf(i) === '10>20')!;
  assert.ok(it, 'a two-bus option');
  const [first, second] = it.legs.filter((l) => l.route);
  // Latest 20 that arrives in time is 8:41→8:50 (+2 walk = 8:52). Bus 10 must arrive by 8:41 − 1 walk − 2 margin = 8:38 → 8:15→8:25.
  assert.equal(clock(second.departAt), '08:41');
  assert.equal(clock(first.arriveAt), '08:25');
  assert.ok(Date.parse(second.departAt) - Date.parse(first.arriveAt) >= 3 * 60_000);
  assert.equal(it.transfers, 1);
});

test('an on-time bus you can no longer reach (walk + margin) does not hide the next one of that line', async () => {
  // 15 min walk to A, so leave 15 + 3 margin = 18 min before the bus. At 08:04 the 8:20 bus of 321 is out of reach.
  const far: Source = { ...network(), walk: async (a, b) => (a === HOME ? { sec: 15 * 60, m: 1200 } : b === WORK ? { sec: 120, m: 160 } : { sec: 60, m: 80 }) };
  const out = await new Engine(far).solve({ from: HOME, to: WORK, steps: [ride], deadline, now: Date.parse('2026-10-19T08:04:00+04:00') });
  const rides321 = out.filter((it) => lineOf(it) === '321').map((it) => clock(it.legs.find((l) => l.route)!.departAt));
  // The on-time 8:20 is still listed (the app marks it gone), and the leave-now option is the 8:40, not the 8:20 again.
  assert.deepEqual(rides321.sort(), ['08:20', '08:40']);
});

test('live arrivals: two patterns of one route at a stop each get their own vehicles', async () => {
  let calls = 0;
  const ttc = {
    routeArrivals: async () => {
      calls++;
      return [
        { patternSuffix: '0:01', realtime: true, realtimeArrivalMinutes: 7 },
        { patternSuffix: '1:01', realtime: true, realtimeArrivalMinutes: 3 },
        { patternSuffix: '0:01', realtime: false, realtimeArrivalMinutes: 1 },
      ];
    },
  } as unknown as TtcClient;
  const src = new TtcSource(ttc, {} as StopIndex);
  const there = { ...l321, suffix: '0:01' };
  const back = { ...l321, suffix: '1:01' };
  assert.deepEqual(await src.live('1:A', there), [7]);
  assert.deepEqual(await src.live('1:A', back), [3]);
  assert.equal(calls, 1, 'one TTC call per stop and route');
});

test('nothing fits: no itineraries instead of a wrong one', async () => {
  const out = await new Engine(network()).solve({ from: HOME, to: WORK, steps: [{ fromStops: ['1:B'], toStops: ['1:A'] }], deadline, now });
  assert.deepEqual(out, []);
});

test('timetable block: exact service date first, else the weekday range', () => {
  const blocks = [
    { fromDay: 'MONDAY', toDay: 'FRIDAY', serviceDates: ['2026-10-19', '2026-10-20'], stops: [] },
    { fromDay: 'SATURDAY', toDay: 'SUNDAY', serviceDates: ['2026-10-17', '2026-10-18'], stops: [] },
    { fromDay: 'MONDAY', toDay: 'MONDAY', serviceDates: ['2026-10-26'], stops: [] },
  ] satisfies ScheduleBlock[];
  assert.equal(blockFor(blocks, '2026-10-18')?.fromDay, 'SATURDAY');
  assert.equal(blockFor(blocks, '2026-10-26')?.toDay, 'MONDAY'); // listed exactly, even though the first block also covers Mondays
  assert.equal(blockFor(blocks, '2026-11-04')?.toDay, 'FRIDAY'); // not listed yet: Wednesday → weekday range
});

test('encodePolyline round-trips with the app decoder format', () => {
  // Google's documented example.
  assert.equal(encodePolyline([at(38.5, -120.2), at(40.7, -120.95), at(43.252, -126.453)]), '_p~iF~ps|U_ulLnnqC_mqNvxq`@');
});

// A picked way kept as the trip's rides (SYNTHETIC): bus to the metro, then the metro. The first ride can be
// done by 321 from A or the minibus 518 from A2 next to it; 315 goes the same way but is not ticked, and
// 550 goes straight to work (another way altogether).
const A2 = stop('1:A2', 41.7003, 44.7004);
const M = stop('1:metro_1_x', 41.705, 44.72);
const W = stop('1:metro_1_w', 41.71, 44.75);
const pinnedLines = [
  line('321', [A, M], { trips: [[hm(8, 0), hm(8, 15)], [hm(8, 10), hm(8, 25)]] }),
  line('518', [A2, M], { minibus: true, trips: [[hm(8, 5), hm(8, 18)], [hm(8, 15), hm(8, 28)]] }),
  line('315', [A, M], { trips: [[hm(8, 20), hm(8, 30)]] }),
  line('550', [A, W], { trips: [[hm(8, 30), hm(8, 50)]] }),
  { ...line('1', [M, W], { trips: [[hm(8, 20), hm(8, 30)], [hm(8, 30), hm(8, 40)], [hm(8, 40), hm(8, 50)]] }), routeId: '1:metro1', mode: 'SUBWAY' },
];
const pinnedNet = (all = pinnedLines): Source => ({
  ...network(),
  patternsAt: async (id) => all.filter((l) => l.stops.some((s) => s.id === id)),
  timetable: async (p, date) => {
    if (date !== '2026-10-19') return null;
    const l = all.find((x) => x.routeId === p.routeId)!;
    return { times: l.stops.map((_, i) => l.trips.map((t) => t[i])) };
  },
});
const pinned = [
  { fromStops: ['1:A', '1:A2'], toStops: ['1:metro_1_x'], routes: ['321', '518'] },
  { fromStops: ['1:metro_1_x'], toStops: ['1:metro_1_w'], routes: ['1'] },
];

test('a pinned route uses only the ticked lines of each ride, from any of its stops, and keeps its rides', async () => {
  const out = await new Engine(pinnedNet()).solve({ from: HOME, to: WORK, steps: pinned, deadline, now });
  assert.deepEqual(out.map(lineOf).sort(), ['321>1', '518>1'], 'no 315 (not ticked), no 550 (another way)');
  const via518 = out.find((it) => lineOf(it) === '518>1')!;
  assert.equal(via518.legs.find((l) => l.route)!.from.stopId, '1:A2', 'the minibus is boarded at its own stop');
  for (const it of out) assert.equal(it.legs.find((l) => l.route?.shortName === '1')!.mode, 'SUBWAY');
});

test('a pinned route whose ticked lines have no ride gives nothing rather than another line', async () => {
  const left = pinnedLines.filter((l) => l.shortName !== '321' && l.shortName !== '518');
  const out = await new Engine(pinnedNet(left)).solve({ from: HOME, to: WORK, steps: pinned, deadline, now });
  assert.deepEqual(out, []);
});

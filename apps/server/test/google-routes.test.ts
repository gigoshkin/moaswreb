import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import type { Itinerary, LatLon, NearStop } from '@transit/shared';
import type { PatternRef, Source, StopRef } from '../src/journey/source.ts';
import type { TtcSource } from '../src/journey/ttc-source.ts';
import { candidateChain, createGoogleRoutes, parseGoogleRoutes, resolveCandidate, type GoogleCandidate, type GoogleRoutes } from '../src/plan/google-routes.ts';
import { PlanService, lineChain } from '../src/plan/service.ts';
import type { TtcClient } from '../src/ttc/client.ts';
import { distanceM, StopIndex } from '../src/ttc/stops.ts';

// Real Google Routes answers (captured 18 Oct 2026, key and headers not stored), Didi Dighomi
// (41.7910541,44.7380951) on Mon 19 Oct 2026: to Caucasus University arriving 15:00, and to
// Zurab Anjaparidze St arriving 09:00.
const fixture = async (name: string) => JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const cu = await fixture('google-routes-didi-dighomi-caucasus-univ.json');
const za = await fixture('google-routes-didi-dighomi-anjaparidze.json');

test('parses Google transit routes into ride chains, one per distinct chain', () => {
  // Google repeats 539 > 490 six times.
  const a = parseGoogleRoutes(cu);
  assert.deepEqual(a.map(candidateChain), ['BUS:539>BUS:490']);
  assert.equal(a[0].rides[0].line, '539');
  assert.ok(Math.abs(a[0].rides[1].alight.lat - 41.7) < 0.02);
  assert.deepEqual(parseGoogleRoutes(za).map(candidateChain), ['BUS:302', 'BUS:539>SUBWAY:2', 'BUS:539>BUS:476', 'BUS:302>BUS:298', 'BUS:302>SUBWAY:2']);
  // Junk and rides we can't map are dropped, not thrown on.
  assert.deepEqual(parseGoogleRoutes(null), []);
  assert.deepEqual(parseGoogleRoutes({ routes: [{ legs: [{ steps: [{ travelMode: 'WALK' }] }] }] }), []);
  const ferry = structuredClone(za);
  ferry.routes[1].legs[0].steps.find((s: { transitDetails?: unknown }) => s.transitDetails).transitDetails.transitLine.vehicle.type = 'FERRY';
  assert.ok(!parseGoogleRoutes(ferry).map(candidateChain).includes('BUS:539>SUBWAY:2'));
});

// SYNTHETIC network: A near home, X a change point, C near work; 10 runs A→X, 20 runs X→C, metro 1 X→C.
const stop = (id: string, lat: number, lon: number): StopRef => ({ id, name: id, lat, lon });
const A = stop('1:A', 41.7, 44.7);
const X = stop('1:X', 41.705, 44.72);
const C = stop('1:C', 41.71, 44.75);
const HOME: LatLon = { lat: 41.6995, lon: 44.6995 };
const WORK: LatLon = { lat: 41.7105, lon: 44.7505 };
const pattern = (shortName: string, mode: string, stops: StopRef[], trips: number[][]): PatternRef & { trips: number[][] } => ({
  routeId: `1:R${mode}${shortName}`, shortName, longName: null, color: null, minibus: false, mode, suffix: '0:01', headsign: null, stops, trips,
});
const hm = (h: number, m: number) => h * 60 + m;
const every = (from: number, to: number, ride: number[]) => Array.from({ length: (to - from) / 10 + 1 }, (_, k) => ride.map((r) => from + k * 10 + r));
const lines = [
  pattern('10', 'BUS', [A, X], every(hm(6, 0), hm(22, 0), [0, 10])),
  pattern('20', 'BUS', [X, C], every(hm(6, 5), hm(22, 5), [0, 15])),
  pattern('1', 'SUBWAY', [X, C], every(hm(6, 0), hm(22, 0), [0, 6])),
];
const all = [A, X, C];
const network = (): Source & { minibusNames(): Promise<Set<string>> } => ({
  stopsNear: async (p, r, limit) =>
    all.map((s) => ({ ...s, code: null, mode: 'BUS', distanceM: Math.round(distanceM(p, s)) }) as unknown as NearStop).filter((s) => s.distanceM <= r).sort((a, b) => a.distanceM - b.distanceM).slice(0, limit),
  stop: async () => null,
  patternsAt: async (id) => lines.filter((l) => l.stops.some((s) => s.id === id)),
  timetable: async (p) => {
    const l = lines.find((x) => x.routeId === p.routeId)!;
    return { times: l.stops.map((_, i) => l.trips.map((t) => t[i])) };
  },
  live: async () => [],
  walk: async (a, b) => ({ sec: Math.round(distanceM(a, b) / 1.2), m: Math.round(distanceM(a, b)) }),
  minibusNames: async () => new Set<string>(),
});
const ride = (line: string, mode: string, b: LatLon, a: LatLon) => ({ line, mode, board: { lat: b.lat + 0.0003, lon: b.lon }, alight: { lat: a.lat, lon: a.lon + 0.0003 } });

test('resolves Google rides to TTC stops the same line serves, or gives up', async () => {
  const src = network();
  const ok: GoogleCandidate = { rides: [ride('10', 'BUS', A, X), ride('1', 'SUBWAY', X, C)] };
  assert.deepEqual(await resolveCandidate(ok, src), [
    { fromStops: ['1:A'], toStops: ['1:X'], routes: ['10'] },
    { fromStops: ['1:X'], toStops: ['1:C'], routes: ['1'] },
  ]);
  // Line 99 doesn't stop there; metro 1 is not bus 1; Google's stop 500 m off matches nothing.
  assert.equal(await resolveCandidate({ rides: [ride('10', 'BUS', A, X), ride('99', 'BUS', X, C)] }, src), null);
  assert.equal(await resolveCandidate({ rides: [ride('1', 'BUS', X, C)] }, src), null);
  assert.equal(await resolveCandidate({ rides: [ride('10', 'BUS', { lat: A.lat + 0.005, lon: A.lon }, X)] }, src), null);
});

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test('Google calls: cached per trip and 5-minute slot, capped per day, failures give null and are not cached', async () => {
  const urls: Array<{ body: string; headers: Record<string, string> }> = [];
  let mode: 'ok' | 'fail' | 'http' = 'ok';
  const doFetch = (async (_u: string, init: RequestInit) => {
    urls.push({ body: String(init.body), headers: init.headers as Record<string, string> });
    if (mode === 'fail') throw new Error('network down');
    return mode === 'http' ? reply({}, 500) : reply(cu);
  }) as unknown as typeof fetch;
  const logs: string[] = [];
  let clock = Date.parse('2026-10-18T10:00:00Z');
  const g = createGoogleRoutes({ key: 'SECRET-KEY', dailyCap: 3, fetch: doFetch, now: () => clock, log: (m) => logs.push(m) });
  const at = Date.parse('2026-10-19T11:00:00Z');
  const from = { lat: 41.7910541, lon: 44.7380951 };
  const to = { lat: 41.706939, lon: 44.8110678 };

  assert.deepEqual((await g(from, to, at))?.map(candidateChain), ['BUS:539>BUS:490']);
  const sent = JSON.parse(urls[0].body);
  assert.equal(sent.travelMode, 'TRANSIT');
  assert.equal(sent.arrivalTime, '2026-10-19T11:00:00.000Z');
  assert.equal(sent.computeAlternativeRoutes, true);
  assert.equal(urls[0].headers['X-Goog-Api-Key'], 'SECRET-KEY');
  // Same trip, arrive-by 1 min later (same 5-min slot): from cache.
  await g(from, to, at + 60_000);
  assert.equal(urls.length, 1);
  // After 5 minutes it is asked again.
  clock += 5 * 60_000 + 1;
  await g(from, to, at);
  assert.equal(urls.length, 2);

  // A failure is null and not kept.
  mode = 'fail';
  assert.equal(await g(from, to, at + 30 * 60_000), null);
  assert.equal(urls.length, 3);
  // Cap of 3 reached: no more calls today, said once in the log, never with the key.
  mode = 'ok';
  assert.equal(await g(from, to, at + 30 * 60_000), null);
  assert.equal(await g(from, to, at + 60 * 60_000), null);
  assert.equal(urls.length, 3);
  assert.equal(logs.filter((l) => l.includes('daily cap')).length, 1);
  // Next Tbilisi day the cap resets.
  clock += 24 * 3_600_000;
  assert.ok(await g(from, to, at + 30 * 60_000));
  assert.ok(logs.every((l) => !l.includes('SECRET-KEY')));
});

test('an HTTP error or a hanging Google gives null within the timeout', async () => {
  const http = createGoogleRoutes({ key: 'k', dailyCap: 10, fetch: (async () => reply({ error: {} }, 403)) as unknown as typeof fetch, log: () => {} });
  assert.equal(await http({ lat: 41.7, lon: 44.7 }, { lat: 41.71, lon: 44.75 }, Date.now()), null);
  const hang = ((_u: string, init: RequestInit) =>
    new Promise((_, reject) => {
      // A real socket keeps the process alive; AbortSignal.timeout alone does not.
      const alive = setTimeout(() => reject(new Error('never aborted')), 5_000);
      init.signal!.addEventListener('abort', () => (clearTimeout(alive), reject(new Error('aborted'))));
    })) as unknown as typeof fetch;
  const slow = createGoogleRoutes({ key: 'k', dailyCap: 10, fetch: hang, timeoutMs: 50 });
  const t0 = Date.now();
  assert.equal(await slow({ lat: 41.7, lon: 44.7 }, { lat: 41.71, lon: 44.75 }, Date.now()), null);
  assert.ok(Date.now() - t0 < 2_000);
});

// The planner with Google: a deadline two days ahead (timetables are the same every day).
const local = (ms: number) => new Date(ms + 4 * 3_600_000).toISOString().slice(0, 16);
const arriveBy = `${local(Date.now() + 2 * 86_400_000).slice(0, 10)}T09:00`;
const planWith = (google: GoogleRoutes | null) => {
  const ttc = { plan: async () => ({ itineraries: [] }) } as unknown as TtcClient;
  return new PlanService(ttc, new StopIndex(ttc), network() as unknown as TtcSource, google).plan({ from: HOME, to: WORK, arriveBy });
};
const chains = (its: Itinerary[]) => its.map(lineChain);

test('Google chains are timed by our planner and merged; Google failing changes nothing', async () => {
  const candidates: GoogleCandidate[] = [
    { rides: [ride('10', 'BUS', A, X), ride('1', 'SUBWAY', X, C)] },
    { rides: [ride('10', 'BUS', A, X), ride('20', 'BUS', X, C)] },
    { rides: [ride('77', 'BUS', A, C)] },
  ];
  const withG = await planWith(async () => candidates);
  assert.deepEqual(chains(withG.itineraries).sort(), ['BUS:10>BUS:20', 'BUS:10>SUBWAY:1']);
  const deadline = Date.parse(`${arriveBy}:00+04:00`);
  for (const it of withG.itineraries) {
    assert.ok(Date.parse(it.arriveAt) <= deadline);
    assert.ok(it.legs.filter((l) => l.mode !== 'WALK').every((l) => l.from.stopId && l.to.stopId));
  }
  // Metro: 8:40 → 8:46 at X, then the walk; leave in time for the 8:20 or 8:30 line 10.
  const metro = withG.itineraries.find((it) => lineChain(it) === 'BUS:10>SUBWAY:1')!;
  assert.ok(Date.parse(metro.arriveAt) > deadline - 20 * 60_000);

  const without = await planWith(null);
  const failing = await planWith(async () => { throw new Error('boom'); });
  const nothing = await planWith(async () => null);
  assert.deepEqual(chains(without.itineraries), []);
  assert.deepEqual(chains(failing.itineraries), []);
  assert.deepEqual(chains(nothing.itineraries), []);
});

test('merge: one per chain (latest on-time leave, a catchable late one over one already gone), capped, earliest arrival first', async () => {
  const { withGoogle, MAX_ITINERARIES, onePerChain } = await import('../src/plan/service.ts');
  const deadline = Date.parse('2026-10-19T05:00:00Z');
  const mk = (line: string, dep: string, arr: string): Itinerary => ({
    id: `${line}${dep}`, departAt: `2026-10-19T${dep}:00.000Z`, arriveAt: `2026-10-19T${arr}:00.000Z`,
    durationSec: (Date.parse(`2026-10-19T${arr}:00Z`) - Date.parse(`2026-10-19T${dep}:00Z`)) / 1000, walkSec: 0, walkM: 0, transfers: 0,
    legs: [{ mode: 'BUS', route: { shortName: line, longName: null, color: null } } as Itinerary['legs'][number]],
  });
  const ttc = mk('539', '03:38', '04:42');
  const google = mk('539', '03:50', '04:55');
  assert.deepEqual(withGoogle([ttc], [google], { arriveBy: '2026-10-19T09:00' }, 0), [google]);
  // Already gone (left before now) vs late but catchable: the catchable one.
  const gone = mk('10', '03:00', '04:00');
  const late = mk('10', '04:30', '05:20');
  assert.deepEqual(onePerChain([gone, late], deadline, Date.parse('2026-10-19T04:10:00Z')), [late]);
  assert.deepEqual(onePerChain([gone, late], deadline), [gone]);
  // Over the cap, the longest trips go; the rest are sorted by arrival.
  const many = Array.from({ length: MAX_ITINERARIES + 2 }, (_, i) => mk(String(100 + i), `03:${String(10 + i).padStart(2, '0')}`, '04:50'));
  const out = withGoogle(many, [], { arriveBy: '2026-10-19T09:00' }, 0);
  assert.equal(out.length, MAX_ITINERARIES);
  assert.ok(!out.some((it) => it.legs[0].route!.shortName === '100' || it.legs[0].route!.shortName === '101'));
});

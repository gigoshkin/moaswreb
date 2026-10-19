import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PlanService } from '../src/plan/service.ts';
import { createTools } from '../src/tools/index.ts';
import { StopIndex } from '../src/ttc/stops.ts';
import { fakeSource, fakeTtc } from './fakes.ts';

const setup = (withSource = true, locationButton = false) => {
  const ttc = fakeTtc();
  const stops = new StopIndex(ttc);
  const tools = createTools({
    ttc, stops, plans: new PlanService(ttc, stops), geo: { search: async () => [], reverse: async () => null },
    ...(withSource ? { source: fakeSource() } : {}),
    locationButton,
  });
  const run = (name: string, input: unknown) => {
    const t = tools.find((t) => t.name === name)!;
    return t.run(t.schema.parse(input) as never);
  };
  return { ttc, tools, run };
};

test('find_stop matches Georgian, English and codes; loads stops once', async () => {
  const { ttc, run } = setup();
  assert.equal((await run('find_stop', { query: 'უნივერსიტეტი' })).card?.type, 'stops');
  const en = await run('find_stop', { query: 'free univ' });
  assert.match(en.text, /1:1405/);
  assert.match((await run('find_stop', { query: '1000' })).text, /Rustaveli Avenue/);
  assert.match((await run('find_stop', { query: 'zzz' })).text, /No stops/);
  assert.deepEqual(ttc.calls, ['stops:ka', 'stops:en']);
});

test('next_arrivals sorts by minutes and uses the timetable only when not live', async () => {
  const { run } = setup();
  const res = await run('next_arrivals', { stopId: '1:1405' });
  assert.equal(res.card?.type, 'arrivals');
  if (res.card?.type !== 'arrivals') return;
  assert.deepEqual(res.card.arrivals.map((a) => [a.route, a.minutes]), [['306', 2], ['347', 4], ['558', 11]]);
  assert.equal(res.card.arrivals[0].color, '#E02B2B');
  assert.equal(res.card.arrivals[2].color, null);
  assert.equal(res.card.stop.name, 'Free University');
  assert.match(res.text, /558 → Didube: 11 min \(timetable\)/);
});

test('plan_trip returns a plan card and Tbilisi times in text', async () => {
  const { run } = setup();
  const res = await run('plan_trip', { from: { lat: 41.7151, lon: 44.8271 }, to: { lat: 41.7099, lon: 44.7929 }, arriveBy: '2026-10-19T09:00' });
  assert.equal(res.card?.type, 'plan');
  assert.match(res.text, /leave 08:15, arrive 08:58 \(Tbilisi\), 43 min: BUS 306 \+ BUS 347/);
});

test('plan_trip card carries the trip name, place names and days for the Save button', async () => {
  const { run } = setup();
  const res = await run('plan_trip', { from: { lat: 41.7151, lon: 44.8271 }, to: { lat: 41.7099, lon: 44.7929 }, arriveBy: '2026-10-19T09:00', name: 'University', toName: 'Caucasus University', days: [3, 1, 3] });
  assert.deepEqual(res.card?.type === 'plan' && res.card.trip, { name: 'University', to: 'Caucasus University', days: [1, 3] });
  const bare = await run('plan_trip', { from: { lat: 41.7151, lon: 44.8271 }, to: { lat: 41.7099, lon: 44.7929 }, arriveBy: '2026-10-19T09:00' });
  assert.equal(bare.card && 'trip' in bare.card, false);
});

test('plan_trip rejects places outside Tbilisi at the schema', () => {
  const { tools } = setup();
  const plan = tools.find((t) => t.name === 'plan_trip')!;
  assert.throws(() => plan.schema.parse({ from: { lat: 44.8, lon: 41.7 }, to: { lat: 41.7, lon: 44.8 }, arriveBy: '2026-10-19T09:00' }));
});

test('find_place reads GeoJSON coordinates as lat,lon', async () => {
  const { run } = setup();
  assert.equal((await run('find_place', { query: 'დელისი' })).text, 'Delisi | 41.7286,44.7712');
});

test('proposals only produce confirm cards; chat-only tools are not on MCP', async () => {
  const { tools: without } = setup();
  assert.ok(!without.some((t) => t.name === 'request_location'), 'withheld from apps that cannot show the button');
  const { tools, run } = setup(true, true);
  const trip = { name: 'სახლი → სამსახური', from: { label: 'სახლი', lat: 41.71, lon: 44.82 }, to: { label: 'სამსახური', lat: 41.72, lon: 44.77 }, arriveBy: '09:00' };
  const proposed = await run('propose_trip', trip);
  assert.equal(proposed.card?.type, 'confirm_trip');
  if (proposed.card?.type !== 'confirm_trip') return;
  const { ways, plan, ...rest } = proposed.card.trip;
  assert.deepEqual(rest, trip);
  // The card ticks the best way of the trip's plan (never just From/To) and carries the plan for its rows.
  assert.equal(ways?.length, 1);
  assert.ok(plan && plan.itineraries.length > 0);
  assert.match(proposed.text, /way 1: .*\[ticked\]/);
  const ev = await run('propose_events', { events: [{ title: 'Math', days: [1, 3], start: '10:00', end: '11:30', place: 'Free Uni' }] });
  assert.equal(ev.card?.type, 'confirm_events');
  const dup = await run('propose_events', { events: [{ title: 'Math', days: [3, 1, 3], start: '10:00', end: null, place: null }] });
  assert.deepEqual(dup.card?.type === 'confirm_events' && dup.card.events[0].days, [1, 3], 'repeated days would make /me/trips reject every trip');
  assert.deepEqual(tools.filter((t) => t.mcp).map((t) => t.name), ['find_stop', 'find_place', 'next_arrivals', 'plan_trip', 'stops_near', 'lines_at_stop', 'build_route']);
  assert.deepEqual(tools.filter((t) => !t.mcp).map((t) => t.name), ['parse_maps_link', 'request_location', 'propose_trip', 'propose_route', 'propose_events']);
  assert.deepEqual((await run('request_location', {})).card, { type: 'request_location' });
});

test('plan_trip passes avoid / modes to the planner and drops avoided lines', async () => {
  const { run } = setup();
  const res = await run('plan_trip', { from: { lat: 41.7151, lon: 44.8271 }, to: { lat: 41.7099, lon: 44.7929 }, arriveBy: '2026-10-19T09:00', avoid: { routes: ['306', '306'] }, modes: ['BUS'] });
  assert.equal(res.card?.type, 'plan');
  if (res.card?.type !== 'plan') return;
  assert.deepEqual(res.card.plan.query.avoid, { routes: ['306'] });
  assert.deepEqual(res.card.plan.query.modes, ['BUS']);
  assert.doesNotMatch(res.text, /BUS 306/);
});

test('stops_near finds the closest metro station', async () => {
  const { run } = setup();
  const res = await run('stops_near', { lat: 41.7201, lon: 44.8001, mode: 'SUBWAY' });
  assert.match(res.text, /^1:3000 \| Station Square \| SUBWAY \| \d+ m$/);
  assert.equal(res.card?.type, 'stops');
  assert.match((await run('stops_near', { lat: 41.7201, lon: 44.8001, mode: 'GONDOLA' })).text, /No GONDOLA stops/);
});

test('lines_at_stop lists lines with next stop ids; toStopId keeps direct rides only', async () => {
  const { run } = setup();
  const all = await run('lines_at_stop', { stopId: '1:1405' });
  assert.match(all.text, /306 BUS → Station: Rustaveli Avenue \(1:1000\), Station Square \(1:3000\)/);
  assert.match(all.text, /518 BUS minibus → Station Square/);
  const direct = await run('lines_at_stop', { stopId: '1:1405', toStopId: '1:1000' });
  assert.match(direct.text, /306/);
  assert.doesNotMatch(direct.text, /518/);
  const off = setup(false);
  assert.match((await off.run('lines_at_stop', { stopId: '1:1405' })).text, /unavailable/);
});

test('propose_route checks rides against TTC lines and the avoid list; card only', async () => {
  const { run } = setup();
  const base = { name: 'Uni', from: { label: 'Home', lat: 41.7151, lon: 44.8271 }, to: { label: 'Station', lat: 41.72, lon: 44.8 }, arriveBy: '09:00' };
  const ok = await run('propose_route', { ...base, avoid: { minibus: true }, steps: [{ fromStops: ['1:1405'], toStops: ['1:3000'] }] });
  assert.equal(ok.card?.type, 'confirm_route');
  if (ok.card?.type !== 'confirm_route') return;
  assert.deepEqual(ok.card.route.avoid, { minibus: true });
  assert.deepEqual(ok.card.route.rides, [{ from: 'Free University', to: 'Station Square', routes: ['306'] }]);
  assert.deepEqual(ok.card.route.steps, [{ fromStops: ['1:1405'], toStops: ['1:3000'] }]);
  assert.deepEqual(ok.card.route.ways, [ok.card.route.steps.map((s: object) => ({ ...s, byHand: true }))], "the hand-built route is the way the trip keeps, marked as the rider's own");
  // Only the avoided minibus fits: refused, no card.
  const bad = await run('propose_route', { ...base, avoid: { minibus: true }, steps: [{ fromStops: ['1:1405'], toStops: ['1:3000'], routes: ['518'] }] });
  assert.equal(bad.card, undefined);
  assert.match(bad.text, /Ride 1: no line 518/);
  assert.match((await run('propose_route', { ...base, steps: [{ fromStops: ['1:9999'], toStops: ['1:3000'] }] })).text, /unknown stop 1:9999/);
  // Avoid only, no steps.
  const avoidOnly = await run('propose_route', { ...base, avoid: { routes: ['518'] } });
  assert.equal(avoidOnly.card?.type, 'confirm_route');
  if (avoidOnly.card?.type !== 'confirm_route') return;
  const { ways, plan, ...route } = avoidOnly.card.route;
  assert.deepEqual(route, { ...base, avoid: { routes: ['518'] } });
  assert.equal(ways?.length, 1, 'avoid only: the best way is ticked');
  assert.deepEqual(plan?.query.avoid, { routes: ['518'] });
});

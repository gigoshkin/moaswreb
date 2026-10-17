import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PlanService } from '../src/plan/service.ts';
import { createTools } from '../src/tools/index.ts';
import { StopIndex } from '../src/ttc/stops.ts';
import { fakeTtc } from './fakes.ts';

const setup = () => {
  const ttc = fakeTtc();
  const stops = new StopIndex(ttc);
  const tools = createTools({ ttc, stops, plans: new PlanService(ttc, stops) });
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

test('plan_trip rejects places outside Tbilisi at the schema', () => {
  const { tools } = setup();
  const plan = tools.find((t) => t.name === 'plan_trip')!;
  assert.throws(() => plan.schema.parse({ from: { lat: 44.8, lon: 41.7 }, to: { lat: 41.7, lon: 44.8 }, arriveBy: '2026-10-19T09:00' }));
});

test('find_place reads GeoJSON coordinates as lat,lon', async () => {
  const { run } = setup();
  assert.equal((await run('find_place', { query: 'დელისი' })).text, 'Delisi | 41.7286,44.7712');
});

test('proposals only produce confirm cards and are not on MCP', async () => {
  const { tools, run } = setup();
  const trip = { name: 'სახლი → სამსახური', from: { label: 'სახლი', lat: 41.71, lon: 44.82 }, to: { label: 'სამსახური', lat: 41.72, lon: 44.77 }, arriveBy: '09:00' };
  assert.deepEqual((await run('propose_trip', trip)).card, { type: 'confirm_trip', trip });
  const ev = await run('propose_events', { events: [{ title: 'Math', days: [1, 3], start: '10:00', end: '11:30', place: 'Free Uni' }] });
  assert.equal(ev.card?.type, 'confirm_events');
  assert.deepEqual(tools.filter((t) => t.mcp).map((t) => t.name), ['find_stop', 'find_place', 'next_arrivals', 'plan_trip']);
});

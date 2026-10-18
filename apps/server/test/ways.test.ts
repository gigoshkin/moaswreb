import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Itinerary, PlanLeg, PlanQuery } from '@transit/shared';
import { groupWays } from '@transit/shared';
import Fastify from 'fastify';
import { registerMcpRoute } from '../src/mcp/route.ts';
import type { PlanService } from '../src/plan/service.ts';
import { createTools, describeWays } from '../src/tools/index.ts';
import { StopIndex } from '../src/ttc/stops.ts';
import { fakeSource, fakeTtc } from './fakes.ts';

// SYNTHETIC plan in the shape of Didi Dighomi -> Liberty Square: a direct 302, and 321 / 335 / 518
// (buses from stops a few dozen metres apart) to the same metro station, then metro 1.
const P = (stopId: string, lat: number, lon: number) => ({ name: stopId, stopId, lat, lon });
const home = P('1:home', 41.791, 44.738);
const home335 = P('1:home335', 41.7912, 44.7383);
const metroBus = P('1:m-bus', 41.7225, 44.797);
const metroBus518 = P('1:m-bus-518', 41.7231, 44.7975);
const metroA = P('1:metro_1_a', 41.722, 44.796);
const metroB = P('1:metro_1_b', 41.70, 44.80);
const ride = (mode: string, line: string, from: PlanLeg['from'], to: PlanLeg['to'], dep: string, arr: string): PlanLeg =>
  ({ mode, from, to, departAt: `2026-10-19T${dep}:00.000Z`, arriveAt: `2026-10-19T${arr}:00.000Z`, durationSec: 0, distanceM: 0, route: { shortName: line, longName: null, color: null, minibus: false }, headsign: null, realtime: false, intermediateStops: 0, polyline: null }) as PlanLeg;
const it = (legs: PlanLeg[]): Itinerary => ({
  id: legs.map((l) => `${l.route?.shortName}@${l.departAt.slice(11, 16)}`).join('-'), departAt: legs[0].departAt, arriveAt: legs.at(-1)!.arriveAt,
  durationSec: (Date.parse(legs.at(-1)!.arriveAt) - Date.parse(legs[0].departAt)) / 1000, walkSec: 0, walkM: 0, transfers: legs.length - 1, legs,
});
const metro = (dep: string, arr: string) => ride('SUBWAY', '1', metroA, metroB, dep, arr);
const its = [
  it([ride('BUS', '321', home, metroBus, '04:10', '04:35'), metro('04:40', '04:52')]),
  it([ride('BUS', '335', home335, metroBus, '04:12', '04:37'), metro('04:42', '04:54')]),
  it([ride('BUS', '518', home, metroBus518, '04:14', '04:39'), metro('04:44', '04:56')]),
  it([ride('BUS', '302', P('1:302a', 41.7905, 44.7385), P('1:302b', 41.7002, 44.8002), '04:05', '04:50')]),
];
const plans = { plan: async (query: PlanQuery) => ({ query, itineraries: its, source: 'ttc' as const, fetchedAt: '2026-10-19T03:00:00.000Z' }) } as unknown as PlanService;
const ttc = fakeTtc();
const tools = createTools({ ttc, stops: new StopIndex(ttc), plans, source: fakeSource() });
const run = (name: string, input: unknown) => {
  const t = tools.find((t) => t.name === name)!;
  return t.run(t.schema.parse(input) as never);
};
const trip = { from: { lat: 41.791, lon: 44.738 }, to: { lat: 41.7, lon: 44.8 }, arriveBy: '2026-10-19T09:00' };

test('plan_trip groups options into ways by structure: direct 302 apart from 321|335|518 -> metro 1', async () => {
  const res = await run('plan_trip', trip);
  assert.match(res.text, /^2 ways /);
  // Earliest arrival first, as the app lists them.
  assert.match(res.text, /way 1: direct 302\n {2}- leave 08:05, arrive 08:50 \(Tbilisi\), 45 min: BUS 302/);
  assert.match(res.text, /way 2: 321\|335\|518 -> metro 1 \(variations\)\n {2}- leave 08:10/);
  assert.doesNotMatch(res.text, /302\|/);
  assert.equal(res.card?.type, 'plan');
  if (res.card?.type !== 'plan') return;
  // The card carries the same ways, in the same order as the app's rows (groupWays).
  assert.deepEqual(res.card.ways, [
    { label: 'direct 302', ids: ['302@04:05'] },
    { label: '321|335|518 -> metro 1', ids: ['321@04:10-1@04:40', '335@04:12-1@04:42', '518@04:14-1@04:44'] },
  ]);
  assert.deepEqual(res.card.ways!.map((w) => w.ids), groupWays(res.card.plan.itineraries).map((w) => w.its.map((i) => i.id)));
});

test('describeWays marks the ticked ways', () => {
  const kept = [[{ fromStops: ['1:302a'], toStops: ['1:302b'], routes: ['302'] }]];
  const { text } = describeWays(its, kept);
  assert.match(text, /way 1: direct 302 \[ticked\]/);
  assert.doesNotMatch(text, /metro 1 \(variations\) \[ticked\]/);
});

test('propose_trip ticks the ways the model names, else the best one', async () => {
  const base = { name: 'Work', from: { label: 'Home', lat: 41.791, lon: 44.738 }, to: { label: 'Work', lat: 41.7, lon: 44.8 }, arriveBy: '09:00' };
  const named = await run('propose_trip', { ...base, keep: ['direct 302'] });
  assert.equal(named.card?.type, 'confirm_trip');
  if (named.card?.type !== 'confirm_trip') return;
  assert.deepEqual(named.card.trip.ways, [[{ fromStops: ['1:302a'], toStops: ['1:302b'], lines: [{ label: '302', kind: 'bus' }], routes: ['302'] }]]);
  assert.match(named.text, /direct 302 \[ticked\]/);
  const both = await run('propose_trip', { ...base, keep: ['direct 302', '335 -> metro 1'] });
  assert.equal(both.card?.type === 'confirm_trip' && both.card.trip.ways?.length, 2);
  const dflt = await run('propose_trip', base);
  assert.equal(dflt.card?.type === 'confirm_trip' && dflt.card.trip.ways?.length, 1, 'nothing named: one way, the best');
});

const app = Fastify();
registerMcpRoute(app, tools);
const address = await app.listen({ port: 0, host: '127.0.0.1' });
after(() => app.close());

test('MCP plan_trip returns the same grouped text', async () => {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${address}/mcp`)));
  const res = await client.callTool({ name: 'plan_trip', arguments: trip });
  const text = (res.content as Array<{ text: string }>)[0].text;
  assert.equal(text, (await run('plan_trip', trip)).text);
  assert.match(text, /way 1: direct 302/);
  assert.match(text, /way 2: 321\|335\|518 -> metro 1/);
  await client.close();
});

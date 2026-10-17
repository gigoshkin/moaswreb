import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import Fastify from 'fastify';
import { registerMcpRoute } from '../src/mcp/route.ts';
import { PlanService } from '../src/plan/service.ts';
import { createTools } from '../src/tools/index.ts';
import { StopIndex } from '../src/ttc/stops.ts';
import { fakeTtc } from './fakes.ts';

const ttc = fakeTtc();
const app = Fastify();
registerMcpRoute(app, createTools({ ttc, stops: new StopIndex(ttc), plans: new PlanService(ttc) }));
const address = await app.listen({ port: 0, host: '127.0.0.1' });
after(() => app.close());

test('a real MCP client lists the read-only tools and calls one', async () => {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${address}/mcp`)));
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['find_place', 'find_stop', 'next_arrivals', 'plan_trip']);

  const res = await client.callTool({ name: 'next_arrivals', arguments: { stopId: '1:1405' } });
  const text = (res.content as Array<{ type: string; text: string }>)[0].text;
  assert.match(text, /306 → Saburtalo: 2 min/);
  assert.equal((res.structuredContent as { card: { type: string } }).card.type, 'arrivals');

  const bad = await client.callTool({ name: 'next_arrivals', arguments: { stopId: 'nope' } });
  assert.equal(bad.isError, true);
  await client.close();
});

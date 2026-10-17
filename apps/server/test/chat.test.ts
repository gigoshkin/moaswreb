import assert from 'node:assert/strict';
import { test } from 'node:test';
import Anthropic from '@anthropic-ai/sdk';
import Fastify from 'fastify';
import { registerChatRoute } from '../src/chat/route.ts';
import { PlanService } from '../src/plan/service.ts';
import { StopIndex } from '../src/ttc/stops.ts';
import { fakeTtc } from './fakes.ts';

/** A scripted stand-in for the Claude API: returns the given responses in order and records requests. */
const scriptedClaude = (responses: object[]) => {
  const requests: Array<{ headers: Headers; body: any }> = [];
  const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    requests.push({ headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    const next = responses[requests.length - 1];
    return new Response(JSON.stringify(next), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { client: new Anthropic({ apiKey: 'test', fetch: fetch as typeof globalThis.fetch, maxRetries: 0 }), requests };
};

const message = (content: object[], stop_reason: string) => ({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content, stop_reason,
  stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 },
});

const setup = (responses: object[]) => {
  const ttc = fakeTtc();
  const claude = scriptedClaude(responses);
  const app = Fastify();
  registerChatRoute(app, { ttc, stops: new StopIndex(ttc), plans: new PlanService(ttc) }, claude.client);
  return { app, ...claude };
};

test('tool calls become cards; the reply is the model text', async () => {
  const { app, requests } = setup([
    message([{ type: 'tool_use', id: 'tu_1', name: 'next_arrivals', input: { stopId: '1:1405' } }], 'tool_use'),
    message([{ type: 'text', text: '306 მოდის 2 წუთში.' }], 'end_turn'),
  ]);
  const res = await app.inject({
    method: 'POST', url: '/chat',
    payload: { messages: [{ role: 'user', text: 'როდის მოვა ავტობუსი უნივერსიტეტთან?' }], trips: [] },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.reply, '306 მოდის 2 წუთში.');
  assert.deepEqual(body.cards.map((c: { type: string }) => c.type), ['arrivals']);

  // Request shape: fallback beta, cached system prompt, context as a trailing system message, tool result fed back.
  const first = requests[0];
  assert.match(first.headers.get('anthropic-beta') ?? '', /server-side-fallback-2026-07-01/);
  assert.equal(first.body.fallbacks, 'default');
  assert.equal(first.body.model, 'claude-sonnet-5-5');
  assert.equal(first.body.system[0].cache_control.type, 'ephemeral');
  assert.equal(first.body.messages.at(-1).role, 'system');
  assert.match(first.body.messages.at(-1).content, /Tbilisi time/);
  const toolResult = requests[1].body.messages.find((m: any) => Array.isArray(m.content) && m.content[0]?.type === 'tool_result');
  assert.match(JSON.stringify(toolResult), /306 → Saburtalo: 2 min/);
});

test('photos are sent as image blocks on the last user message', async () => {
  const { app, requests } = setup([message([{ type: 'text', text: 'ok' }], 'end_turn')]);
  await app.inject({
    method: 'POST', url: '/chat',
    payload: { messages: [{ role: 'user', text: '', attachments: [{ kind: 'image', mediaType: 'image/png', data: 'aGk=' }] }] },
  });
  const content = requests[0].body.messages[0].content;
  assert.equal(content[0].type, 'image');
  assert.equal(content[1].text, '(see attachment)');
});

test('a refusal returns a short Georgian reply and no cards', async () => {
  const { app } = setup([message([], 'refusal')]);
  const res = await app.inject({ method: 'POST', url: '/chat', payload: { messages: [{ role: 'user', text: 'x' }] } });
  assert.deepEqual(res.json(), { reply: 'ამაში ვერ დაგეხმარებით.', cards: [] });
});

test('rejects a conversation that does not end with the user', async () => {
  const { app, requests } = setup([]);
  const res = await app.inject({ method: 'POST', url: '/chat', payload: { messages: [{ role: 'assistant', text: 'hi' }] } });
  assert.equal(res.statusCode, 400);
  assert.equal(requests.length, 0);
});

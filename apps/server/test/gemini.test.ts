import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runGeminiChat } from '../src/chat/gemini.ts';
import { PlanService } from '../src/plan/service.ts';
import { StopIndex } from '../src/ttc/stops.ts';
import { fakeTtc } from './fakes.ts';

/** A scripted stand-in for the Gemini API. */
const scripted = (responses: object[]) => {
  const bodies: any[] = [];
  const doFetch = async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify(responses[bodies.length - 1]), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { doFetch: doFetch as typeof fetch, bodies };
};

test('Gemini: a tool call becomes a card and its result is fed back', async () => {
  const ttc = fakeTtc();
  const stops = new StopIndex(ttc);
  const { doFetch, bodies } = scripted([
    { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'next_arrivals', args: { stopId: '1:1405' } } }] } }] },
    { candidates: [{ content: { role: 'model', parts: [{ text: '306 arrives in 2 min.' }] } }] },
  ]);
  const out = await runGeminiChat({ messages: [{ role: 'user', text: 'next bus?' }] }, { ttc, stops, plans: new PlanService(ttc, stops) }, doFetch);
  assert.equal(out.reply, '306 arrives in 2 min.');
  assert.deepEqual(out.cards.map((c) => c.type), ['arrivals']);
  assert.ok(bodies[0].tools[0].functionDeclarations.some((d: any) => d.name === 'plan_trip' && d.parametersJsonSchema.type === 'object'));
  assert.match(bodies[0].systemInstruction.parts[0].text, /Tbilisi time/);
  assert.match(JSON.stringify(bodies[1].contents.at(-1)), /306 → Saburtalo: 2 min/);
});

test('Gemini: photos go in as inline data on the last user message', async () => {
  const ttc = fakeTtc();
  const stops = new StopIndex(ttc);
  const { doFetch, bodies } = scripted([{ candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] } }] }]);
  await runGeminiChat(
    { messages: [{ role: 'user', text: '', attachments: [{ kind: 'image', mediaType: 'image/png', data: 'aGk=' }] }] },
    { ttc, stops, plans: new PlanService(ttc, stops) },
    doFetch,
  );
  assert.deepEqual(bodies[0].contents[0].parts[0], { inlineData: { mimeType: 'image/png', data: 'aGk=' } });
});

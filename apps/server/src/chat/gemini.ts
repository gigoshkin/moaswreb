import type { ActionCard, ChatRequest, ChatResponse } from '@transit/shared';
import * as z from 'zod/v4';
import { config } from '../config.ts';
import { createTools, type ToolDeps } from '../tools/index.ts';
import { contextOf, SYSTEM, TOO_MANY_STEPS } from './agent.ts';

// Free-tier stand-in for Claude while testing (AI_PROVIDER=gemini): Google AI Studio's
// REST API, same tools, same cards. Photos and PDFs go in as inline data.

const MAX_TURNS = 8;
export let RETRY_DELAY_MS = 1500;
export const setRetryDelay = (ms: number) => { RETRY_DELAY_MS = ms; };
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

interface Part {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: { result: string } };
  thought?: boolean;
}
interface Content {
  role: 'user' | 'model';
  parts: Part[];
}
interface GenerateResponse {
  candidates?: { content?: Content; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

export class GeminiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Fetch = typeof fetch;

const toContents = (req: ChatRequest): Content[] => {
  const lastUser = req.messages.findLastIndex((m) => m.role === 'user');
  return req.messages.map((m, i): Content => {
    const parts: Part[] = [];
    if (i === lastUser) for (const a of m.attachments ?? []) parts.push({ inlineData: { mimeType: a.mediaType, data: a.data } });
    parts.push({ text: m.text || '(see attachment)' });
    return { role: m.role === 'user' ? 'user' : 'model', parts };
  });
};

const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One request: busy or failing answers are retried with a pause, then once on the fallback model if one is set. */
async function generate(doFetch: Fetch, body: string): Promise<Response> {
  const models = [config.gemini.model, ...(config.gemini.fallbackModel ? [config.gemini.fallbackModel] : [])];
  let last: Response | null = null;
  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await sleep(RETRY_DELAY_MS * attempt);
      const res = await doFetch(`${ENDPOINT}/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': config.gemini.key },
        body,
      });
      if (res.ok) return res;
      last = res;
      if (!RETRY_STATUS.has(res.status)) throw new GeminiError(res.status, (await res.text()).slice(0, 300));
    }
  }
  throw new GeminiError(last!.status, (await last!.text()).slice(0, 300));
}

/** One chat turn on Gemini: the model calls our tools; tool results become the cards. */
export async function runGeminiChat(req: ChatRequest, deps: ToolDeps, doFetch: Fetch = fetch): Promise<ChatResponse> {
  const cards: ActionCard[] = [];
  const tools = createTools({ fetch: doFetch, ...deps, locale: req.locale ?? 'en' });
  const byName = new Map(tools.map((t) => [t.name, t]));
  const declarations = tools.map((t) => ({
    name: t.name,
    description: t.description,
    parametersJsonSchema: z.toJSONSchema(t.schema, { target: 'draft-7', io: 'input' }),
  }));

  const contents = toContents(req);
  const system = `${SYSTEM}\n\n${contextOf(req)}`;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await generate(
      doFetch,
      JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        tools: [{ functionDeclarations: declarations }],
      }),
    );
    const data = (await res.json()) as GenerateResponse;
    if (data.promptFeedback?.blockReason) return { reply: "I can't help with that.", cards: [] };

    const content = data.candidates?.[0]?.content;
    const parts = content?.parts ?? [];
    const calls = parts.filter((p) => p.functionCall);
    if (!calls.length) {
      const reply = parts
        .filter((p) => p.text && !p.thought)
        .map((p) => p.text)
        .join(' ')
        .trim();
      return { reply, cards };
    }

    contents.push({ role: 'model', parts });
    const answers: Part[] = [];
    for (const { functionCall } of calls) {
      const { name, args } = functionCall!;
      const def = byName.get(name);
      let result: string;
      try {
        if (!def) throw new Error(`unknown tool ${name}`);
        const out = await def.run(def.schema.parse(args ?? {}) as never);
        if (out.card) cards.push(out.card);
        result = out.text;
      } catch (err) {
        result = `Tool failed: ${(err as Error).message}. Tell the user the data is unavailable right now.`;
      }
      answers.push({ functionResponse: { name, response: { result } } });
    }
    contents.push({ role: 'user', parts: answers });
  }
  return { reply: TOO_MANY_STEPS, cards };
}

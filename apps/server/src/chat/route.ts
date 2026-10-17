import Anthropic from '@anthropic-ai/sdk';
import type { ChatRequest } from '@transit/shared';
import type { FastifyInstance } from 'fastify';
import { requireKey } from '../auth.ts';
import { config } from '../config.ts';
import type { ToolDeps } from '../tools/index.ts';
import { runChat } from './agent.ts';

const MAX_BODY = 20 * 1024 * 1024; // photos and PDFs arrive base64-encoded

const place = {
  type: 'object',
  required: ['label', 'lat', 'lon'],
  additionalProperties: false,
  properties: { label: { type: 'string', maxLength: 200 }, lat: { type: 'number' }, lon: { type: 'number' } },
} as const;

const bodySchema = {
  type: 'object',
  required: ['messages'],
  properties: {
    messages: {
      type: 'array',
      minItems: 1,
      maxItems: 40,
      items: {
        type: 'object',
        required: ['role', 'text'],
        properties: {
          role: { type: 'string', enum: ['user', 'assistant'] },
          text: { type: 'string', maxLength: 8000 },
          attachments: {
            type: 'array',
            maxItems: 5,
            items: {
              type: 'object',
              required: ['kind', 'mediaType', 'data'],
              properties: {
                kind: { type: 'string', enum: ['image', 'pdf'] },
                mediaType: { type: 'string', enum: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'] },
                data: { type: 'string' },
              },
            },
          },
        },
      },
    },
    // Goes into the prompt, so only the TripContext fields, bounded.
    trips: {
      type: 'array',
      maxItems: 50,
      items: {
        type: 'object',
        required: ['name', 'from', 'to', 'arriveBy'],
        additionalProperties: false,
        properties: {
          name: { type: 'string', maxLength: 100 },
          from: place,
          to: place,
          arriveBy: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
        },
      },
    },
    locale: { type: 'string', enum: ['ka', 'en'] },
  },
} as const;

/** POST /chat: the app's single input (request 0001). Answers with a short reply plus action cards. */
export const registerChatRoute = (app: FastifyInstance, deps: ToolDeps, client: Anthropic | null = null): void => {
  const anthropic = client ?? (config.anthropic.enabled ? new Anthropic() : null);

  app.post<{ Body: ChatRequest }>(
    '/chat',
    { preHandler: requireKey, bodyLimit: MAX_BODY, schema: { body: bodySchema } },
    async (req, reply) => {
      if (!anthropic) {
        return reply.code(503).send({ error: 'chat_disabled', message: 'ANTHROPIC_API_KEY is not set on the server' });
      }
      if (req.body.messages.at(-1)?.role !== 'user') {
        return reply.code(400).send({ error: 'bad_request', message: 'The last message must be from the user' });
      }
      try {
        return await runChat(req.body, { ...deps, client: anthropic });
      } catch (err) {
        if (err instanceof Anthropic.RateLimitError) {
          return reply.code(429).send({ error: 'busy', message: 'Too many requests, try again shortly' });
        }
        if (err instanceof Anthropic.APIError) {
          req.log.error({ status: err.status, msg: err.message }, 'Claude API error');
          return reply.code(502).send({ error: 'upstream', message: 'The assistant is unavailable right now' });
        }
        throw err;
      }
    },
  );
};

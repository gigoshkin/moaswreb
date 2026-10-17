import type { FastifyReply, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { config } from './config.ts';

/**
 * Bearer key for /chat and /mcp (the endpoints that cost Claude tokens or are
 * meant for personal AI tools). Open when API_KEY is unset, for local dev.
 */
export const requireKey = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
  const expected = config.apiKey;
  if (!expected) return;
  const got = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    await reply.code(401).send({ error: 'unauthorized', message: 'Missing or wrong API key' });
  }
};

import type { FastifyInstance } from 'fastify';

/**
 * Per-client request limits, fixed one-minute windows, in memory. The app's
 * API key ships inside the app bundle, so it can't stop abuse on its own;
 * this keeps one client from draining the TTC queue or the Claude budget.
 * Behind Caddy, set TRUST_PROXY so req.ip is the real client.
 */
export interface Limits {
  /** /plan, /stops, /places, /me, /mcp: requests per minute per IP. */
  perMin: number;
  /** /chat (costs Claude tokens): requests per minute per IP. */
  chatPerMin: number;
}

const WINDOW_MS = 60_000;

const bucketOf = (url: string): 'chat' | 'api' | null => {
  const path = url.split('?')[0];
  if (path === '/chat') return 'chat';
  if (path === '/health' || path.endsWith('/stats')) return null;
  return 'api';
};

export const registerRateLimit = (app: FastifyInstance, limits: Limits, now = () => Date.now()): void => {
  let windowStart = now();
  let counts = new Map<string, number>();

  app.addHook('onRequest', async (req, reply) => {
    const bucket = bucketOf(req.url);
    if (!bucket) return;
    const t = now();
    if (t - windowStart >= WINDOW_MS) {
      windowStart = t;
      counts = new Map();
    }
    const key = `${bucket}|${req.ip}`;
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    const max = bucket === 'chat' ? limits.chatPerMin : limits.perMin;
    if (n > max) {
      const retry = Math.ceil((windowStart + WINDOW_MS - t) / 1000);
      await reply.code(429).header('retry-after', String(retry)).send({ error: 'rate_limited', message: 'Too many requests, try again shortly' });
    }
  });
};

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
  /** /chat per day, per IP and, separately, per x-device-id (0 = off). */
  chatPerDay: number;
  /** /chat per day across everyone: the hard stop on the Claude bill (0 = off). */
  chatPerDayTotal: number;
}

const WINDOW_MS = 60_000;
const DAY_MS = 24 * 60 * 60_000;
const TBILISI_MS = 4 * 60 * 60_000;

const bucketOf = (url: string): 'chat' | 'api' | null => {
  const path = url.split('?')[0];
  if (path === '/chat') return 'chat';
  if (path === '/health' || path.endsWith('/stats')) return null;
  return 'api';
};

export const registerRateLimit = (app: FastifyInstance, limits: Limits, now = () => Date.now()): void => {
  let windowStart = now();
  let counts = new Map<string, number>();
  // Daily chat quota, Tbilisi calendar day. In memory, so a restart resets it.
  let day = Math.floor((now() + TBILISI_MS) / DAY_MS);
  let daily = new Map<string, number>();
  let dailyTotal = 0;

  app.addHook('onRequest', async (req, reply) => {
    const bucket = bucketOf(req.url);
    if (!bucket) return;
    const t = now();
    if (t - windowStart >= WINDOW_MS) {
      windowStart = t;
      counts = new Map();
    }
    if (bucket === 'chat' && (limits.chatPerDay > 0 || limits.chatPerDayTotal > 0)) {
      const today = Math.floor((t + TBILISI_MS) / DAY_MS);
      if (today !== day) {
        day = today;
        daily = new Map();
        dailyTotal = 0;
      }
      // The device id is claimed by the client, so it only catches honest users; the IP and the total are the real limits.
      const device = req.headers['x-device-id'];
      const keys = [`ip|${req.ip}`, ...(typeof device === 'string' && device ? [`dev|${device.slice(0, 64)}`] : [])];
      const over =
        (limits.chatPerDayTotal > 0 && dailyTotal >= limits.chatPerDayTotal) ||
        (limits.chatPerDay > 0 && keys.some((k) => (daily.get(k) ?? 0) >= limits.chatPerDay));
      if (over) {
        return reply.code(429).send({ error: 'quota', message: 'Daily assistant limit reached, try again tomorrow' });
      }
      for (const k of keys) daily.set(k, (daily.get(k) ?? 0) + 1);
      dailyTotal++;
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

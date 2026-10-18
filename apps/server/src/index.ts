import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Fastify from 'fastify';
import { config } from './config.ts';
import { Poller } from './logger/poller.ts';
import { Recorder } from './logger/recorder.ts';
import { AlertWatcher } from './alerts/watcher.ts';
import { expoPush } from './alerts/push.ts';
import { registerChatRoute } from './chat/route.ts';
import { registerMcpRoute } from './mcp/route.ts';
import { registerPlanRoute } from './plan/route.ts';
import { TtcSource } from './journey/ttc-source.ts';
import { PlanService } from './plan/service.ts';
import { Sealer } from './store/crypto.ts';
import { registerMeRoutes } from './store/route.ts';
import { TripStore } from './store/trips.ts';
import { registerRateLimit } from './ratelimit.ts';
import { registerStopRoutes } from './stops/route.ts';
import { createTools } from './tools/index.ts';
import { StopIndex } from './ttc/stops.ts';
import { TtcClient } from './ttc/client.ts';

mkdirSync(config.dataDir, { recursive: true });
const ttc = new TtcClient();
const recorder = new Recorder(config.dataDir);
const poller = new Poller(ttc, recorder);
const stops = new StopIndex(ttc);
const source = new TtcSource(ttc, stops, join(config.dataDir, 'transit-cache.json'));
const plans = new PlanService(ttc, stops, source);
const store = config.tripsKey ? new TripStore(config.dataDir, new Sealer(config.tripsKey)) : null;
const watcher = store ? new AlertWatcher(store, stops, plans, expoPush()) : null;

const app = Fastify({ logger: { level: 'info' }, disableRequestLogging: true, trustProxy: config.trustProxy });
registerRateLimit(app, config.limits);

app.get('/health', async () => ({ ok: true, ttcKeyLoaded: ttc.hasKey }));
app.get('/logger/stats', async () => poller.stats());
app.get('/alerts/stats', async () => ({ enabled: Boolean(watcher), sent: watcher?.sent ?? 0, lastError: watcher?.lastError ?? null }));
registerPlanRoute(app, plans);
registerStopRoutes(app, { ttc, stops, source });
registerChatRoute(app, { ttc, stops, plans, source });
registerMcpRoute(app, createTools({ ttc, stops, plans, source }));
if (store) registerMeRoutes(app, store);
else app.log.warn('TRIPS_KEY not set: stored trips and alerts are off');

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down`);
  poller.stop();
  watcher?.stop();
  await recorder.close();
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: config.port, host: '0.0.0.0' });
poller.start().catch((err) => app.log.error(err, 'poller failed to start'));
watcher?.start();
if (store) {
  const purge = () => app.log.info(`purged ${store.purge()} inactive devices`);
  purge();
  setInterval(purge, 24 * 60 * 60 * 1000).unref();
}

import Fastify from 'fastify';
import { config } from './config.ts';
import { Poller } from './logger/poller.ts';
import { Recorder } from './logger/recorder.ts';
import { registerChatRoute } from './chat/route.ts';
import { registerMcpRoute } from './mcp/route.ts';
import { registerPlanRoute } from './plan/route.ts';
import { PlanService } from './plan/service.ts';
import { createTools } from './tools/index.ts';
import { StopIndex } from './ttc/stops.ts';
import { TtcClient } from './ttc/client.ts';

const ttc = new TtcClient();
const recorder = new Recorder(config.dataDir);
const poller = new Poller(ttc, recorder);
const plans = new PlanService(ttc);
const stops = new StopIndex(ttc);

const app = Fastify({ logger: { level: 'info' }, disableRequestLogging: true });

app.get('/health', async () => ({ ok: true, ttcKeyLoaded: ttc.hasKey }));
app.get('/logger/stats', async () => poller.stats());
registerPlanRoute(app, plans);
registerChatRoute(app, { ttc, stops, plans });
registerMcpRoute(app, createTools({ ttc, stops, plans }));

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down`);
  poller.stop();
  await recorder.close();
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: config.port, host: '0.0.0.0' });
poller.start().catch((err) => app.log.error(err, 'poller failed to start'));

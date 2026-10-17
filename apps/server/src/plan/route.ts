import type { FastifyInstance } from 'fastify';
import {
  tbilisiLocalToIso,
  type LatLon,
  type Locale,
  type Optimize,
  type PlanMode,
  type PlanQuery,
  type PlanResponse,
} from '@transit/shared';
import { TtcError, type TtcClient } from '../ttc/client.ts';
import { normalizePlan } from './normalize.ts';

// Roughly TTC's geocode bbox, padded. Rejects swapped lat/lon early.
const TBILISI = { minLat: 41.55, maxLat: 41.9, minLon: 44.6, maxLon: 45.1 };
const CACHE_MS = 60_000;
const ALL_MODES: PlanMode[] = ['BUS', 'SUBWAY', 'GONDOLA'];

interface Querystring {
  from: string;
  to: string;
  arriveBy: string;
  modes?: string;
  optimize?: Optimize;
  locale?: Locale;
}

const latLon = (s: string): LatLon | null => {
  const [lat, lon] = s.split(',').map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const inside = lat >= TBILISI.minLat && lat <= TBILISI.maxLat && lon >= TBILISI.minLon && lon <= TBILISI.maxLon;
  return inside ? { lat, lon } : null;
};

/**
 * GET /plan?from=lat,lon&to=lat,lon&arriveBy=YYYY-MM-DDTHH:mm[&modes=BUS,SUBWAY][&optimize=quick][&locale=ka]
 *
 * Wraps TTC `v2/plan` with departMode=arriveBy. `arriveBy` is Tbilisi wall
 * clock. Identical queries within a minute are served from memory so a busy
 * screen can't multiply TTC traffic.
 */
export const registerPlanRoute = (app: FastifyInstance, ttc: TtcClient): void => {
  const cache = new Map<string, { at: number; body: PlanResponse }>();

  app.get<{ Querystring: Querystring }>(
    '/plan',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['from', 'to', 'arriveBy'],
          properties: {
            from: { type: 'string' },
            to: { type: 'string' },
            arriveBy: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$' },
            modes: { type: 'string', pattern: '^(BUS|SUBWAY|GONDOLA)(,(BUS|SUBWAY|GONDOLA))*$' },
            optimize: { type: 'string', enum: ['quick', 'lessWalking', 'fewerTransfers'] },
            locale: { type: 'string', enum: ['ka', 'en'] },
          },
        },
      },
    },
    async (req, reply) => {
      const q = req.query;
      const from = latLon(q.from);
      const to = latLon(q.to);
      if (!from || !to) {
        return reply.code(400).send({ error: 'bad_place', message: 'from/to must be "lat,lon" inside Tbilisi' });
      }
      if (!tbilisiLocalToIso(q.arriveBy)) {
        return reply.code(400).send({ error: 'bad_time', message: 'arriveBy must be a real YYYY-MM-DDTHH:mm' });
      }

      const query: PlanQuery = {
        from,
        to,
        arriveBy: q.arriveBy,
        modes: q.modes ? [...new Set(q.modes.split(',') as PlanMode[])] : ALL_MODES,
        optimize: q.optimize ?? 'quick',
        locale: q.locale ?? 'ka',
      };
      const key = JSON.stringify(query);
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < CACHE_MS) return hit.body;

      try {
        const [date, time] = query.arriveBy.split('T');
        const raw = await ttc.plan({
          from,
          to,
          departMode: 'arriveBy',
          date,
          time,
          modes: query.modes!,
          optimize: query.optimize!,
          locale: query.locale,
        });
        const body: PlanResponse = {
          query,
          itineraries: normalizePlan(raw),
          source: 'ttc',
          fetchedAt: new Date().toISOString(),
        };
        cache.set(key, { at: Date.now(), body });
        if (cache.size > 500) cache.delete(cache.keys().next().value!);
        return body;
      } catch (err) {
        req.log.warn({ err }, 'TTC plan failed');
        const status = err instanceof TtcError && err.status < 500 && err.status !== 429 ? 502 : 503;
        return reply.code(status).send({ error: 'upstream', message: 'TTC trip planner unavailable' });
      }
    },
  );
};

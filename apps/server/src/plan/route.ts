import type { FastifyInstance } from 'fastify';
import {
  tbilisiLocalToIso,
  type LatLon,
  type Locale,
  type Optimize,
  type PlanMode,
  type PlanQuery,
} from '@transit/shared';
import { insideTbilisi } from '../geo.ts';
import { upstreamFailed } from '../ttc/client.ts';
import type { PlanService } from './service.ts';

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
  return insideTbilisi(lat, lon) ? { lat, lon } : null;
};

/**
 * GET /plan?from=lat,lon&to=lat,lon&arriveBy=YYYY-MM-DDTHH:mm[&modes=BUS,SUBWAY][&optimize=quick][&locale=ka]
 *
 * Wraps TTC `v2/plan` with departMode=arriveBy. `arriveBy` is Tbilisi wall
 * clock. Caching lives in PlanService.
 */
export const registerPlanRoute = (app: FastifyInstance, plans: PlanService): void => {
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
        locale: q.locale ?? 'en',
      };
      try {
        return await plans.plan(query);
      } catch (err) {
        req.log.warn({ err }, 'TTC plan failed');
        return reply.code(upstreamFailed(err)).send({ error: 'upstream', message: 'TTC trip planner unavailable' });
      }
    },
  );
};

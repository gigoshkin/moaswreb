import type { FastifyInstance } from 'fastify';
import {
  tbilisiLocalToIso,
  type LatLon,
  type Locale,
  type Optimize,
  type JourneyStep,
  type PlanAvoid,
  type PlanMode,
  type PlanQuery,
} from '@transit/shared';
import { STOP_ID_PATTERN } from '@transit/shared';
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
  /** Route numbers to leave out, comma separated. */
  avoid?: string;
  avoidMinibus?: boolean;
  /** `ttc`: only TTC's planner answers (the fast part of the plan). */
  part?: 'ttc';
}

const avoidOf = (routes: string[], minibus?: boolean): { avoid?: PlanAvoid } => {
  const list = [...new Set(routes.map((r) => r.trim()).filter(Boolean))];
  return list.length || minibus ? { avoid: { ...(list.length ? { routes: list.sort() } : {}), ...(minibus ? { minibus: true } : {}) } } : {};
};

const latLon = (s: string): LatLon | null => {
  const [lat, lon] = s.split(',').map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return insideTbilisi(lat, lon) ? { lat, lon } : null;
};

/**
 * GET /plan?from=lat,lon&to=lat,lon&arriveBy=YYYY-MM-DDTHH:mm[&modes=BUS,SUBWAY][&optimize=quick][&locale=ka][&part=ttc]
 *
 * Wraps TTC `v2/plan` with departMode=arriveBy. `arriveBy` is Tbilisi wall
 * clock. Caching lives in PlanService. `part=ttc` answers with TTC's planner
 * alone, fast, marked `partial: true`; the app asks it beside the full plan to
 * show something while our own planner is still loading.
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
            avoid: { type: 'string', pattern: '^[^,]{1,12}(,[^,]{1,12}){0,19}$' },
            avoidMinibus: { type: 'boolean' },
            part: { type: 'string', enum: ['ttc'] },
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
        ...avoidOf(q.avoid ? q.avoid.split(',') : [], q.avoidMinibus),
      };
      try {
        return q.part === 'ttc' ? await plans.planTtc(query) : await plans.plan(query);
      } catch (err) {
        req.log.warn({ err }, 'TTC plan failed');
        return reply.code(upstreamFailed(err)).send({ error: 'upstream', message: 'TTC trip planner unavailable' });
      }
    },
  );

  // A hand-built route: the rides in order, each with the stops and lines allowed.
  app.post<{ Body: { from: LatLon; to: LatLon; arriveBy: string; steps: JourneyStep[]; avoid?: PlanAvoid; locale?: Locale } }>(
    '/plan/journey',
    {
      schema: {
        body: {
          type: 'object',
          required: ['from', 'to', 'arriveBy', 'steps'],
          properties: {
            from: { type: 'object', required: ['lat', 'lon'], properties: { lat: { type: 'number' }, lon: { type: 'number' } } },
            to: { type: 'object', required: ['lat', 'lon'], properties: { lat: { type: 'number' }, lon: { type: 'number' } } },
            arriveBy: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$' },
            locale: { type: 'string', enum: ['ka', 'en'] },
            avoid: { type: 'object', properties: { routes: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 12 } }, minibus: { type: 'boolean' } } },
            steps: {
              type: 'array',
              minItems: 1,
              maxItems: 6,
              items: {
                type: 'object',
                required: ['fromStops', 'toStops'],
                properties: {
                  fromStops: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', pattern: STOP_ID_PATTERN } },
                  toStops: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', pattern: STOP_ID_PATTERN } },
                  routes: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 12 } },
                },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const b = req.body;
      if (!insideTbilisi(b.from.lat, b.from.lon) || !insideTbilisi(b.to.lat, b.to.lon)) {
        return reply.code(400).send({ error: 'bad_place', message: 'from/to must be inside Tbilisi' });
      }
      if (!tbilisiLocalToIso(b.arriveBy)) return reply.code(400).send({ error: 'bad_time', message: 'arriveBy must be a real YYYY-MM-DDTHH:mm' });
      const query: PlanQuery = { from: b.from, to: b.to, arriveBy: b.arriveBy, locale: b.locale ?? 'en', steps: b.steps, ...(b.avoid ? { avoid: b.avoid } : {}) };
      try {
        return await plans.plan(query);
      } catch (err) {
        req.log.warn({ err }, 'journey plan failed');
        return reply.code(upstreamFailed(err)).send({ error: 'upstream', message: 'Trip planner unavailable' });
      }
    },
  );
};

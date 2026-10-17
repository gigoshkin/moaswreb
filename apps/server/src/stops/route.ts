import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { STOP_ID_PATTERN, type Locale, type NearStopsResponse, type PlacesResponse, type StopsResponse } from '@transit/shared';
import { insideTbilisi } from '../geo.ts';
import { upstreamFailed } from '../ttc/client.ts';
import { arrivalsAt, findPlaces } from '../ttc/lookups.ts';
import type { TtcClient } from '../ttc/client.ts';
import type { StopIndex } from '../ttc/stops.ts';

const locale = { type: 'string', enum: ['ka', 'en'] } as const;
const limit = { type: 'integer', minimum: 1, maximum: 20 } as const;

/**
 * Lookups for screens:
 *   GET /stops?q=         stop search by name (matches Georgian or English) or code, from the in-memory index
 *   GET /stops/near       closest stops to a point, from the in-memory index
 *   GET /stops/:id/arrivals  live countdown, one TTC call
 *   GET /places?q=        address/landmark search (OSM via TTC), one TTC call
 * Same data as the chat tools (ttc/lookups.ts). Names come back in English
 * unless ?locale=ka (TTC's data is bilingual; the app is English-only).
 */
export const registerStopRoutes = (app: FastifyInstance, deps: { ttc: TtcClient; stops: StopIndex }): void => {
  const { ttc, stops } = deps;
  const fail = (req: FastifyRequest, reply: FastifyReply, err: unknown) => {
    req.log.warn({ err }, 'TTC lookup failed');
    return reply.code(upstreamFailed(err)).send({ error: 'upstream', message: 'TTC unavailable' });
  };

  app.get<{ Querystring: { q: string; limit?: number; locale?: Locale } }>(
    '/stops',
    { schema: { querystring: { type: 'object', required: ['q'], properties: { q: { type: 'string', minLength: 1, maxLength: 100 }, limit, locale } } } },
    async (req, reply): Promise<StopsResponse | undefined> => {
      try {
        return { stops: await stops.search(req.query.q, req.query.limit ?? 5, req.query.locale ?? 'en') };
      } catch (err) {
        return fail(req, reply, err);
      }
    },
  );

  app.get<{ Querystring: { lat: number; lon: number; radius?: number; limit?: number; mode?: string; locale?: Locale } }>(
    '/stops/near',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['lat', 'lon'],
          properties: {
            lat: { type: 'number' },
            lon: { type: 'number' },
            radius: { type: 'integer', minimum: 10, maximum: 2000 },
            limit,
            mode: { type: 'string', enum: ['BUS', 'SUBWAY', 'GONDOLA'] },
            locale,
          },
        },
      },
    },
    async (req, reply): Promise<NearStopsResponse | undefined> => {
      const q = req.query;
      if (!insideTbilisi(q.lat, q.lon)) return reply.code(400).send({ error: 'bad_place', message: 'lat/lon must be inside Tbilisi' });
      try {
        return { stops: await stops.near(q, { radiusM: q.radius ?? 500, limit: q.limit ?? 10, mode: q.mode, locale: q.locale ?? 'en' }) };
      } catch (err) {
        return fail(req, reply, err);
      }
    },
  );

  app.get<{ Params: { id: string }; Querystring: { locale?: Locale } }>(
    '/stops/:id/arrivals',
    {
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: STOP_ID_PATTERN } } },
        querystring: { type: 'object', properties: { locale } },
      },
    },
    async (req, reply) => {
      const lang = req.query.locale ?? 'en';
      try {
        // Unknown ids are rejected here so they never cost a TTC call.
        if (!(await stops.get(req.params.id))) return reply.code(404).send({ error: 'unknown_stop', message: 'No such TTC stop' });
        return await arrivalsAt(ttc, stops, req.params.id, lang);
      } catch (err) {
        return fail(req, reply, err);
      }
    },
  );

  app.get<{ Querystring: { q: string; limit?: number; locale?: Locale } }>(
    '/places',
    { schema: { querystring: { type: 'object', required: ['q'], properties: { q: { type: 'string', minLength: 2, maxLength: 100 }, limit, locale } } } },
    async (req, reply): Promise<PlacesResponse | undefined> => {
      try {
        return { places: await findPlaces(ttc, req.query.q, req.query.locale ?? 'en', req.query.limit ?? 5) };
      } catch (err) {
        return fail(req, reply, err);
      }
    },
  );
};

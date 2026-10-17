import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { STOP_ID_PATTERN, type Locale, type NearStopsResponse, type PlacesResponse, type StopLinesResponse, type StopsResponse } from '@transit/shared';
import { insideTbilisi } from '../geo.ts';
import { photonGeo, type StreetGeo } from '../ttc/photon.ts';
import { upstreamFailed } from '../ttc/client.ts';
import { arrivalsAt, findPlaces } from '../ttc/lookups.ts';
import type { TtcClient } from '../ttc/client.ts';
import type { StopIndex } from '../ttc/stops.ts';
import type { TtcSource } from '../journey/ttc-source.ts';
import { ShapeService } from '../journey/shapes.ts';

const locale = { type: 'string', enum: ['ka', 'en'] } as const;
const limit = { type: 'integer', minimum: 1, maximum: 20 } as const;

/**
 * Lookups for screens:
 *   GET /stops?q=         stop search by name (matches Georgian or English) or code, from the in-memory index
 *   GET /stops/near       closest stops to a point, from the in-memory index
 *   GET /stops/:id/arrivals  live countdown, one TTC call
 *   GET /stops/:id/lines  every line that stops here and the stops it visits next (the by-hand route builder)
 *   GET /places?q=        address/landmark search (TTC's OSM geocoder plus Photon for streets and house numbers)
 *   GET /places/reverse   the address at a point (Photon), for the map pin
 * Same data as the chat tools (ttc/lookups.ts). Names come back in English
 * unless ?locale=ka (TTC's data is bilingual; the app is English-only).
 */
export const registerStopRoutes = (app: FastifyInstance, deps: { ttc: TtcClient; stops: StopIndex; geo?: StreetGeo; source?: TtcSource }): void => {
  const { ttc, stops, geo = photonGeo, source } = deps;
  const shapes = new ShapeService(ttc, stops);
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

  /** The road shape of one ride (a line from stop A to stop B); `shape` is null when TTC has none, and the app draws a straight line. */
  app.get<{ Querystring: { from: string; to: string; route: string } }>(
    '/stops/shape',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['from', 'to', 'route'],
          properties: { from: { type: 'string', pattern: STOP_ID_PATTERN }, to: { type: 'string', pattern: STOP_ID_PATTERN }, route: { type: 'string', minLength: 1, maxLength: 16 } },
        },
      },
    },
    async (req, reply) => {
      try {
        return { shape: await shapes.shape(req.query.from, req.query.to, req.query.route) };
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
            limit: { type: 'integer', minimum: 1, maximum: 60 }, // the map shows every stop in view
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

  app.get<{ Querystring: { lat: number; lon: number } }>(
    '/places/reverse',
    { schema: { querystring: { type: 'object', required: ['lat', 'lon'], properties: { lat: { type: 'number' }, lon: { type: 'number' } } } } },
    async (req, reply) => {
      if (!insideTbilisi(req.query.lat, req.query.lon)) return reply.code(400).send({ error: 'bad_request', message: 'Point is outside Tbilisi' });
      return { place: await geo.reverse(req.query.lat, req.query.lon) };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/stops/:id/lines',
    { schema: { params: { type: 'object', properties: { id: { type: 'string', pattern: STOP_ID_PATTERN } } } } },
    async (req, reply): Promise<StopLinesResponse | undefined> => {
      if (!source) return reply.code(501).send({ error: 'not_available', message: 'Line lookup is off' });
      try {
        const stop = await stops.get(req.params.id, 'en');
        if (!stop) return reply.code(404).send({ error: 'unknown_stop', message: 'No such stop' });
        const patterns = await source.patternsAt(stop.id);
        return {
          stop: { id: stop.id, name: stop.name },
          lines: patterns
            .map((p) => ({
              shortName: p.shortName,
              color: p.color,
              minibus: p.minibus,
              mode: p.mode,
              headsign: p.headsign,
              next: p.stops.slice(p.stops.findIndex((s) => s.id === stop.id) + 1),
            }))
            .filter((l) => l.next.length)
            .sort((a, b) => a.shortName.localeCompare(b.shortName, 'en', { numeric: true })),
        };
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
        return { places: await findPlaces(ttc, req.query.q, req.query.locale ?? 'en', req.query.limit ?? 5, geo) };
      } catch (err) {
        return fail(req, reply, err);
      }
    },
  );
};

import { STOP_ID_PATTERN, type TripsPayload } from '@transit/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireKey } from '../auth.ts';
import type { TripStore } from './trips.ts';

const routeNumbers = { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 12 } } as const;
const stopIds = { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', pattern: STOP_ID_PATTERN } } as const;

const HHMM = '^([01]\\d|2[0-3]):[0-5]\\d$';

const tripsSchema = {
  type: 'object',
  required: ['trips'],
  additionalProperties: false,
  properties: {
    trips: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        required: ['id', 'fromStopId', 'toStopId', 'arriveBy', 'days', 'walkMin'],
        additionalProperties: false,
        properties: {
          id: { type: 'string', maxLength: 64 },
          fromStopId: { type: 'string', pattern: STOP_ID_PATTERN },
          toStopId: { type: 'string', pattern: STOP_ID_PATTERN },
          arriveBy: { type: 'string', pattern: HHMM },
          days: { type: 'array', minItems: 1, maxItems: 7, uniqueItems: true, items: { type: 'integer', minimum: 1, maximum: 7 } },
          walkMin: { type: 'integer', minimum: 0, maximum: 60 },
          // Lines the trip never uses, and a hand-built route (the rides in order).
          avoid: { type: 'object', additionalProperties: false, properties: { routes: routeNumbers, minibus: { type: 'boolean' } } },
          steps: {
            type: 'array',
            minItems: 1,
            maxItems: 6,
            items: { type: 'object', required: ['fromStops', 'toStops'], additionalProperties: false, properties: { fromStops: stopIds, toStops: stopIds, routes: routeNumbers } },
          },
        },
      },
    },
  },
} as const;

const headersSchema = {
  type: 'object',
  required: ['x-device-id'],
  // A random id the app generates once (≥ 128 bits). It's the only identity: no account.
  properties: { 'x-device-id': { type: 'string', minLength: 22, maxLength: 128 } },
} as const;

const device = (req: FastifyRequest): string => req.headers['x-device-id'] as string;

/**
 * The device's own data: GET/PUT trips, PUT push token, DELETE everything.
 * Bodies are never logged (request logging is off).
 */
export const registerMeRoutes = (app: FastifyInstance, store: TripStore): void => {
  const opts = { preHandler: requireKey, schema: { headers: headersSchema } };

  app.get('/me/trips', opts, async (req) => ({ trips: store.get(device(req)) }));

  app.put<{ Body: TripsPayload }>('/me/trips', { ...opts, schema: { ...opts.schema, body: tripsSchema } }, async (req) => {
    store.putTrips(device(req), req.body.trips);
    return { ok: true };
  });

  app.put<{ Body: { token: string } }>(
    '/me/push',
    {
      ...opts,
      schema: {
        ...opts.schema,
        body: {
          type: 'object',
          required: ['token'],
          properties: { token: { type: 'string', pattern: '^ExponentPushToken\\[.+\\]$', maxLength: 200 } },
        },
      },
    },
    async (req) => {
      store.putPushToken(device(req), req.body.token);
      return { ok: true };
    },
  );

  /** The delete-all button: removes trips and push token for this device. */
  app.delete('/me', opts, async (req) => {
    store.delete(device(req));
    return { ok: true };
  });
};

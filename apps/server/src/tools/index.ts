import type { ActionCard, Arrival, Locale } from '@transit/shared';
import { tbilisiLocalToIso } from '@transit/shared';
import * as z from 'zod/v4';
import { insideTbilisi } from '../geo.ts';
import type { PlanService } from '../plan/service.ts';
import type { TtcClient } from '../ttc/client.ts';
import type { StopIndex } from '../ttc/stops.ts';

/**
 * One set of tools, used by both the in-app chat agent and the MCP server
 * (request 0001). Each tool returns text for the model and, optionally, an
 * action card for the app. Numbers in cards come from TTC data, never from
 * the model.
 */
export interface ToolResult {
  text: string;
  card?: ActionCard;
}

export interface ToolDef<S extends z.ZodObject = z.ZodObject> {
  name: string;
  description: string;
  schema: S;
  /** Exposed on /mcp. Proposal tools are chat-only: they only make sense with a confirm card in the app. */
  mcp: boolean;
  run: (input: z.infer<S>) => Promise<ToolResult>;
}

export interface ToolDeps {
  ttc: TtcClient;
  stops: StopIndex;
  plans: PlanService;
  locale?: Locale;
}

const tool = <S extends z.ZodObject>(def: ToolDef<S>): ToolDef => def as unknown as ToolDef;

const latLon = z
  .object({ lat: z.number(), lon: z.number() })
  .refine((p) => insideTbilisi(p.lat, p.lon), 'must be inside Tbilisi (lat ≈ 41.7, lon ≈ 44.8)');
const place = z.object({ label: z.string(), lat: z.number(), lon: z.number() });
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:mm');

export const createTools = ({ ttc, stops, plans, locale = 'ka' }: ToolDeps): ToolDef[] => [
  tool({
    name: 'find_stop',
    description:
      'Find TTC public transport stops (bus, metro, gondola) in Tbilisi by name or stop code, in Georgian or English. Returns stop ids and coordinates.',
    schema: z.object({ query: z.string().min(1).describe('Stop name or code, e.g. "თავისუფლების მოედანი" or "Liberty Square"') }),
    mcp: true,
    run: async ({ query }) => {
      const hits = await stops.search(query);
      if (!hits.length) return { text: `No stops match "${query}".` };
      return {
        text: hits.map((s) => `${s.id} | ${s.name} | ${s.mode} | ${s.lat},${s.lon}`).join('\n'),
        card: { type: 'stops', stops: hits },
      };
    },
  }),

  tool({
    name: 'find_place',
    description:
      'Find a place or address in Tbilisi (OpenStreetMap data via TTC) and get its coordinates. Use for homes, offices, universities and landmarks that are not stops.',
    schema: z.object({ query: z.string().min(1) }),
    mcp: true,
    run: async ({ query }) => {
      const res = await ttc.geocode(query, locale);
      const rows = (res.features ?? []).slice(0, 5).flatMap((f) => {
        const c = f.geometry?.coordinates;
        if (!c) return [];
        const p = f.properties ?? {};
        const name = String(p.name ?? p.label ?? p.street ?? query);
        return [`${name} | ${c[1]},${c[0]}`];
      });
      return { text: rows.length ? rows.join('\n') : `No place matches "${query}".` };
    },
  }),

  tool({
    name: 'next_arrivals',
    description: 'Live arrival countdown at one TTC stop: which routes come next and in how many minutes.',
    schema: z.object({ stopId: z.string().regex(/^\d+:\d+$/, 'TTC stop id like "1:1405"') }),
    mcp: true,
    run: async ({ stopId }) => {
      const [stop, raw] = await Promise.all([stops.get(stopId), ttc.arrivalTimes(stopId, locale)]);
      const arrivals: Arrival[] = raw
        .map((a) => ({
          route: a.shortName,
          color: a.color ? `#${a.color.replace(/^#/, '')}` : null,
          headsign: a.headsign,
          minutes: a.realtime ? a.realtimeArrivalMinutes : a.scheduledArrivalMinutes,
          realtime: a.realtime,
        }))
        .filter((a) => a.minutes >= 0)
        .sort((a, b) => a.minutes - b.minutes);
      const name = stop?.name ?? stopId;
      return {
        text: arrivals.length
          ? arrivals.map((a) => `${a.route} → ${a.headsign}: ${a.minutes} min${a.realtime ? '' : ' (timetable)'}`).join('\n')
          : `No arrivals at ${name} right now.`,
        card: { type: 'arrivals', stop: { id: stopId, name }, arrivals },
      };
    },
  }),

  tool({
    name: 'plan_trip',
    description:
      'Plan a public transport trip in Tbilisi that arrives by a given time (TTC trip planner). Returns itineraries with routes, departure and arrival times.',
    schema: z.object({
      from: latLon,
      to: latLon,
      arriveBy: z.string().describe('Tbilisi local time, YYYY-MM-DDTHH:mm'),
    }),
    mcp: true,
    run: async ({ from, to, arriveBy }) => {
      if (!tbilisiLocalToIso(arriveBy)) return { text: 'arriveBy must be YYYY-MM-DDTHH:mm (Tbilisi time).' };
      const plan = await plans.plan({ from, to, arriveBy, locale });
      const hm = (iso: string) => new Date(Date.parse(iso) + 4 * 3600_000).toISOString().slice(11, 16);
      const text = plan.itineraries.length
        ? plan.itineraries
            .map((it) => {
              const rides = it.legs.filter((l) => l.route).map((l) => `${l.mode} ${l.route!.shortName}`).join(' + ');
              return `leave ${hm(it.departAt)}, arrive ${hm(it.arriveAt)} (Tbilisi), ${Math.round(it.durationSec / 60)} min: ${rides || 'walk'}`;
            })
            .join('\n')
        : 'No itineraries found.';
      return { text, card: { type: 'plan', plan } };
    },
  }),

  tool({
    name: 'propose_trip',
    description:
      'Propose a repeating trip for the user to save (e.g. home → work, arrive by 09:00). Nothing is saved until the user confirms the card in the app. Resolve both places to coordinates first.',
    schema: z.object({ name: z.string(), from: place, to: place, arriveBy: hhmm }),
    mcp: false,
    run: async (trip) => ({
      text: 'Shown to the user as a card to confirm. Not saved yet.',
      card: { type: 'confirm_trip', trip },
    }),
  }),

  tool({
    name: 'propose_events',
    description:
      'Propose recurring events read from a timetable, schedule photo, PDF or text (classes, work shifts). Nothing is saved until the user confirms the card. Copy times and places exactly as written; do not guess missing ones.',
    schema: z.object({
      events: z
        .array(
          z.object({
            title: z.string(),
            days: z.array(z.number().int().min(1).max(7)).min(1).describe('ISO weekdays, 1 = Monday'),
            start: hhmm,
            end: hhmm.nullable(),
            place: z.string().nullable(),
          }),
        )
        .min(1),
    }),
    mcp: false,
    run: async ({ events }) => ({
      text: `${events.length} events shown to the user to confirm. Not saved yet.`,
      card: { type: 'confirm_events', events },
    }),
  }),
];

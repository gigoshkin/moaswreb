import type { Arrival, ArrivalsResponse, Locale, PlaceHit } from '@transit/shared';
import type { TtcClient } from './client.ts';
import type { StopIndex } from './stops.ts';

/**
 * Lookups shared by the REST routes (stops/route.ts) and the chat/MCP tools,
 * so a screen and the chat always show the same numbers.
 */

/** Live countdown at one stop, soonest first; timetable minutes only when no live data. */
export async function arrivalsAt(ttc: TtcClient, stops: StopIndex, stopId: string, locale: Locale): Promise<ArrivalsResponse> {
  const [stop, raw] = await Promise.all([stops.get(stopId, locale), ttc.arrivalTimes(stopId, locale)]);
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
  return { stop: { id: stopId, name: stop?.name ?? stopId }, arrivals, fetchedAt: new Date().toISOString() };
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** OSM place search via TTC, limited to Tbilisi. */
export async function findPlaces(ttc: TtcClient, query: string, locale: Locale, limit = 5): Promise<PlaceHit[]> {
  const res = await ttc.geocode(query, locale);
  return (res.features ?? []).slice(0, limit).flatMap((f) => {
    const c = f.geometry?.coordinates;
    if (!c) return [];
    const p = f.properties ?? {};
    const street = str(p.street);
    const address = street ? [street, str(p.housenumber)].filter(Boolean).join(' ') : (str(p.district) ?? str(p.locality));
    return [{ name: str(p.name) ?? str(p.label) ?? street ?? query, address, lat: c[1], lon: c[0], kind: str(p.osm_value) }];
  });
}

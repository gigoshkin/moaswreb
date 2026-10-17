import type { Arrival, ArrivalsResponse, Locale, PlaceHit } from '@transit/shared';
import type { TtcClient } from './client.ts';
import { photonGeo, type StreetGeo } from './photon.ts';
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

const near = (a: PlaceHit, b: PlaceHit) => Math.abs(a.lat - b.lat) < 0.0004 && Math.abs(a.lon - b.lon) < 0.0004;

/**
 * Place search: TTC's OSM geocoder (landmarks) plus Photon (streets and house
 * numbers), TTC first, duplicates within ~40 m dropped. Tbilisi only.
 */
export async function findPlaces(ttc: TtcClient, query: string, locale: Locale, limit = 5, geo: StreetGeo = photonGeo): Promise<PlaceHit[]> {
  let ttcError: unknown = null;
  const [fromTtc, fromPhoton] = await Promise.all([
    ttc.geocode(query, locale).then(
      (res) => parseTtc(res, query),
      (err: unknown) => ((ttcError = err), [] as PlaceHit[]),
    ),
    geo.search(query, limit),
  ]);
  if (ttcError && !fromPhoton.length) throw ttcError;
  const out: PlaceHit[] = [];
  for (const p of [...fromTtc, ...fromPhoton]) if (!out.some((o) => near(o, p))) out.push(p);
  return out.slice(0, limit + 3);
}

const parseTtc = (res: Awaited<ReturnType<TtcClient['geocode']>>, query: string): PlaceHit[] =>
  (res.features ?? []).flatMap((f) => {
    const c = f.geometry?.coordinates;
    if (!c) return [];
    const p = f.properties ?? {};
    const street = str(p.street);
    const address = street ? [street, str(p.housenumber)].filter(Boolean).join(' ') : (str(p.district) ?? str(p.locality));
    return [{ name: str(p.name) ?? str(p.label) ?? street ?? query, address, lat: c[1], lon: c[0], kind: str(p.osm_value) }];
  });

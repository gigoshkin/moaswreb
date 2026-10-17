import type { Itinerary } from '@transit/shared';
import { decodePolyline } from '../lib/mapMath';
import { isMetro } from '../lib/plans';
import type { Place } from '../lib/trips';
import type { MapMarker, MapRoute } from './MapCanvas';
import { EndRing, RideBadge, StartDot } from './MapMarks';

/** Lines, markers and the points to frame, for the planned route (or just a line between the ends). */
export function overlay(from: Place | null, to: Place | null, it: Itinerary | null): { routes: MapRoute[]; markers: MapMarker[]; points: { lat: number; lon: number }[] } {
  const routes: MapRoute[] = [];
  const markers: MapMarker[] = [];
  const points: { lat: number; lon: number }[] = [];
  if (it) {
    for (const l of it.legs) {
      const pts = l.polyline ? decodePolyline(l.polyline) : [l.from, l.to];
      routes.push({ points: pts, walk: l.mode === 'WALK' });
      points.push(...pts);
      if (l.mode !== 'WALK') markers.push({ key: `ride-${markers.length}`, at: l.from, node: <RideBadge metro={isMetro(l)} /> });
    }
    const first = it.legs[0]?.from;
    const last = it.legs.at(-1)?.to;
    if (first) markers.push({ key: 'start', at: first, node: <StartDot /> });
    if (last) markers.push({ key: 'end', at: last, node: <EndRing /> });
  } else {
    if (from) {
      markers.push({ key: 'start', at: from, node: <StartDot /> });
      points.push(from);
    }
    if (to) {
      markers.push({ key: 'end', at: to, node: <EndRing /> });
      points.push(to);
    }
    if (from && to) routes.push({ points: [from, to], walk: true });
  }
  return { routes, markers, points };
}

import type { Itinerary, LatLon } from '@transit/shared';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { TILE, decodePolyline, normX, normY, tileUrl } from '../lib/mapMath';
import { isMetro } from '../lib/plans';
import { Icon } from './Icon';
import { Text } from './Text';
import { color } from './theme';

// A still map of one itinerary: Esri's muted "Light Gray Canvas" tiles (no
// API key, works in Expo Go and dev builds alike) with the route drawn on
// top. Not interactive; the timeline below carries the details. CARTO's
// light tiles were tried first: they now need a key (17 Oct 2026).

const MAX_Z = 16;

const worldX = (lon: number, z: number) => normX(lon) * TILE * 2 ** z;
const worldY = (lat: number, z: number) => normY(lat) * TILE * 2 ** z;

interface Props {
  /** A planned route; or, before there is one, just where it starts and ends. */
  itinerary?: Itinerary | null;
  endpoints?: { from: LatLon; to: LatLon } | null;
  height: number;
  /** Colour the map fades into at the bottom. */
  fadeTo?: string;
}

export function StaticMap({ itinerary, endpoints, height, fadeTo = color.bg }: Props) {
  const [width, setWidth] = useState(0);

  const legs = useMemo(
    () =>
      itinerary
        ? itinerary.legs.map((l) => ({
            walk: l.mode === 'WALK',
            points: l.polyline ? decodePolyline(l.polyline) : [l.from, l.to],
          }))
        : endpoints
          ? [{ walk: true, points: [endpoints.from, endpoints.to] }]
          : [],
    [itinerary, endpoints],
  );

  const view = useMemo(() => {
    if (!width) return null;
    const all = legs.flatMap((l) => l.points);
    if (!all.length) return null;
    const pad = 36;
    // Largest whole zoom that fits the route (whole zooms keep the tiles sharp).
    let z = MAX_Z;
    for (; z > 11; z--) {
      const xs = all.map((p) => worldX(p.lon, z));
      const ys = all.map((p) => worldY(p.lat, z));
      if (Math.max(...xs) - Math.min(...xs) <= width - pad * 2 && Math.max(...ys) - Math.min(...ys) <= height - pad * 2 - 24) break;
    }
    const xs = all.map((p) => worldX(p.lon, z));
    const ys = all.map((p) => worldY(p.lat, z));
    // Centre slightly above the middle so the bottom fade doesn't cover the end of the route.
    const ox = (Math.min(...xs) + Math.max(...xs)) / 2 - width / 2;
    const oy = (Math.min(...ys) + Math.max(...ys)) / 2 - height / 2 + 12;
    const tiles: { key: string; uri: string; left: number; top: number }[] = [];
    for (let tx = Math.floor(ox / TILE); tx * TILE < ox + width; tx++)
      for (let ty = Math.floor(oy / TILE); ty * TILE < oy + height; ty++)
        tiles.push({ key: `${z}/${tx}/${ty}`, uri: tileUrl(z, tx, ty), left: tx * TILE - ox, top: ty * TILE - oy });
    const project = (p: LatLon) => ({ x: worldX(p.lon, z) - ox, y: worldY(p.lat, z) - oy });
    return { tiles, project };
  }, [legs, width, height]);

  const firstRide = itinerary?.legs.find((l) => l.mode !== 'WALK');
  const start = itinerary ? itinerary.legs[0]?.from : endpoints?.from;
  const end = itinerary ? itinerary.legs.at(-1)?.to : endpoints?.to;

  return (
    <View style={[styles.map, { height }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {view && (
        <>
          {view.tiles.map((t) => (
            <Image key={t.key} source={{ uri: t.uri }} style={[styles.tile, { left: t.left, top: t.top }]} />
          ))}
          <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
            {legs.map((l, i) => (
              <Polyline
                key={i}
                points={l.points.map((p) => view.project(p)).map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke={color.ink}
                strokeWidth={l.walk ? 3 : 5}
                strokeDasharray={l.walk ? '1 7' : undefined}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {start && <Circle {...xy(view.project(start))} r={6} fill={color.ink} />}
            {end && <Circle {...xy(view.project(end))} r={6} fill={color.surface} stroke={color.ink} strokeWidth={3} />}
          </Svg>
          {firstRide && (
            <View style={[styles.vehicle, pos(view.project(firstRide.from))]}>
              <Icon name={isMetro(firstRide) ? 'metro' : 'bus'} size={18} color={color.onInk} />
            </View>
          )}
        </>
      )}
      <LinearGradient colors={[`${fadeTo}00`, fadeTo]} style={styles.fade} pointerEvents="none" />
      <Text variant="caption" color={color.textTertiary} style={styles.credit}>
        © Esri © OpenStreetMap
      </Text>
    </View>
  );
}

const xy = (p: { x: number; y: number }) => ({ cx: p.x, cy: p.y });
const VEHICLE = 36;
const pos = (p: { x: number; y: number }) => ({ left: p.x - VEHICLE / 2, top: p.y - VEHICLE / 2 });

const styles = StyleSheet.create({
  map: { width: '100%', overflow: 'hidden', backgroundColor: '#E8E8E8' },
  tile: { position: 'absolute', width: TILE, height: TILE },
  vehicle: {
    position: 'absolute',
    width: VEHICLE,
    height: VEHICLE,
    borderRadius: VEHICLE / 2,
    backgroundColor: color.ink,
    borderWidth: 3,
    borderColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 80 },
  credit: { position: 'absolute', right: 8, top: 6, fontSize: 9, lineHeight: 12 },
});

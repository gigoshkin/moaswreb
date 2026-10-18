import type { Arrival, ArrivalsResponse, NearStop } from '@transit/shared';
import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { fetchArrivals, hasApi, nearStops } from '../lib/api';
import { settings } from '../lib/settings';
import { distanceLabel } from '../lib/stops';
import type { Kind } from '../lib/plans';
import { RoutePlate } from './RoutePlate';
import { Tap } from './Tap';
import { Text } from './Text';
import { color, gutter, radius, shadow } from './theme';

type Where = { lat: number; lon: number; label: string };
interface Row {
  stop: NearStop;
  arrivals: Arrival[];
}

const kindOfStop = (mode: string): Kind => (mode === 'SUBWAY' ? 'metro' : 'bus');

/** "Near you": the closest stops with their next buses. Uses the phone's location if allowed, else Home. No new backend: /stops/near + /stops/:id/arrivals. */
export function NearbyStops() {
  const home = settings.use().home;
  const [where, setWhere] = useState<Where | null>(null);
  const [asked, setAsked] = useState(false); // location not granted yet
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);

  // Location without prompting; Home as the fallback.
  const locate = useCallback(
    async (prompt: boolean) => {
      try {
        let perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted && prompt) perm = await Location.requestForegroundPermissionsAsync();
        if (perm.granted) {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          setWhere({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: 'Near you' });
          setAsked(false);
          return;
        }
      } catch {
        /* fall through to Home */
      }
      setAsked(true);
      setWhere(home ? { lat: home.lat, lon: home.lon, label: 'Near Home' } : null);
    },
    [home],
  );
  useEffect(() => {
    if (hasApi) void locate(false);
  }, [locate]);

  useEffect(() => {
    if (!where) return;
    let alive = true;
    const load = async () => {
      try {
        const stops = await nearStops(where, { radiusM: 400, limit: 3 });
        const out = await Promise.all(
          stops.map(async (stop): Promise<Row> => {
            const r: ArrivalsResponse | null = await fetchArrivals(stop.id).catch(() => null);
            return { stop, arrivals: r?.arrivals.slice(0, 3) ?? [] };
          }),
        );
        if (alive) {
          setRows(out);
          setFailed(false);
        }
      } catch {
        if (alive) setFailed(true);
      }
    };
    void load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [where]);

  if (!hasApi) return null;

  return (
    <View style={styles.wrap}>
      <Text variant="label14" color={color.textSecondary} style={styles.label}>
        {where?.label ?? 'Near you'}
      </Text>
      <View style={styles.card}>
        {!where ? (
          <Tap onPress={() => void locate(true)} style={styles.ask} scaleTo={0.98}>
            <Text variant="name16">Show buses near me</Text>
            <Text variant="caption" color={color.textSecondary}>
              Uses your location only while the app is open. Or set Home in Settings.
            </Text>
          </Tap>
        ) : failed && !rows ? (
          <Text variant="body14" color={color.textSecondary} style={styles.pad}>
            Can't load nearby stops right now.
          </Text>
        ) : !rows ? (
          <View style={styles.pad}>
            <View style={styles.skeleton} />
            <View style={[styles.skeleton, { width: '60%' }]} />
          </View>
        ) : rows.length === 0 ? (
          <Text variant="body14" color={color.textSecondary} style={styles.pad}>
            No stops within 400 m.
          </Text>
        ) : (
          rows.map((r, i) => (
            <View key={r.stop.id} style={[styles.stop, i > 0 && styles.divider]}>
              <View style={styles.stopHead}>
                <Text variant="name16" numberOfLines={1} style={styles.flex}>
                  {r.stop.name}
                </Text>
                <Text variant="caption" color={color.textSecondary}>
                  {distanceLabel(r.stop.distanceM)}
                </Text>
              </View>
              {r.arrivals.length === 0 ? (
                <Text variant="caption" color={color.textTertiary}>
                  No buses soon
                </Text>
              ) : (
                r.arrivals.map((a, j) => (
                  <View key={`${a.route}-${j}`} style={styles.arr}>
                    <RoutePlate label={a.route} kind={kindOfStop(r.stop.mode)} />
                    <Text variant="body14" numberOfLines={1} style={styles.flex} color={color.textSecondary}>
                      {a.headsign}
                    </Text>
                    <Text variant="label14">{a.minutes <= 0 ? 'Now' : `${a.minutes} min`}</Text>
                  </View>
                ))
              )}
            </View>
          ))
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: 24 },
  label: { paddingHorizontal: gutter, paddingBottom: 8 },
  card: { marginHorizontal: gutter, backgroundColor: color.surface, borderRadius: radius.md, overflow: 'hidden', ...shadow.soft },
  pad: { padding: 16, gap: 8 },
  ask: { padding: 16, gap: 4 },
  skeleton: { height: 14, width: '90%', borderRadius: 8, backgroundColor: 'rgba(28,26,26,0.06)' },
  stop: { padding: 16, gap: 8 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: color.border },
  stopHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  arr: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
});

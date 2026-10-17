import type { JourneyStep, StopHit, StopLine } from '@transit/shared';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { nearStops, stopLines } from '../../lib/api';
import * as Haptics from 'expo-haptics';
import { finishSteps, stepsDraft } from '../../lib/handoff';
import { leaveAt, type Kind } from '../../lib/plans';
import { settings } from '../../lib/settings';
import { distanceLabel } from '../../lib/stops';
import { hhmm, nextArriveBy } from '../../lib/time';
import { useNow } from '../../lib/useNow';
import { useTripPlan } from '../../lib/useTripPlan';
import { slotsFor } from '../../lib/ways';
import { Button } from '../../ui/Button';
import { LineChain, Stack } from '../../ui/LineChain';
import { MapCanvas, type MapCanvasHandle, type MapMarker, type MapRoute } from '../../ui/MapCanvas';
import { EndRing, StopDot } from '../../ui/MapMarks';
import { RoutePlate, kindColor } from '../../ui/RoutePlate';
import { Busy } from '../../ui/Spinner';
import { Tap, haptic } from '../../ui/Tap';
import { Text } from '../../ui/Text';
import { MapButton } from '../../ui/kit';
import { overlay } from '../../ui/overlay';
import { color, gutter, radius, shadow, spring } from '../../ui/theme';

/** The pin is "on" a stop this close, measured on screen so it feels the same at every zoom: the stop grows, a tick, and a settle pulls it on. */
const SNAP_PT = 14;
/** Metres per screen point at an app zoom (Google zoom is that + 1, 256 points across the world at zoom 0). */
const metresPerPoint = (lat: number, zoom: number) => (40_075_017 * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** (zoom + 1));
/** A line within this of the pin counts as going there. */
const NEAR_M = 300;
const TBILISI = { lat: 41.7151, lon: 44.793 };
type Point = { lat: number; lon: number };
const distM = (a: Point, b: Point) => {
  const rad = Math.PI / 180;
  return Math.hypot((b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad), (b.lat - a.lat) * rad) * 6_371_000;
};
const kindOfLine = (l: StopLine): Kind => (l.mode === 'SUBWAY' ? 'metro' : l.minibus ? 'minibus' : 'bus');

/**
 * Pick the rides on the map, like TTC's own app: every stop is a dot you can
 * tap. Tap where you board, see the lines there drawn on the map (switch off
 * any you never want), tap where you get off, then add another ride or finish.
 * A ride keeps all the lines that fit; the planner compares them link by link
 * with live arrivals, like any other trip.
 */
export default function BuildRoute() {
  const insets = useSafeAreaInsets();
  const now = useNow(30_000);
  const [init] = useState(stepsDraft);
  const map = useRef<MapCanvasHandle>(null);
  const [steps, setSteps] = useState<JourneyStep[]>(init?.steps ?? []);
  const [sheetH, setSheetH] = useState(220);
  const [anchor, setAnchor] = useState<StopHit | null>(null);
  const [board, setBoard] = useState<StopHit | null>(null);
  const [off, setOff] = useState<string[]>([]);
  const [adding, setAdding] = useState(!init?.steps.length);
  const [centre, setCentre] = useState<Point | null>(null);
  // Where the end pin was dropped. Nothing is drawn until it is.
  const [placed, setPlaced] = useState<Point | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  const hotRef = useRef<string | null>(null);

  useEffect(() => () => finishSteps(null), []);

  const from = init?.from ?? { ...TBILISI, label: 'Start' };
  const to = init?.to ?? { ...TBILISI, label: 'End' };
  const trip = useMemo(
    () => (steps.length ? { id: 'draft', name: '', from, to, arriveBy: init?.arriveBy ?? '09:00', days: init?.days ?? [1, 2, 3, 4, 5], steps, avoid: init?.avoid } : null),
    [steps],
  );
  const date = nextArriveBy(init?.arriveBy ?? '09:00', init?.days ?? [1, 2, 3, 4, 5], now).slice(0, 10);
  const plan = useTripPlan(trip, date, now);
  const it = plan.choice.kind === 'none' ? (plan.itineraries[0] ?? null) : plan.choice.it;
  const rides = it ? it.legs.filter((l) => l.mode !== 'WALK') : [];
  const here: Point = anchor ?? (rides.length ? rides.at(-1)!.to : from);

  // Stops around the middle of the map, loaded as the map settles.
  const nearby = useStopsNear(adding ? (centre ?? here) : null);
  // Lines at the boarding stop (get-off step).
  const { lines, error: linesError } = useLines(board?.id ?? null);
  const onLines = useMemo(() => (lines ?? []).filter((l) => !off.includes(l.shortName)), [lines, off]);

  // Where the end pin was dropped: the lines that get closest to it. Lines that come within
  // NEAR_M of it go there; if none do there is no direct line, and the closest stop is offered on the side.
  const match = useMemo(() => {
    if (!board || !placed) return null;
    const per = onLines
      .map((l) => {
        const best = l.next.map((s) => ({ s, d: distM(s, placed) })).sort((a, b) => a.d - b.d)[0];
        return best ? { line: l, stop: best.s, d: best.d, upto: l.next.slice(0, l.next.findIndex((x) => x.id === best.s.id) + 1) } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => a.d - b.d);
    if (!per.length) return null;
    const direct = per.filter((x) => x.d <= NEAR_M);
    return { direct, closest: per.filter((x) => x.stop.id === per[0].stop.id), d: per[0].d };
  }, [board, placed, onLines]);

  const pickBoard = (s: StopHit) => {
    haptic('selection');
    setBoard(s);
    setOff([]);
    setPlaced(null);
    map.current?.flyTo(to, 15.5); // the pin starts at the end of the trip
  };
  const clearBoard = () => {
    setBoard(null);
    setOff([]);
    setPlaced(null);
  };
  const confirmRide = (used: NonNullable<typeof match>['direct']) => {
    if (!board || !used.length) return;
    haptic('success');
    const stopIds = [...new Set(used.map((x) => x.stop.id))];
    const names = [...new Set(used.map((x) => x.line.shortName))];
    setSteps((s) => [...s, { fromStops: [board.id], toStops: stopIds, ...(off.length ? { routes: names } : {}) }]);
    setAnchor({ id: used[0].stop.id, name: used[0].stop.name, lat: used[0].stop.lat, lon: used[0].stop.lon, mode: used[0].line.mode });
    clearBoard();
    setAdding(false);
  };

  const planned = useMemo(() => overlay(from, to, it), [it]);

  // What the map shows depends on the step: stops to board at, the lines and stops to get off at, or the planned route.
  const { routes, markers, points } = useMemo(() => {
    if (adding && !board) {
      const mk: MapMarker[] = nearby.stops.map((s) => ({ key: s.id, at: s, node: <StopDot big={hot === s.id} />, onPress: () => pickBoard(s) }));
      return { routes: planned.routes, markers: mk, points: [] as Point[] };
    }
    if (adding && board) {
      // Only the lines that go where the pin is, from the boarding stop to the stop they get off at; other stops stay tappable to move the pin.
      const mk: MapMarker[] = nearby.stops
        .filter((s) => s.id !== board.id)
        .map((s) => ({ key: s.id, at: s, node: <StopDot big={hot === s.id} />, onPress: () => map.current?.flyTo(s, 17) }));
      mk.push({ key: 'board', at: board, node: <StopDot on tint={color.ink} /> });
      // Lines are drawn only once the end pin is dropped, and only when one goes there.
      const used = match?.direct ?? [];
      if (placed) mk.push({ key: 'end-pin', at: placed, node: <EndRing /> });
      for (const x of used) if (!mk.some((m) => m.key === `off-${x.stop.id}`)) mk.push({ key: `off-${x.stop.id}`, at: x.stop, node: <StopDot on tint={kindColor[kindOfLine(x.line)]} /> });
      const rt: MapRoute[] = used.map((x) => ({ points: [board, ...x.upto], color: kindColor[kindOfLine(x.line)] }));
      return { routes: rt, markers: mk, points: [board, to] as Point[] };
    }
    return { routes: planned.routes, markers: planned.markers, points: planned.points };
  }, [adding, board, nearby.stops, match, planned, hot, placed]);

  // Frame the map when the step changes (not on the first frame: the map starts framed).
  const fitKey = `${adding}|${board ? 1 : 0}|${it?.id ?? ''}`;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (adding && board) return; // pickBoard already moved the map to the trip's end
    if (points.length) map.current?.fit(points);
    else if (adding) map.current?.flyTo(here, 15.5);
  }, [fitKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const nearest = useMemo(() => {
    const c = centre ?? here;
    return nearby.stops.map((s) => ({ s, d: distM(c, s) })).sort((a, b) => a.d - b.d)[0] ?? null;
  }, [nearby.stops, centre, here.lat, here.lon]);

  // The stop under the pin (within SNAP_PT on screen) grows and ticks; settling beside one pulls the pin on.
  const nearbyRef = useRef(nearby.stops);
  nearbyRef.current = nearby.stops;
  const snapped = useRef<string | null>(null); // one pull per stop, so it can never loop
  const stopAt = (c: Point, zoom: number) => {
    const reach = SNAP_PT * metresPerPoint(c.lat, zoom);
    let best: { s: StopHit; d: number } | null = null;
    for (const s of nearbyRef.current) {
      if (s.id === board?.id) continue;
      const d = distM(c, s);
      if (d <= reach && (!best || d < best.d)) best = { s, d };
    }
    return best ? { ...best, pt: best.d / metresPerPoint(c.lat, zoom) } : null;
  };
  const mark = (id: string | null) => {
    if (id === hotRef.current) return;
    hotRef.current = id;
    setHot(id);
    if (id) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };
  const onMove = (c: Point, zoom: number) => {
    if (adding) mark(stopAt(c, zoom)?.s.id ?? null);
  };
  const onIdle = (c: Point, zoom: number) => {
    const b = adding ? stopAt(c, zoom) : null;
    mark(b?.s.id ?? null);
    if (b && b.pt > 1.5 && b.s.id !== snapped.current) {
      snapped.current = b.s.id;
      map.current?.flyTo(b.s, zoom); // eases the pin onto the stop; the next idle reports the stop itself
      return;
    }
    if (!b) snapped.current = null;
    setCentre(c);
  };

  const done = () => {
    haptic('success');
    finishSteps(steps.length ? steps : null);
    router.back();
  };

  const start = it ? { fit: planned.points } : { center: here, zoom: 15.5 };

  return (
    <View style={styles.screen}>
      <MapCanvas
        ref={map}
        style={StyleSheet.absoluteFill}
        start={start}
        routes={routes}
        markers={markers}
        pin={adding && !(board && placed)}
        onMove={onMove}
        onIdle={onIdle}
        inset={{ top: insets.top + 64, bottom: sheetH }}
      />
      <View style={[styles.floating, { top: insets.top + 12 }]} pointerEvents="box-none">
        <MapButton icon="back" label="Back" onPress={() => router.back()} />
      </View>

      <Animated.View
        entering={FadeInDown.springify().damping(spring.sheet.damping).stiffness(spring.sheet.stiffness)}
        layout={LinearTransition.duration(240)}
        style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}
        onLayout={(e) => setSheetH(e.nativeEvent.layout.height)}
      >
        {adding && !board && (
          <View style={styles.gap}>
            <View style={styles.titleRow}>
              <Text variant="title18" style={styles.flex}>
                {steps.length ? 'Where do you board next?' : 'Where do you board?'}
              </Text>
              {steps.length > 0 && (
                <Tap onPress={() => setAdding(false)} hitSlop={8}>
                  <Text variant="label14" color={color.textSecondary}>
                    Cancel
                  </Text>
                </Tap>
              )}
            </View>
            <Text variant="body14" color={color.textSecondary}>
              Tap a stop on the map, or move the map so the pin is by the stop.
            </Text>
            {nearby.loading && !nearby.stops.length ? (
              <Busy label="Loading stops…" />
            ) : nearest ? (
              <Button label={`Use ${nearest.s.name} · ${distanceLabel(nearest.d)}`} kind="secondary" onPress={() => pickBoard(nearest.s)} haptic="none" />
            ) : (
              <Text variant="body14" color={color.textSecondary}>
                {nearby.error ? "Can't load stops right now." : 'No stops here. Move the map.'}
              </Text>
            )}
          </View>
        )}

        {adding && board && (
          <View style={styles.gap}>
            <View style={styles.titleRow}>
              <Text variant="title18" style={styles.flex} numberOfLines={1}>
                {board.name}
              </Text>
              <Tap onPress={clearBoard} hitSlop={8}>
                <Text variant="label14" color={color.textSecondary}>
                  Change stop
                </Text>
              </Tap>
            </View>
            {!lines && !linesError && <Busy label="Loading the lines at this stop…" />}
            {linesError && (
              <Text variant="body14" color={color.textSecondary}>
                Can't load the lines for this stop right now.
              </Text>
            )}
            {lines && (
              <>
                <Text variant="caption" color={color.textSecondary}>
                  Lines at this stop. Tap one to leave it out.
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.plates}>
                  {[...new Map(lines.map((l) => [l.shortName, l])).values()].map((l) => (
                    <Tap
                      key={l.shortName}
                      onPress={() => {
                        setOff((o) => (o.includes(l.shortName) ? o.filter((x) => x !== l.shortName) : [...o, l.shortName]));
                      }}
                      haptic="selection"
                      style={off.includes(l.shortName) ? styles.off : undefined}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: !off.includes(l.shortName) }}
                      accessibilityLabel={`Line ${l.shortName}`}
                    >
                      <RoutePlate label={l.shortName} kind={kindOfLine(l)} size="md" />
                    </Tap>
                  ))}
                </ScrollView>
                {!placed ? (
                  <View style={styles.gap}>
                    <Text variant="body14">{onLines.length ? 'Move the map so the pin is where you get off, then drop it.' : 'Every line is switched off.'}</Text>
                    <Button label="Drop end pin here" kind="secondary" onPress={() => { haptic('selection'); setPlaced(centre ?? to); }} disabled={!onLines.length || !centre} haptic="none" />
                  </View>
                ) : match?.direct.length ? (
                  <Animated.View entering={FadeIn.duration(160)} style={styles.gap}>
                    <View style={styles.destRow}>
                      <Stack slot={[...new Map(match.direct.map((x) => [x.line.shortName, { label: x.line.shortName, kind: kindOfLine(x.line) }])).values()]} />
                      <Text variant="label16" style={styles.flex} numberOfLines={1}>
                        {match.direct[0].stop.name}
                      </Text>
                    </View>
                    <Button label="Add this ride" onPress={() => confirmRide(match.direct)} haptic="none" />
                    <Tap onPress={() => setPlaced(null)} hitSlop={8} style={styles.moveLink}>
                      <Text variant="label14" color={color.textSecondary}>
                        Move the end pin
                      </Text>
                    </Tap>
                  </Animated.View>
                ) : (
                  <Animated.View entering={FadeIn.duration(160)} style={styles.gap}>
                    <Text variant="label16">No direct line goes there</Text>
                    {match && (
                      <Text variant="caption" color={color.textSecondary}>
                        The closest any line gets is {match.closest[0].stop.name}, {distanceLabel(match.d)} from the pin.
                      </Text>
                    )}
                    {match && <Button label="Ride to that stop instead" kind="secondary" onPress={() => confirmRide(match.closest)} haptic="none" />}
                    <Tap onPress={() => setPlaced(null)} hitSlop={8} style={styles.moveLink}>
                      <Text variant="label14" color={color.textSecondary}>
                        Move the end pin
                      </Text>
                    </Tap>
                  </Animated.View>
                )}
              </>
            )}
          </View>
        )}

        {!adding && (
          <View style={styles.gap}>
            <Text variant="title18">Your route</Text>
            {it ? (
              <View style={styles.gap}>
                <LineChain slots={slotsFor(it, plan.itineraries)} />
                {rides.map((l, i) => (
                  <Text key={i} variant="body14" numberOfLines={1}>
                    {l.from.name} → {l.to.name}
                  </Text>
                ))}
                <Text variant="caption" color={color.textSecondary}>
                  Leave around {hhmm(leaveAt(it, settings.get().bufferMin))} · arrive {hhmm(it.arriveAt)}
                </Text>
              </View>
            ) : plan.error ? (
              <Text variant="body14" color={color.textSecondary}>
                Can't reach the planner right now.
              </Text>
            ) : plan.loaded && !plan.refreshing ? (
              <Text variant="body14" color={color.textSecondary}>
                No ride fits these stops at that time.
              </Text>
            ) : (
              <Busy label="Checking every line…" />
            )}
            {it && (plan.refreshing || !plan.loaded) && <Busy label="Checking every line…" />}
            <View style={styles.actions}>
              <Button label="Add another ride" kind="secondary" onPress={() => setAdding(true)} haptic="none" />
              {steps.length > 0 && (
                <Button
                  label="Remove last ride"
                  kind="secondary"
                  onPress={() => {
                    setSteps((s) => s.slice(0, -1));
                    setAnchor(null);
                  }}
                  haptic="none"
                />
              )}
              <Button label="Done" onPress={done} disabled={!steps.length} haptic="none" />
            </View>
          </View>
        )}
      </Animated.View>
    </View>
  );
}

/** Stops around a point, refreshed (debounced) as the point moves. Null point loads nothing. */
function useStopsNear(p: Point | null) {
  const [stops, setStops] = useState<StopHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const seen = useRef(new Map<string, StopHit>());
  const key = p ? `${p.lat.toFixed(4)},${p.lon.toFixed(4)}` : '';
  useEffect(() => {
    if (!p) return;
    let live = true;
    setLoading(true);
    const t = setTimeout(() => {
      // An API server from before the limit was raised answers 400 to 60: ask for 20 then.
      nearStops(p, { radiusM: 500, limit: 60 }).catch(() => nearStops(p, { radiusM: 400, limit: 20 })).then(
        (r) => {
          if (!live) return;
          // Stops already seen stay, so the dots don't flicker while panning.
          for (const s of r) seen.current.set(s.id, s);
          setStops(r.length ? [...seen.current.values()].filter((s) => distM(p, s) < 900) : []);
          setError(false);
          setLoading(false);
        },
        () => live && (setError(true), setLoading(false)),
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { stops, loading, error };
}

/** Every line at a stop and where it goes next. */
function useLines(stopId: string | null) {
  const [state, setState] = useState<{ id: string; lines: StopLine[] | null; error: boolean } | null>(null);
  useEffect(() => {
    if (!stopId) return;
    let live = true;
    stopLines(stopId).then(
      (r) => live && setState({ id: stopId, lines: r.lines, error: false }),
      () => live && setState({ id: stopId, lines: null, error: true }),
    );
    return () => {
      live = false;
    };
  }, [stopId]);
  const mine = state && state.id === stopId ? state : null;
  return { lines: mine?.lines ?? null, error: mine?.error ?? false };
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  floating: { position: 'absolute', left: 12 },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '55%', backgroundColor: color.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: gutter, paddingTop: 16, ...shadow.bar },
  gap: { gap: 10, flexShrink: 1 },
  flex: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  plates: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  off: { opacity: 0.3 },
  moveLink: { alignSelf: 'center', paddingVertical: 4 },
  destRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actions: { gap: 8, paddingTop: 4 },
});

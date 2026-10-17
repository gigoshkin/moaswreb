import type { JourneyStep, StopHit, StopLine } from '@transit/shared';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
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
import { Icon } from '../../ui/Icon';
import { LineChain, Stack } from '../../ui/LineChain';
import { MapCanvas, type MapCanvasHandle, type MapMarker, type MapRoute } from '../../ui/MapCanvas';
import { EndRing, StopDot } from '../../ui/MapMarks';
import { kindColor } from '../../ui/RoutePlate';
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
const TBILISI = { lat: 41.7151, lon: 44.793 };
type Point = { lat: number; lon: number };
const distM = (a: Point, b: Point) => {
  const rad = Math.PI / 180;
  return Math.hypot((b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad), (b.lat - a.lat) * rad) * 6_371_000;
};
const kindOfLine = (l: StopLine): Kind => (l.mode === 'SUBWAY' ? 'metro' : l.minibus ? 'minibus' : 'bus');

/**
 * Pick the rides on the map, like TTC's own app: every stop is a dot you can
 * tap. Tap where you board and every line from there is drawn on the map in
 * black. Drop the end pin on a stop they reach; the lines that go there are
 * shown in their colours. Then add another ride or finish.
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
  // The rides built so far, as the rail shows them (stops with names).
  const [rides, setRides] = useState<Ride[]>([]);
  const [board, setBoard] = useState<StopHit | null>(null);
  const [adding, setAdding] = useState(!init?.steps.length);
  const [centre, setCentre] = useState<Point | null>(null);
  // The stop the end pin was dropped on (only stops the lines reach can take it).
  const [placed, setPlaced] = useState<StopHit | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  const hotRef = useRef<string | null>(null);

  useEffect(() => () => finishSteps(null), []);

  const from = init?.from ?? { ...TBILISI, label: 'Start' };
  const to = init?.to ?? { ...TBILISI, label: 'End' };
  // The preview plans only the rides built so far, from the first boarding stop to the last stop: the walk home
  // and the walk to the destination are not part of it, and a metro-only ride would otherwise fail on a long walk.
  const ends = rides.length ? { from: { ...rides[0].board, label: rides[0].board.name }, to: { ...rides[rides.length - 1].off, label: rides[rides.length - 1].off.name } } : { from, to };
  const trip = useMemo(
    () => (steps.length ? { id: 'draft', name: '', from: ends.from, to: ends.to, arriveBy: init?.arriveBy ?? '09:00', days: init?.days ?? [1, 2, 3, 4, 5], steps, avoid: init?.avoid } : null),
    [steps, rides],
  );
  const date = nextArriveBy(init?.arriveBy ?? '09:00', init?.days ?? [1, 2, 3, 4, 5], now).slice(0, 10);
  const plan = useTripPlan(trip, date, now);
  const it = plan.choice.kind === 'none' ? (plan.itineraries[0] ?? null) : plan.choice.it;
  const legs = it ? it.legs.filter((l) => l.mode !== 'WALK') : [];
  const here: Point = anchor ?? (rides.length ? rides[rides.length - 1].off : from);

  // Steps that came in from the route screen: name their stops from the planned legs.
  useEffect(() => {
    if (rides.length || !steps.length || legs.length !== steps.length) return;
    if (legs.some((l) => !l.from.stopId || !l.to.stopId)) return;
    setRides(legs.map((l) => ({ board: { id: l.from.stopId!, name: l.from.name, lat: l.from.lat, lon: l.from.lon, mode: l.mode }, off: { id: l.to.stopId!, name: l.to.name, lat: l.to.lat, lon: l.to.lon, mode: l.mode } })));
  }, [it?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stops around the middle of the map, loaded as the map settles.
  const nearby = useStopsNear(adding ? (centre ?? here) : null);
  // Lines at the boarding stop (get-off step).
  const { lines, error: linesError } = useLines(board?.id ?? null);
  const onLines = lines ?? [];

  // Stops any line from the boarding stop reaches: the only places the end pin can go.
  const reachable = useMemo(() => {
    const m = new Map<string, StopHit>();
    for (const l of onLines) for (const s of l.next) if (s.id !== board?.id && !m.has(s.id)) m.set(s.id, { id: s.id, name: s.name, lat: s.lat, lon: s.lon, mode: l.mode });
    return [...m.values()];
  }, [onLines, board?.id]);
  // The lines that reach the dropped stop, each up to it.
  const match = useMemo(() => {
    if (!placed) return null;
    const used = onLines.flatMap((l) => {
      const i = l.next.findIndex((x) => x.id === placed.id);
      return i < 0 ? [] : [{ line: l, stop: placed, upto: l.next.slice(0, i + 1) }];
    });
    return used.length ? used : null;
  }, [placed, onLines]);

  const pickBoard = (s: StopHit) => {
    haptic('selection');
    setBoard(s);
    setPlaced(null);
    map.current?.flyTo(to, 15.5); // the pin starts at the end of the trip
  };
  const clearBoard = () => {
    setBoard(null);
    setPlaced(null);
  };
  const confirmRide = (used: NonNullable<typeof match>) => {
    if (!board) return;
    haptic('success');
    const stop = used[0].stop;
    setSteps((s) => [...s, { fromStops: [board.id], toStops: [stop.id] }]);
    setRides((r) => [...r, { board, off: stop }]);
    setAnchor(stop);
    // The next ride starts where this one ended; a metro station next to the stop means a short walk first.
    setBoard(stop);
    setPlaced(null);
    map.current?.flyTo(to, 15.5);
    if (stop.mode !== 'SUBWAY') {
      nearStops(stop, { radiusM: 250, limit: 3, mode: 'SUBWAY' }).then(
        (r) => {
          const metro = r.find((x) => x.id !== stop.id);
          if (metro) setBoard((b) => (b?.id === stop.id ? metro : b));
        },
        () => {},
      );
    }
  };
  /** Drop a ride and everything after it (each ride starts where the one before ended). */
  const removeFrom = (i: number) => {
    haptic('selection');
    setSteps((s) => s.slice(0, i));
    setRides((r) => r.slice(0, i));
    setAnchor(null);
    clearBoard();
    setAdding(i === 0);
  };

  const planned = useMemo(() => overlay(from, to, it), [it]);

  // The middle of the map to ~300 m, so the set of stop dots only changes when you have really moved.
  const mid = centre ?? to;
  const cellKey = `${(Math.round(mid.lat / 0.003) * 0.003).toFixed(4)},${(Math.round(mid.lon / 0.003) * 0.003).toFixed(4)}`;

  // What the map shows depends on the step: stops to board at, the lines and stops to get off at, or the planned route.
  const { routes, markers, points } = useMemo(() => {
    if (adding && !board) {
      const mk: MapMarker[] = nearby.stops.map((s) => ({ key: s.id, at: s, node: <StopDot big={hot === s.id} />, sig: hot === s.id ? 'big' : '', onPress: () => pickBoard(s) }));
      return { routes: planned.routes, markers: mk, points: [] as Point[] };
    }
    if (adding && board) {
      // Every line from here in the app's black, so you see where you can get to; the end pin only lands on a stop they reach.
      // Once it is dropped, just the lines that go there, in their colours.
      const mk: MapMarker[] = [];
      mk.push({ key: 'board', at: board, node: <StopDot on tint={color.ink} /> });
      if (placed) {
        mk.push({ key: 'end-pin', at: placed, node: <EndRing /> });
        const rt: MapRoute[] = (match ?? []).map((x) => ({ points: [board, ...x.upto], color: kindColor[kindOfLine(x.line)] }));
        return { routes: rt, markers: mk, points: [board, placed] as Point[] };
      }
      const c = { lat: Number(cellKey.split(',')[0]), lon: Number(cellKey.split(',')[1]) };
      const shown = [...reachable].sort((a, b) => distM(a, c) - distM(b, c)).slice(0, 70);
      for (const s of shown) mk.push({ key: s.id, at: s, node: <StopDot big={hot === s.id} />, sig: hot === s.id ? 'big' : '', onPress: () => map.current?.flyTo(s, 17) });
      const rt: MapRoute[] = onLines.map((l) => ({ points: [board, ...l.next] }));
      return { routes: rt, markers: mk, points: [board, to] as Point[] };
    }
    return { routes: planned.routes, markers: planned.markers, points: planned.points };
  }, [adding, board, nearby.stops, reachable, onLines, match, planned, hot, placed, cellKey]);

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
  // Before a boarding stop it is the stops around; after, only the ones the lines reach.
  const nearbyRef = useRef(nearby.stops);
  nearbyRef.current = board ? reachable : nearby.stops;
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
        {rides.length > 0 && <Rail rides={rides} onRemove={removeFrom} />}

        {adding && (
          <View style={styles.gap}>
            <View style={styles.pair}>
              <Tap onPress={board ? clearBoard : undefined} feedback="tint" style={styles.half} accessibilityRole="button" accessibilityLabel={board ? `Boarding at ${board.name}. Change` : 'Choose boarding stop'}>
                <View style={styles.dot} />
                <Text variant="label14" numberOfLines={1} color={board ? color.text : color.textSecondary} style={styles.flex}>
                  {board ? board.name : 'Boarding stop'}
                </Text>
              </Tap>
              <Icon name="chevron-right" size={18} color={color.textTertiary} />
              <View style={styles.half}>
                <Icon name="pin" size={16} color={placed ? color.ink : color.textTertiary} />
                <Text variant="label14" numberOfLines={1} color={placed ? color.text : color.textSecondary} style={styles.flex}>
                  {placed ? placed.name : 'Get off'}
                </Text>
              </View>
            </View>

            {!board ? (
              <>
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
              </>
            ) : !lines && !linesError ? (
              <Busy label="Loading the lines at this stop…" />
            ) : linesError ? (
              <Text variant="body14" color={color.textSecondary}>
                Can't load the lines for this stop right now.
              </Text>
            ) : !placed ? (
              <>
                {rides.length > 0 && distM(board, rides[rides.length - 1].off) > 30 && (
                  <Text variant="caption" color={color.textSecondary}>
                    Walk {distanceLabel(distM(board, rides[rides.length - 1].off))} to {board.name}.
                  </Text>
                )}
                <Text variant="body14">Every line from here is on the map. Move the pin onto a stop where you get off.</Text>
                <Button
                  label={hot ? 'Get off here' : 'Move the pin onto a stop'}
                  kind="secondary"
                  onPress={() => {
                    const stop = reachable.find((x) => x.id === hot);
                    if (stop) {
                      haptic('selection');
                      setPlaced(stop);
                    }
                  }}
                  disabled={!hot || !reachable.some((x) => x.id === hot)}
                  haptic="none"
                />
              </>
            ) : match ? (
              <Animated.View entering={FadeIn.duration(160)} style={styles.gap}>
                <View style={styles.destRow}>
                  <Stack slot={[...new Map(match.map((x) => [x.line.shortName, { label: x.line.shortName, kind: kindOfLine(x.line) }])).values()]} />
                  <Text variant="caption" color={color.textSecondary} style={styles.flex}>
                    gets you there
                  </Text>
                </View>
                <Button label="Add this ride" icon="plus" onPress={() => confirmRide(match)} haptic="none" />
                <Tap onPress={() => setPlaced(null)} hitSlop={8} style={styles.moveLink}>
                  <Text variant="label14" color={color.textSecondary}>
                    Move the end pin
                  </Text>
                </Tap>
              </Animated.View>
            ) : null}
            {rides.length > 0 && (
              <Tap onPress={() => { clearBoard(); setAdding(false); }} hitSlop={8} style={styles.moveLink}>
                <Text variant="label14" color={color.textSecondary}>
                  Stop adding rides
                </Text>
              </Tap>
            )}
          </View>
        )}

        {!adding && (
          <View style={styles.gap}>
            {it ? (
              <View style={styles.gap}>
                <LineChain slots={slotsFor(it, plan.itineraries)} />
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
              <Button label="Add another ride" icon="plus" kind="secondary" onPress={() => { setAdding(true); setBoard(rides.length ? rides[rides.length - 1].off : null); }} haptic="none" />
              <Button label="Done" onPress={done} disabled={!steps.length} haptic="none" />
            </View>
          </View>
        )}
      </Animated.View>
    </View>
  );
}

interface Ride {
  board: StopHit;
  off: StopHit;
}

/** The rides so far as a rail: a dot per stop, the ride between, a walk where the next ride starts elsewhere. */
function Rail({ rides, onRemove }: { rides: Ride[]; onRemove: (i: number) => void }) {
  return (
    <View style={styles.rail}>
      {rides.map((r, i) => {
        const prev = rides[i - 1];
        const walk = prev ? distM(prev.off, r.board) : 0;
        const kind: Kind = r.board.mode === 'SUBWAY' ? 'metro' : 'bus';
        return (
          <View key={`${r.board.id}-${i}`}>
            {walk > 30 && (
              <View style={styles.railRow}>
                <View style={styles.railTrack}>
                  <View style={styles.railDash} />
                </View>
                <Text variant="caption" color={color.textSecondary}>
                  Walk {distanceLabel(walk)}
                </Text>
              </View>
            )}
            <View style={styles.railRow}>
              <View style={styles.railTrack}>
                <View style={[styles.railBar, { backgroundColor: kindColor[kind] }]} />
              </View>
              <Text variant="label14" style={styles.flex} numberOfLines={1}>
                {r.board.name} → {r.off.name}
              </Text>
              <Tap onPress={() => onRemove(i)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ride ${i + 1} and the ones after it`}>
                <Icon name="close" size={16} color={color.textSecondary} />
              </Tap>
            </View>
          </View>
        );
      })}
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
  rail: { gap: 2, paddingBottom: 8 },
  railRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 28 },
  railTrack: { width: 14, alignItems: 'center', alignSelf: 'stretch', justifyContent: 'center' },
  railBar: { width: 5, flex: 1, borderRadius: 3, marginVertical: 2 },
  railDash: { width: 2, flex: 1, borderRadius: 1, backgroundColor: color.border },
  pair: { flexDirection: 'row', alignItems: 'center', backgroundColor: color.surfaceMuted, borderRadius: radius.md, height: 52, paddingHorizontal: 6 },
  half: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, height: 52 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: color.ink },
  screen: { flex: 1, backgroundColor: color.bg },
  floating: { position: 'absolute', left: 12 },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '55%', backgroundColor: color.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: gutter, paddingTop: 16, ...shadow.bar },
  gap: { gap: 10, flexShrink: 1 },
  flex: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  moveLink: { alignSelf: 'center', paddingVertical: 4 },
  destRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actions: { gap: 8, paddingTop: 4 },
});

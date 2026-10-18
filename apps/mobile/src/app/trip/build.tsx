import type { JourneyStep, StopHit, StopLine } from '@transit/shared';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { hasApi, nearStops, reversePlace, stopLines } from '../../lib/api';
import * as Haptics from 'expo-haptics';
import { finishSteps, stepsDraft } from '../../lib/handoff';
import { FAR_WALK_M, UNDO_DEPTH, distM, gapBefore, place, removeAt, rideFromStep, stepOf, toggleLine, walkMinutes, type BuiltRide } from '../../lib/chain';
import { kindOf, leaveAt, type Kind } from '../../lib/plans';
import { locateMe } from '../../lib/locate';
import { nameOfPlace, pinName } from '../../lib/nameOfPlace';
import { DROPPED_PIN, isDropped } from '../../lib/placeNames';
import { useNamedPlace } from '../../lib/useNamedPlace';
import { settings } from '../../lib/settings';
import type { Place } from '../../lib/trips';
import { distanceLabel } from '../../lib/stops';
import { hhmm, nextArriveBy } from '../../lib/time';
import { decodePolyline } from '../../lib/mapMath';
import { useNow } from '../../lib/useNow';
import { useRideShapes, useRoadItinerary } from '../../lib/shapes';
import { useTripPlan } from '../../lib/useTripPlan';
import { slotsFor } from '../../lib/ways';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { LineChain, Stack, type LineRef } from '../../ui/LineChain';
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
const TBILISI = { lat: 41.7151, lon: 44.793 };
type Point = { lat: number; lon: number };
const kindOfLine = (l: StopLine): Kind => (l.mode === 'SUBWAY' ? 'metro' : l.minibus ? 'minibus' : 'bus');

/** The sheet sits at a fixed height over the map while rides are picked, so the map doesn't jump at each step. */
const PICK_INSET = 290;
const REVIEW_INSET = 340;

/** Where the ride being picked goes: after the last one, between two, or in place of one. */
interface Slot {
  at: number;
  replace: boolean;
}

const lineRefs = (lines: StopLine[]): LineRef[] => {
  const seen = new Map<string, LineRef>();
  for (const l of lines) if (!seen.has(l.shortName)) seen.set(l.shortName, { label: l.shortName, kind: kindOfLine(l) });
  return [...seen.values()];
};

/**
 * Build a trip ride by ride. The sheet is a rail: start, walk, ride, walk,
 * ride, destination. Pick a boarding stop on the map (every line from it is
 * drawn in black), then a stop where you get off (only stops those lines
 * reach); the ride is added straight away and its lines turn coloured.
 * Tap a ride to replace or remove it, or the + between two rides to insert
 * one; the rides after it stay. Undo takes the last change back.
 */
export default function BuildRoute() {
  const insets = useSafeAreaInsets();
  const now = useNow(30_000);
  const [init] = useState(stepsDraft);
  const map = useRef<MapCanvasHandle>(null);
  const [rides, setRides] = useState<BuiltRide[]>([]);
  const [history, setHistory] = useState<BuiltRide[][]>([]);
  // Steps that came in from the route screen, until their rides are named from the planned legs.
  const [seed] = useState<JourneyStep[]>(init?.steps ?? []);
  const [slot, setSlot] = useState<Slot | null>(init?.steps.length ? null : { at: 0, replace: false });
  const [board, setBoard] = useState<StopHit | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [metro, setMetro] = useState<StopHit | null>(null);
  const [centre, setCentre] = useState<Point | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  const hotRef = useRef<string | null>(null);
  // The ends: pinned on the map first (Start) and last (End) when the route is built from scratch.
  const [phase, setPhase] = useState<'start' | 'end' | null>(!init?.from && !init?.steps.length ? 'start' : null);
  // The ends that came in; one still called "Dropped pin" gets its address as soon as it is looked up.
  const [initFrom, setInitFrom] = useState<Place | null>(init?.from ?? null);
  const [initTo, setInitTo] = useState<Place | null>(init?.to ?? null);
  useNamedPlace(initFrom, setInitFrom);
  useNamedPlace(initTo, setInitTo);
  const [startPlace, setStartPlace] = useState<Place | null>(null);
  const [endPlace, setEndPlace] = useState<Place | null>(null);
  const [endChosen, setEndChosen] = useState(false);
  const [endFromDone, setEndFromDone] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locNote, setLocNote] = useState<string | null>(null);
  const pinning = phase !== null;
  const adding = slot !== null && !pinning;

  useEffect(() => () => finishSteps(null), []);

  // Built from scratch (no ends yet): the ends are the first boarding stop and the last stop.
  const home = settings.get().home;
  const firstStop: Place | null = rides.length ? { ...rides[0].board, label: rides[0].board.name } : null;
  const lastStop: Place | null = rides.length ? { ...rides.at(-1)!.off, label: rides.at(-1)!.off.name } : null;
  const from: Place = initFrom ?? startPlace ?? firstStop ?? { ...(home ?? TBILISI), label: 'First stop' };
  const to: Place = initTo ?? endPlace ?? lastStop ?? { ...TBILISI, label: 'End' };
  const steps = useMemo(() => (rides.length ? rides.map(stepOf) : seed), [rides, seed]);
  // The preview plans the rides built so far. A start or end pinned here is part of it (the walk counts towards the leave time);
  // ends that came in with the draft are not, and a metro-only ride would otherwise fail on a long walk.
  const ends = rides.length ? { from: startPlace ?? firstStop!, to: endPlace ?? lastStop! } : { from, to };
  const trip = useMemo(
    () => (steps.length ? { id: 'draft', name: '', from: ends.from, to: ends.to, arriveBy: init?.arriveBy ?? '09:00', days: init?.days ?? [1, 2, 3, 4, 5], steps, avoid: init?.avoid } : null),
    [steps, rides, startPlace, endPlace],
  );
  const date = nextArriveBy(init?.arriveBy ?? '09:00', init?.days ?? [1, 2, 3, 4, 5], now).slice(0, 10);
  const plan = useTripPlan(trip, date, now);
  const it = plan.choice.kind === 'none' ? (plan.itineraries[0] ?? null) : plan.choice.it;
  const here: Point = rides.length ? rides.at(-1)!.off : (initFrom ?? startPlace ?? centre ?? from);

  // Steps that came in from the route screen: name their stops from the planned legs, keep the way's other stops and every line.
  useEffect(() => {
    if (rides.length || !seed.length || !it) return;
    const legs = it.legs.filter((l) => l.mode !== 'WALK');
    if (legs.length !== seed.length || legs.some((l) => !l.from.stopId || !l.to.stopId)) return;
    setRides(
      legs.map((l, i) => {
        const a = { id: l.from.stopId!, name: l.from.name, lat: l.from.lat, lon: l.from.lon, mode: l.mode };
        const b = { id: l.to.stopId!, name: l.to.name, lat: l.to.lat, lon: l.to.lon, mode: l.mode };
        return rideFromStep(seed[i], a, b, l.route ? { label: l.route.shortName, kind: kindOf(l) } : null);
      }),
    );
  }, [it?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Every change goes through here so Undo can take it back. */
  const change = (next: BuiltRide[]) => {
    setHistory((h) => [...h.slice(-(UNDO_DEPTH - 1)), rides]);
    setRides(next);
  };
  const undo = () => {
    const last = history.at(-1);
    if (!last) return;
    haptic('selection');
    setHistory((h) => h.slice(0, -1));
    setRides(last);
    setOpen(null);
    setBoard(null);
    setMetro(null);
    setSlot(last.length ? null : { at: 0, replace: false });
  };

  // Stops around the middle of the map, loaded as the map settles.
  const nearby = useStopsNear(adding ? (centre ?? here) : null);
  // Lines at the boarding stop (get-off step).
  const { lines, error: linesError, retry: retryLines } = useLines(board?.id ?? null);
  const onLines = lines ?? [];

  // Stops any line from the boarding stop reaches: the only places you can get off.
  const reachable = useMemo(() => {
    const m = new Map<string, StopHit>();
    for (const l of onLines) for (const s of l.next) if (s.id !== board?.id && !m.has(s.id)) m.set(s.id, { id: s.id, name: s.name, lat: s.lat, lon: s.lon, mode: l.mode });
    return [...m.values()];
  }, [onLines, board?.id]);

  const pickBoard = (s: StopHit) => {
    haptic('selection');
    setBoard(s);
    map.current?.flyTo(to, 15.5); // the pin starts at the end of the trip
  };
  const clearBoard = () => setBoard(null);

  /** A metro station within a short walk of where a ride ended is offered as the next boarding stop, never picked for you. */
  const suggestMetro = (stop: StopHit) => {
    setMetro(null);
    if (stop.mode === 'SUBWAY') return;
    nearStops(stop, { radiusM: 250, limit: 3, mode: 'SUBWAY' }).then(
      (r) => setMetro(r.find((x) => x.id !== stop.id) ?? null),
      () => {},
    );
  };

  /** Get off at `stop`: the ride is added (or replaces / is inserted) and its lines turn coloured. */
  const getOff = (stop: StopHit) => {
    if (!board || !slot) return;
    const used = onLines.filter((l) => l.next.some((x) => x.id === stop.id));
    if (!used.length) return;
    haptic('success');
    const path = [board, ...used[0].next.slice(0, used[0].next.findIndex((x) => x.id === stop.id) + 1)];
    const next = place(rides, slot.at, { board, off: stop, lines: lineRefs(used), skipped: [], path }, slot.replace);
    change(next);
    setOpen(null);
    setMetro(null);
    const last = !slot.replace && slot.at === next.length - 1;
    if (last) {
      // Keep going from here: the next ride starts at the stop you got off at.
      setSlot({ at: next.length, replace: false });
      setBoard(stop);
      suggestMetro(stop);
      map.current?.flyTo(to, 15.5);
    } else {
      setSlot(null);
      setBoard(null);
    }
  };

  const startPick = (s: Slot, at: StopHit | null) => {
    haptic('selection');
    setSlot(s);
    setBoard(at);
    setOpen(null);
    setMetro(null);
    if (at) suggestMetro(at);
  };
  const removeRide = (i: number) => {
    haptic('selection');
    const next = removeAt(rides, i);
    change(next);
    setOpen(null);
    setBoard(null);
    setSlot(next.length ? null : { at: 0, replace: false });
  };
  const toggle = (i: number, label: string) => {
    haptic('selection');
    change(rides.map((r, j) => (j === i ? toggleLine(r, label) : r)));
  };
  const stopAdding = () => {
    setSlot(null);
    setBoard(null);
    setMetro(null);
  };

  const roadIt = useRoadItinerary(it);
  const planned = useMemo(() => overlay(from, to, roadIt), [roadIt, from.lat, from.lon, to.lat, to.lon]);
  const shapes = useRideShapes(rides.map((r) => ({ route: r.lines.find((l) => !r.skipped.includes(l.label))?.label ?? '', from: r.board.id, to: r.off.id })));
  // Rides already built, in their colours but faded, so you can see where the next one joins.
  const built: MapRoute[] = useMemo(
    () => rides.map((r, i) => ({ points: shapes[i] ? decodePolyline(shapes[i]!) : r.path, color: `${kindColor[r.lines[0]?.kind ?? 'bus']}99` })),
    [rides, shapes],
  );

  // The middle of the map to ~300 m, so the set of stop dots only changes when you have really moved.
  const mid = centre ?? to;
  const cellKey = `${(Math.round(mid.lat / 0.003) * 0.003).toFixed(4)},${(Math.round(mid.lon / 0.003) * 0.003).toFixed(4)}`;

  // What the map shows depends on the step: stops to board at, the lines and stops to get off at, or the planned route.
  const { routes, markers, points } = useMemo(() => {
    if (phase === 'start') return { routes: [] as MapRoute[], markers: [] as MapMarker[], points: [] as Point[] };
    if (phase === 'end') {
      const mk: MapMarker[] = lastStop ? [{ key: 'last', at: lastStop, node: <StopDot on tint={color.ink} /> }] : [];
      return { routes: built, markers: mk, points: [] as Point[] };
    }
    if (adding && !board) {
      const mk: MapMarker[] = nearby.stops.map((s) => ({ key: s.id, at: s, node: <StopDot big={hot === s.id} />, sig: hot === s.id ? 'big' : '', onPress: () => pickBoard(s) }));
      return { routes: built, markers: mk, points: [] as Point[] };
    }
    if (adding && board) {
      // Every line from here in the app's black, so you see where you can get to; only stops they reach take a tap or the pin.
      const mk: MapMarker[] = [{ key: 'board', at: board, node: <StopDot on tint={color.ink} /> }];
      const c = { lat: Number(cellKey.split(',')[0]), lon: Number(cellKey.split(',')[1]) };
      const shown = [...reachable].sort((a, b) => distM(a, c) - distM(b, c)).slice(0, 70);
      for (const s of shown) mk.push({ key: s.id, at: s, node: <StopDot big={hot === s.id} />, sig: hot === s.id ? 'big' : '', onPress: () => getOff(s) });
      const rt: MapRoute[] = [...built, ...onLines.map((l) => ({ points: [board, ...l.next] }))];
      return { routes: rt, markers: mk, points: [board, to] as Point[] };
    }
    return { routes: planned.routes, markers: planned.markers, points: planned.points };
  }, [phase, adding, board, nearby.stops, reachable, onLines, built, planned, hot, cellKey, slot, rides]);

  // Frame the map when the step changes (not on the first frame: the map starts framed).
  const fitKey = `${phase}|${adding}|${board ? 1 : 0}|${it?.id ?? ''}`;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (pinning || (adding && board)) return; // pickBoard already moved the map to the trip's end; the pin phases keep the map where it is
    if (points.length) map.current?.fit(points);
    else if (adding) map.current?.flyTo(here, 15.5);
  }, [fitKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const nearest = useMemo(() => {
    const c = centre ?? here;
    return nearby.stops.map((s) => ({ s, d: distM(c, s) })).sort((a, b) => a.d - b.d)[0] ?? null;
  }, [nearby.stops, centre, here.lat, here.lon]);

  // The stop under the pin (within SNAP_PT on screen) grows and ticks; settling beside one pulls the pin on.
  // Before a boarding stop it is the stops around; after, only the ones the lines reach (the same ones that are drawn).
  const nearbyRef = useRef<StopHit[]>(nearby.stops);
  nearbyRef.current = board ? [...reachable].sort((a, b) => distM(a, mid) - distM(b, mid)).slice(0, 70) : nearby.stops;
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

  const finishWith = (end: Place) => {
    haptic('success');
    finishSteps(steps.length ? { steps, from, to: end } : null);
    router.back();
  };
  // Without a destination yet, Done first offers the End step; the walk from the last stop is then counted.
  const done = () => {
    if (!init?.to && !endChosen && rides.length) {
      haptic('selection');
      setEndFromDone(true);
      setPhase('end');
      return;
    }
    finishWith(to);
  };

  // The address under the pin while a pin step is open.
  const address = useAddress(pinning ? (centre ?? here) : null);
  const pinPlace = (): Place => {
    const c = centre ?? here;
    return { lat: c.lat, lon: c.lon, label: address.name ?? DROPPED_PIN };
  };
  const startHere = async () => {
    haptic('success');
    // Pressed before the address came back: wait a moment for it rather than keep an unnamed pin.
    const p = await nameOfPlace(pinPlace());
    setStartPlace(p);
    setPhase(null);
  };
  const startAtStop = () => {
    haptic('selection');
    setStartPlace(null);
    setPhase(null);
  };
  const locate = async () => {
    setLocating(true);
    setLocNote(null);
    try {
      const at = await locateMe();
      if (typeof at === 'object') map.current?.flyTo(at, 16);
      else if (at === 'denied') setLocNote('Location is off for the app. Move the map to your start instead.');
      else if (at === 'error') setLocNote("Couldn't find your location. Move the map to your start instead.");
    } finally {
      setLocating(false);
    }
  };
  const endHere = async () => {
    const p = await nameOfPlace(pinPlace());
    setEndPlace(p);
    setEndChosen(true);
    setPhase(null);
    if (endFromDone) finishWith(p);
  };
  const endAtStop = () => {
    setEndPlace(null);
    setEndChosen(true);
    setPhase(null);
    if (endFromDone && lastStop) finishWith(lastStop);
  };
  const cancelEnd = () => {
    setEndFromDone(false);
    setPhase(null);
  };

  const start = it ? { fit: planned.points } : { center: here, zoom: 15.5 };
  const hotStop = board && hot ? reachable.find((x) => x.id === hot) : undefined;

  return (
    <View style={styles.screen}>
      <MapCanvas
        ref={map}
        style={StyleSheet.absoluteFill}
        start={start}
        routes={routes}
        markers={markers}
        pin={adding || pinning}
        onMove={onMove}
        onIdle={onIdle}
        inset={{ top: insets.top + 64, bottom: adding || pinning ? PICK_INSET : REVIEW_INSET }}
      />
      <View style={[styles.floating, { top: insets.top + 12 }]} pointerEvents="box-none">
        <MapButton icon="back" label="Back" onPress={() => router.back()} />
      </View>

      <Animated.View
        entering={FadeInDown.springify().damping(spring.sheet.damping).stiffness(spring.sheet.stiffness)}
        style={[styles.sheet, { paddingBottom: insets.bottom + 16, minHeight: adding || pinning ? PICK_INSET : REVIEW_INSET }]}
      >
        <View style={styles.header}>
          <Text variant="label16" numberOfLines={1} style={styles.flex}>
            {phase === 'start' ? 'Where do you start?' : phase === 'end' ? 'Where do you end up?' : init?.from || init?.to || rides.length || startPlace ? `${from.label} → ${to.label}` : 'Build your route'}
          </Text>
          {history.length > 0 && (
            <Tap onPress={undo} hitSlop={8} haptic="none" style={styles.undo} accessibilityRole="button" accessibilityLabel="Undo the last change">
              <Icon name="back" size={16} />
              <Text variant="label14">Undo</Text>
            </Tap>
          )}
        </View>

        {phase === 'start' && (
          <Animated.View key="start" entering={FadeIn.duration(160)} style={styles.gap}>
            <PinCard caption="Start" address={address} />
            {locNote && (
              <Text variant="caption" color={color.textSecondary}>
                {locNote}
              </Text>
            )}
            <Button label="Start here" onPress={startHere} haptic="none" />
            <View style={styles.actions2}>
              <Button label="Use my location" icon="locate" kind="secondary" onPress={locate} disabled={locating} haptic="none" style={styles.editBtn} />
              <Button label="I start at the stop" kind="secondary" onPress={startAtStop} haptic="none" style={styles.editBtn} />
            </View>
          </Animated.View>
        )}

        {phase === 'end' && (
          <Animated.View key="end" entering={FadeIn.duration(160)} style={styles.gap}>
            <PinCard caption="Destination" address={address} />
            <Button label="End here" onPress={endHere} haptic="none" />
            <View style={styles.actions2}>
              <Button label={lastStop ? `End at ${lastStop.label}` : 'End at this stop'} kind="secondary" onPress={endAtStop} haptic="none" style={styles.editBtn} />
              {!endFromDone && <Button label="Cancel" kind="secondary" onPress={cancelEnd} haptic="none" style={styles.editBtn} />}
            </View>
          </Animated.View>
        )}

        {!pinning && (rides.length > 0 || slot) && (
          <Rail
            rides={rides}
            from={from}
            to={to}
            open={open}
            slot={slot}
            onOpen={(i) => setOpen((o) => (o === i ? null : i))}
            onToggle={toggle}
            onReplace={(i) => startPick({ at: i, replace: true }, null)}
            onRemove={removeRide}
            onInsert={(i) => startPick({ at: i, replace: false }, rides[i - 1]?.off ?? null)}
            onEditStart={init?.from ? undefined : () => setPhase('start')}
            onEditEnd={init?.to || !rides.length ? undefined : () => (setEndFromDone(false), setPhase('end'))}
          />
        )}

        {adding && (
          <Animated.View key={board ? 'off' : 'board'} entering={FadeIn.duration(160)} style={styles.gap}>
            {!board ? (
              <>
                <Text variant="body14" color={color.textSecondary}>
                  Tap a stop on the map, or move the map so the pin is by the stop.
                </Text>
                {nearby.loading && !nearby.stops.length ? (
                  <Busy label="Loading stops…" />
                ) : nearest ? (
                  <Button label={`Board at ${nearest.s.name} · ${distanceLabel(nearest.d)}`} kind="secondary" onPress={() => pickBoard(nearest.s)} haptic="none" />
                ) : (
                  <View style={styles.gap}>
                    <Text variant="body14" color={color.textSecondary}>
                      {nearby.error ? "Can't load stops right now." : 'No stops here. Move the map.'}
                    </Text>
                    {nearby.error && <Button label="Try again" kind="secondary" onPress={nearby.retry} haptic="none" />}
                  </View>
                )}
              </>
            ) : (
              <>
                <View style={styles.pair}>
                  <Tap onPress={clearBoard} feedback="tint" style={styles.half} accessibilityRole="button" accessibilityLabel={`Boarding at ${board.name}. Change`}>
                    <View style={styles.dot} />
                    <Text variant="label14" numberOfLines={1} style={styles.flex}>
                      {board.name}
                    </Text>
                  </Tap>
                  <Icon name="chevron-right" size={18} color={color.textTertiary} />
                  <View style={styles.half}>
                    <Icon name="pin" size={16} color={hotStop ? color.ink : color.textTertiary} />
                    <Text variant="label14" numberOfLines={1} color={hotStop ? color.text : color.textSecondary} style={styles.flex}>
                      {hotStop ? hotStop.name : 'Get off'}
                    </Text>
                  </View>
                </View>
                {!lines && !linesError ? (
                  <Busy label="Loading the lines at this stop…" />
                ) : linesError ? (
                  <View style={styles.gap}>
                    <Text variant="body14" color={color.textSecondary}>
                      Can't load the lines for this stop right now.
                    </Text>
                    <Button label="Try again" kind="secondary" onPress={retryLines} haptic="none" />
                  </View>
                ) : (
                  <>
                    <Text variant="body14">Every line from here is on the map. Tap a stop, or move the pin onto it.</Text>
                    <Button label={hotStop ? `Get off at ${hotStop.name}` : 'Move the pin onto a stop'} onPress={() => hotStop && getOff(hotStop)} disabled={!hotStop} haptic="none" />
                  </>
                )}
                {metro && slot && slot.at === rides.length && board.id === rides.at(-1)?.off.id && (
                  <Button label={`Metro ${metro.name} · ${distanceLabel(distM(board, metro))}`} icon="metro" kind="secondary" onPress={() => (pickBoard(metro), setMetro(null))} haptic="none" />
                )}
              </>
            )}
            {(rides.length > 0 || slot.replace) && (
              <Button label={slot.replace ? 'Cancel' : 'Stop adding rides'} kind="secondary" onPress={stopAdding} haptic="none" style={styles.slim} />
            )}
          </Animated.View>
        )}

        {!adding && !pinning && (
          <View style={styles.gap}>
            {it ? (
              <View style={styles.gap}>
                <LineChain slots={slotsFor(it, plan.itineraries)} />
                <Text variant="caption" color={color.textSecondary}>
                  Board around {hhmm(leaveAt(it, settings.get().bufferMin))} · arrive {hhmm(it.arriveAt)}
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
              <Button label="Add another ride" icon="plus" kind="secondary" onPress={() => startPick({ at: rides.length, replace: false }, rides.at(-1)?.off ?? null)} haptic="none" />
              <Button label="Done" onPress={done} disabled={!steps.length} haptic="none" />
            </View>
          </View>
        )}
      </Animated.View>
    </View>
  );
}

interface RailProps {
  rides: BuiltRide[];
  from: Place;
  to: Place;
  open: number | null;
  slot: Slot | null;
  onOpen: (i: number) => void;
  onToggle: (i: number, label: string) => void;
  onReplace: (i: number) => void;
  onRemove: (i: number) => void;
  onInsert: (i: number) => void;
  /** Set when the start / end was not given, so tapping it changes it. */
  onEditStart?: () => void;
  onEditEnd?: () => void;
}

/** The trip as a rail: start, then each ride with the walk before it, then the destination. Tap a ride to change it. */
function Rail({ rides, from, to, open, slot, onOpen, onToggle, onReplace, onRemove, onInsert, onEditStart, onEditEnd }: RailProps) {
  const picking = slot?.replace ? slot.at : -1;
  return (
    <ScrollView style={styles.railScroll} contentContainerStyle={styles.rail} showsVerticalScrollIndicator={false}>
      <Tap onPress={onEditStart} disabled={!onEditStart} feedback={onEditStart ? 'tint' : undefined} style={styles.railRow} accessibilityRole={onEditStart ? 'button' : undefined} accessibilityLabel={onEditStart ? `Start: ${from.label}. Change` : undefined}>
        <View style={styles.railTrack}>
          <View style={styles.endDot} />
        </View>
        <Text variant="caption" color={color.textSecondary} numberOfLines={1} style={styles.flex}>
          {from.label}
        </Text>
        {onEditStart && <Icon name="chevron-right" size={14} color={color.textTertiary} />}
      </Tap>
      {rides.map((r, i) => {
        const walk = i === 0 ? distM(from, r.board) : gapBefore(rides, i);
        const far = walk > FAR_WALK_M;
        const kind = r.lines[0]?.kind ?? 'bus';
        const expanded = open === i;
        return (
          <View key={`${r.board.id}-${r.off.id}-${i}`}>
            {(walk > 30 || (i > 0 && !slot)) && (
              <View style={styles.railRow}>
                <View style={styles.railTrack}>
                  <View style={styles.railDash} />
                </View>
                <Text variant="caption" color={far ? color.metro : color.textSecondary} style={styles.flex}>
                  {walk > 30 ? `Walk ${distanceLabel(walk)} · about ${walkMinutes(walk)} min${far ? ' (far)' : ''}` : 'Change here'}
                </Text>
                {!slot && (
                  <Tap onPress={() => onInsert(i)} hitSlop={8} style={styles.junction} accessibilityRole="button" accessibilityLabel={`Add a ride before ride ${i + 1}`}>
                    <Icon name="plus" size={14} />
                  </Tap>
                )}
              </View>
            )}
            <Tap onPress={() => onOpen(i)} feedback="tint" style={[styles.ride, expanded && styles.rideOpen, picking === i && styles.rideReplacing]} accessibilityRole="button" accessibilityLabel={`Ride ${i + 1}: ${r.board.name} to ${r.off.name}. Edit`}>
              <View style={styles.railTrack}>
                <View style={[styles.railBar, { backgroundColor: kindColor[kind] }]} />
              </View>
              <View style={styles.flex}>
                <Text variant="label14" numberOfLines={1}>
                  {r.board.name} → {r.off.name}
                </Text>
                {r.lines.length > 0 && (
                  <View style={styles.plates}>
                    <Stack slot={r.lines.filter((l) => !r.skipped.includes(l.label))} size="sm" />
                  </View>
                )}
              </View>
              <Icon name="chevron-right" size={18} color={color.textTertiary} />
            </Tap>
            {expanded && (
              <Animated.View entering={FadeIn.duration(160)} style={styles.editBar}>
                {r.lines.length > 1 && (
                  <View style={styles.chips}>
                    <Text variant="caption" color={color.textSecondary}>
                      Lines on this ride (tap to switch off)
                    </Text>
                    <View style={styles.chipRow}>
                      {r.lines.map((l) => {
                        const off = r.skipped.includes(l.label);
                        return (
                          <Tap key={l.label} onPress={() => onToggle(i, l.label)} scaleTo={0.92} style={[styles.chip, off && styles.chipOff]} accessibilityRole="switch" accessibilityState={{ checked: !off }} accessibilityLabel={`Line ${l.label}`}>
                            <RoutePlate label={l.label} kind={l.kind} size="sm" />
                            <Icon name={off ? 'plus' : 'close'} size={12} color={color.textSecondary} />
                          </Tap>
                        );
                      })}
                    </View>
                  </View>
                )}
                <View style={styles.editActions}>
                  <Button label="Replace" kind="secondary" onPress={() => onReplace(i)} haptic="none" style={styles.editBtn} />
                  <Button label="Remove" kind="secondary" onPress={() => onRemove(i)} haptic="none" style={styles.editBtn} />
                </View>
              </Animated.View>
            )}
          </View>
        );
      })}
      {rides.length > 0 && !slot && distM(rides.at(-1)!.off, to) > 30 && (
        <View style={styles.railRow}>
          <View style={styles.railTrack}>
            <View style={styles.railDash} />
          </View>
          <Text variant="caption" color={distM(rides.at(-1)!.off, to) > FAR_WALK_M ? color.metro : color.textSecondary} style={styles.flex}>
            Walk {distanceLabel(distM(rides.at(-1)!.off, to))} · about {walkMinutes(distM(rides.at(-1)!.off, to))} min
          </Text>
        </View>
      )}
      <Tap onPress={onEditEnd} disabled={!onEditEnd} feedback={onEditEnd ? 'tint' : undefined} style={styles.railRow} accessibilityRole={onEditEnd ? 'button' : undefined} accessibilityLabel={onEditEnd ? `Destination: ${to.label}. Change` : undefined}>
        <View style={styles.railTrack}>
          <View style={styles.endDotRing} />
        </View>
        <Text variant="caption" color={color.textSecondary} numberOfLines={1} style={styles.flex}>
          {to.label}
        </Text>
        {onEditEnd && <Icon name="chevron-right" size={14} color={color.textTertiary} />}
      </Tap>
    </ScrollView>
  );
}

/** The address under the pin: looked up (debounced) as the map settles, null while it loads or when nothing is known. */
function useAddress(p: Point | null) {
  const [state, setState] = useState<{ key: string; name: string | null; sub: string | null } | null>(null);
  const key = p ? `${p.lat.toFixed(5)},${p.lon.toFixed(5)}` : '';
  useEffect(() => {
    if (!p) return;
    if (!hasApi) {
      setState({ key, name: null, sub: null });
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      reversePlace(p).then(
        async (hit) => {
          // No address here: the closest stop is the next best name.
          const name = hit?.name ?? (await pinName(p));
          if (live) setState({ key, name: isDropped(name) ? null : name, sub: hit?.address ?? null });
        },
        () => live && setState({ key, name: null, sub: null }),
      );
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = state && state.key === key ? state : null;
  return { loading: !!p && !mine, name: mine?.name ?? null, sub: mine?.sub ?? null };
}

/** The address of the pin, in the sheet of a pin step. */
function PinCard({ caption, address }: { caption: string; address: { loading: boolean; name: string | null; sub: string | null } }) {
  return (
    <View>
      <Text variant="caption" color={color.textSecondary}>
        {caption}
      </Text>
      <View style={styles.addressBox}>
        {address.loading ? (
          <Busy label="Finding the address…" />
        ) : (
          <>
            <Text variant="label16" numberOfLines={1}>
              {address.name ?? DROPPED_PIN}
            </Text>
            {address.sub ? (
              <Text variant="caption" color={color.textSecondary} numberOfLines={1}>
                {address.sub}
              </Text>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

/** Stops around a point, refreshed (debounced) as the point moves. Null point loads nothing. */
function useStopsNear(p: Point | null) {
  const [stops, setStops] = useState<StopHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
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
  }, [key, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  return { stops, loading, error, retry: () => setAttempt((n) => n + 1) };
}

/** Every line at a stop and where it goes next. */
function useLines(stopId: string | null) {
  const [state, setState] = useState<{ id: string; lines: StopLine[] | null; error: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!stopId) return;
    setState(null);
    let live = true;
    stopLines(stopId).then(
      (r) => live && setState({ id: stopId, lines: r.lines, error: false }),
      () => live && setState({ id: stopId, lines: null, error: true }),
    );
    return () => {
      live = false;
    };
  }, [stopId, attempt]);
  const mine = state && state.id === stopId ? state : null;
  return { lines: mine?.lines ?? null, error: mine?.error ?? false, retry: () => setAttempt((n) => n + 1) };
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 10 },
  undo: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface, ...shadow.soft },
  railScroll: { maxHeight: 188, flexGrow: 0, marginBottom: 8 },
  rail: { gap: 2 },
  railRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 26 },
  railTrack: { width: 14, alignItems: 'center', alignSelf: 'stretch', justifyContent: 'center' },
  railBar: { width: 5, flex: 1, borderRadius: 3, marginVertical: 2 },
  railDash: { width: 2, flex: 1, borderRadius: 1, backgroundColor: color.border },
  endDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: color.ink },
  endDotRing: { width: 12, height: 12, borderRadius: 6, borderWidth: 3, borderColor: color.ink },
  junction: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: color.border, backgroundColor: color.surface },
  ride: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, borderRadius: radius.sm, paddingVertical: 4, paddingRight: 6 },
  rideOpen: { backgroundColor: color.surfaceMuted },
  rideReplacing: { opacity: 0.4 },
  plates: { flexDirection: 'row', marginTop: 2 },
  editBar: { gap: 10, paddingLeft: 24, paddingTop: 8, paddingBottom: 6 },
  chips: { gap: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5, paddingLeft: 6, paddingRight: 8, borderRadius: 14, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface },
  chipOff: { opacity: 0.4 },
  editActions: { flexDirection: 'row', gap: 8 },
  editBtn: { flex: 1, height: 44 },
  slim: { height: 44 },
  pair: { flexDirection: 'row', alignItems: 'center', backgroundColor: color.surfaceMuted, borderRadius: radius.md, height: 52, paddingHorizontal: 6 },
  half: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, height: 52 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: color.ink },
  screen: { flex: 1, backgroundColor: color.bg },
  floating: { position: 'absolute', left: 12 },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '62%', backgroundColor: color.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: gutter, paddingTop: 16, ...shadow.bar },
  gap: { gap: 10, flexShrink: 1 },
  flex: { flex: 1 },
  actions: { gap: 8, paddingTop: 4 },
  actions2: { flexDirection: 'row', gap: 8 },
  addressBox: { minHeight: 44, justifyContent: 'center' },
});

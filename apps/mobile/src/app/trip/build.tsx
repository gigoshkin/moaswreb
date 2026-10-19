import type { Itinerary, JourneyStep, StopHit } from '@transit/shared';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { finishSteps, stepsDraft } from '../../lib/handoff';
import { distM, rideFromStep, stepOf } from '../../lib/chain';
import {
  builder, cancelRide, canFinish, commit, endsOf, finish, groundOk, initFlow, insertAt, namedAll, onwardLines, phaseOf, pinDropped, pinStop, reachableFrom,
  reboard, removeRide, replaceAt, rideEnded, ridesEnded, rowsOf, seeded, toggleRideLine, twinAcross, undo as undoFlow, type Flow, type Phase,
} from '../../lib/buildFlow';
import { metroLinesDrawn, metroReach, metroRides } from '../../lib/metro';
import { kindOf, leaveAt } from '../../lib/plans';
import { locateMe } from '../../lib/locate';
import { nameOfPlace } from '../../lib/nameOfPlace';
import { DROPPED_PIN, isDropped } from '../../lib/placeNames';
import { settings } from '../../lib/settings';
import { distanceLabel } from '../../lib/stops';
import { hhmm, nextArriveBy } from '../../lib/time';
import { decodePolyline } from '../../lib/mapMath';
import { useNow } from '../../lib/useNow';
import { useLineShapes, useRideShapes } from '../../lib/shapes';
import { useTripPlan } from '../../lib/useTripPlan';
import { useAddress, useLines, useMetroNet, useStopsNear } from '../../lib/useStopData';
import { slotsFor } from '../../lib/ways';
import { BuildRail } from '../../ui/BuildRail';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { LineChain } from '../../ui/LineChain';
import { MapCanvas, type MapCanvasHandle, type MapMarker, type MapRoute } from '../../ui/MapCanvas';
import { EndRing, StartDot, StopDot } from '../../ui/MapMarks';
import { kindColor } from '../../ui/RoutePlate';
import { Busy } from '../../ui/Spinner';
import { Tap, haptic } from '../../ui/Tap';
import { Text } from '../../ui/Text';
import { MapButton } from '../../ui/kit';
import { color, gutter, radius, shadow, spring } from '../../ui/theme';

/** The pin is "on" a stop this close, measured on screen so it feels the same at every zoom: the stop grows, a tick, and a settle pulls it on. */
const SNAP_PT = 14;
/** Metres per screen point at an app zoom (Google zoom is that + 1, 256 points across the world at zoom 0). */
const metresPerPoint = (lat: number, zoom: number) => (40_075_017 * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** (zoom + 1));
const TBILISI = { lat: 41.7151, lon: 44.793 };
type Point = { lat: number; lon: number };
/** The map's middle (and the pin) sit above at least this much sheet, so the pin doesn't jump as the sheet grows. */
const MIN_SHEET = 290;
/** The sheet never covers more of the screen than this; its rows scroll inside. */
const MAX_SHEET = 0.6;
/** Road shapes are asked for at most this many lines of a boarding stop; the rest stay straight. */
const ROAD_LINES = 24;
/** A metro station this close to where a ride ended is offered as a shortcut for the pin. */
const METRO_NEAR_M = 250;

const TITLE: Record<Phase, string> = {
  first: 'Where do you start?',
  walkEnd: 'Where does the walk end?',
  awaitingOff: 'Where do you get off?',
  floating: 'Next: a ride, or walk on',
  insertBoard: 'Where does this ride start?',
};
const HINT: Record<Phase, string> = {
  first: 'Move the pin to where you start, or onto a stop to start with a ride.',
  walkEnd: 'Move the pin onto the stop you walk to, or to where the walk ends.',
  awaitingOff: 'Every line from here is on the map. Tap a stop, or move the pin onto it.',
  floating: 'Move the pin onto a stop or station for the next ride, or to a place to walk to.',
  insertBoard: 'Tap a stop, or move the pin onto the stop this ride starts at.',
};

/**
 * Build a trip by hand with a floating pin (the flow is in lib/buildFlow):
 * a pin on the ground starts a walk, the next pin is its End; a pin on a stop
 * boards a ride there and draws every line onward from it in black; the stop
 * you get off at ends the ride and the pin floats again, for a walk or the
 * next ride. Done hands the rides and the two ends back.
 */
export default function BuildRoute() {
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const now = useNow(30_000);
  const [init] = useState(stepsDraft);
  const map = useRef<MapCanvasHandle>(null);
  const [b, setB] = useState(() => builder(initFlow(init?.from ?? null, init?.to ?? null)));
  const f = b.flow;
  const phase = phaseOf(f);
  const act = (fn: (f: Flow) => Flow) => setB((cur) => commit(cur, fn(cur.flow)));
  // Steps that came in from the route screen, until their rides are named from the planned legs.
  const [seed] = useState<JourneyStep[]>(init?.steps ?? []);
  const [open, setOpen] = useState<number | null>(null);
  const [centre, setCentre] = useState<Point | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  const hotRef = useRef<string | null>(null);
  const [sheetH, setSheetH] = useState(MIN_SHEET);
  const [locating, setLocating] = useState(false);
  // A ground pin waits (briefly) for its address before it becomes a Start or an End.
  const [naming, setNaming] = useState(false);

  useEffect(() => () => finishSteps(null), []);

  // A Start or End still called "Dropped pin" (it came in that way, or the lookup was slow) gets its name when the lookup answers.
  const unnamed = [f.start, f.end].filter((p): p is NonNullable<typeof p> => !!p && isDropped(p.label));
  const unnamedKey = unnamed.map((p) => `${p.lat},${p.lon}`).join('|');
  useEffect(() => {
    let live = true;
    for (const p of unnamed) nameOfPlace(p).then((n) => live && n !== p && setB((cur) => namedAll(cur, n, isDropped)));
    return () => {
      live = false;
    };
  }, [unnamedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const home = settings.get().home;
  const startAt: Point = init?.from ?? home ?? TBILISI;
  const pinAt: Point = centre ?? startAt;
  const lastOff = f.rides.at(-1)?.off ?? null;

  // The preview plans the rides built so far, between the route's own ends (the walks count towards the leave time).
  const steps = useMemo(() => (f.rides.length ? f.rides.map(stepOf) : seed), [f.rides, seed]);
  const ending = endsOf(f);
  const ends = ending ?? { from: init?.from ?? { ...startAt, label: 'Start' }, to: init?.to ?? { ...startAt, label: 'End' } };
  const trip = useMemo(
    () => (steps.length ? { id: 'draft', name: '', from: ends.from, to: ends.to, arriveBy: init?.arriveBy ?? '09:00', days: init?.days ?? [1, 2, 3, 4, 5], steps, avoid: init?.avoid } : null),
    [steps, ends.from.lat, ends.from.lon, ends.to.lat, ends.to.lon], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const date = nextArriveBy(init?.arriveBy ?? '09:00', init?.days ?? [1, 2, 3, 4, 5], now).slice(0, 10);
  const plan = useTripPlan(trip, date, now);
  const it = plan.choice.kind === 'none' ? (plan.itineraries[0] ?? null) : plan.choice.it;

  // Steps that came in from the route screen: name their stops from the planned legs, keep the way's other stops and every line.
  useEffect(() => {
    if (f.rides.length || !seed.length || !it) return;
    const legs = it.legs.filter((l) => l.mode !== 'WALK');
    if (legs.length !== seed.length || legs.some((l) => !l.from.stopId || !l.to.stopId)) return;
    const rides = legs.map((l, i) => {
      const a = { id: l.from.stopId!, name: l.from.name, lat: l.from.lat, lon: l.from.lon, mode: l.mode };
      const z = { id: l.to.stopId!, name: l.to.name, lat: l.to.lat, lon: l.to.lon, mode: l.mode };
      return rideFromStep(seed[i], a, z, l.route ? { label: l.route.shortName, kind: kindOf(l) } : null);
    });
    setB((cur) => ({ ...cur, flow: seeded(cur.flow, rides) }));
    map.current?.fit(rides.flatMap((r) => [r.board, r.off]));
  }, [it?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // While the pin floats: every stop and station around it. While a ride waits for its get-off stop: the lines from its boarding stop.
  const nearby = useStopsNear(phase === 'awaitingOff' ? null : pinAt);
  const { lines, error: linesError, retry: retryLines } = useLines(f.board?.id ?? null);
  // A metro station: the whole connected metro, every station a get-off, changes put in for you.
  const net = useMetroNet(f.board, lines);
  const reachable = useMemo(() => (f.board && net ? metroReach(net, f.board.id) : f.board && lines ? reachableFrom(f.board, lines) : []), [f.board, lines, net]);
  // Buses and minibuses: only the stops ahead, drawn along the road once its shape is in (straight until then).
  const onward = useMemo(() => (f.board && lines && !net ? onwardLines(f.board, lines) : []), [f.board, lines, net]);
  const roadAsk = useMemo(() => (f.board ? onward.slice(0, ROAD_LINES).map((l) => ({ route: l.shortName, from: f.board!.id, to: l.next.at(-1)!.id })) : []), [f.board, onward]);
  const roadShapes = useLineShapes(roadAsk);
  const roads = useMemo(() => {
    const m = new Map<string, Point[]>();
    roadAsk.forEach((r, i) => roadShapes[i] && !m.has(r.route) && m.set(r.route, decodePolyline(roadShapes[i]!)));
    return m;
  }, [roadAsk, roadShapes]);
  // The stop of the same name across the road (from the stops around where the pin was), when the pin took the wrong side: its lines go the other way.
  const across = useMemo(() => (phase === 'awaitingOff' && f.board ? twinAcross(f.board, nearby.stops) : null), [phase, f.board, nearby.stops]);

  // The stop dots on the map: the ones the pin can go on now (the same ones it snaps to).
  const cell = `${(Math.round(pinAt.lat / 0.003) * 0.003).toFixed(4)},${(Math.round(pinAt.lon / 0.003) * 0.003).toFixed(4)}`;
  const candidates = useMemo(() => {
    if (phase !== 'awaitingOff') return nearby.stops;
    const [lat, lon] = cell.split(',').map(Number);
    return [...reachable].sort((x, y) => distM(x, { lat, lon }) - distM(y, { lat, lon })).slice(0, 70);
  }, [phase, nearby.stops, reachable, cell]);
  const candRef = useRef(candidates);
  candRef.current = candidates;
  const boardRef = useRef(f.board);
  boardRef.current = f.board;
  const hotStop = hot ? (candidates.find((s) => s.id === hot) ?? null) : null;

  // ——— Pin on a stop: within SNAP_PT on screen the stop grows and ticks; settling beside one pulls the pin on. ———
  // One pull per drag: a pull's own camera move (or a re-centre after the sheet resizes) never pulls again, so two
  // stops close together (a bus stop beside its metro station) can't pull the pin back and forth. A new drag, or the
  // pin leaving every stop, allows the next pull.
  const pulled = useRef(false);
  const stopAt = (c: Point, zoom: number) => {
    const best = pinStop(c, candRef.current, SNAP_PT * metresPerPoint(c.lat, zoom), hotRef.current, boardRef.current?.id);
    return best ? { ...best, pt: best.d / metresPerPoint(c.lat, zoom) } : null;
  };
  const mark = (id: string | null) => {
    if (id === hotRef.current) return;
    hotRef.current = id;
    setHot(id);
    if (id) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };
  const onMove = (c: Point, zoom: number) => mark(stopAt(c, zoom)?.s.id ?? null);
  const onIdle = (c: Point, zoom: number) => {
    const s = stopAt(c, zoom);
    mark(s?.s.id ?? null);
    if (s && s.pt > 1.5 && !pulled.current) {
      pulled.current = true;
      map.current?.flyTo(s.s, zoom); // eases the pin onto the stop; the next idle reports the stop itself
      return;
    }
    if (!s) pulled.current = false;
    setCentre(c);
  };
  const onMoveStart = () => {
    pulled.current = false;
  };

  // ——— Events. Nothing is picked for you: every change is a tap. ———
  const address = useAddress(groundOk(f) && !hotStop ? pinAt : null);
  const dropOnStop = (s: StopHit) => {
    haptic('selection');
    setOpen(null);
    act((x) => pinDropped(x, { lat: s.lat, lon: s.lon, label: s.name }, s));
    // Show where the lines go: the boarding stop and the trip's end when it is known.
    if (init?.to) map.current?.fit([s, init.to]);
    else map.current?.flyTo(s, 14.8);
  };
  const dropOnGround = async () => {
    haptic('selection');
    setOpen(null);
    // Pressed before the address came back: wait a moment for it rather than keep an unnamed pin.
    setNaming(true);
    const p = await nameOfPlace({ lat: pinAt.lat, lon: pinAt.lon, label: address.name ?? DROPPED_PIN }).finally(() => setNaming(false));
    act((x) => pinDropped(x, p, null));
  };
  const getOff = (s: StopHit) => {
    if (!lines || !f.board) return;
    haptic('success');
    const metro = net ? metroRides(net, f.board.id, s.id) : null;
    if (metro) act((x) => ridesEnded(x, metro));
    else act((x) => rideEnded(x, s, lines, roads));
    // The pin floats again at the stop you got off at, with the stops and stations around it above the sheet.
    map.current?.flyTo(s, 16.2);
  };
  const undo = () => {
    haptic('selection');
    setOpen(null);
    setB(undoFlow);
  };
  const done = () => {
    const r = finish(f);
    if (!r) return;
    haptic('success');
    finishSteps(r);
    router.back();
  };
  const locate = async () => {
    setLocating(true);
    try {
      const at = await locateMe();
      if (typeof at === 'object') map.current?.flyTo(at, 16);
      // Otherwise staying where we are is a fine answer.
    } finally {
      setLocating(false);
    }
  };
  const boardAcross = () => {
    if (!across || !f.board) return;
    haptic('selection');
    act((x) => reboard(x, across));
  };

  /**
   * A metro station near the bus stop you got off at: a shortcut that puts the pin on its dot (you still board with a tap).
   * It stays while the pin is on the station: hiding it then resized the sheet, which moved the map under the pin,
   * which took the pin off the station and brought the button back (a snap / unsnap loop with a tick each time).
   */
  const metroNear = useMemo(() => {
    if (phase !== 'floating' || !lastOff || lastOff.mode === 'SUBWAY') return null;
    const m = nearby.stops.filter((s) => s.mode === 'SUBWAY' && s.id !== lastOff.id).map((s) => ({ s, d: distM(lastOff, s) })).sort((x, y) => x.d - y.d)[0];
    return m && m.d <= METRO_NEAR_M ? m : null;
  }, [phase, lastOff, nearby.stops]);

  // ——— The map. ———
  const shapes = useRideShapes(f.rides.map((r) => ({ route: r.lines.find((l) => !r.skipped.includes(l.label))?.label ?? '', from: r.board.id, to: r.off.id })));
  const rows = useMemo(() => rowsOf(f), [f]);
  const { routes, markers } = useMemo(() => {
    // Rides built so far in their colours, and the walks dashed.
    const rt: MapRoute[] = f.rides.map((r, i) => ({ points: shapes[i] ? decodePolyline(shapes[i]!) : r.path, color: `${kindColor[r.lines[0]?.kind ?? 'bus']}cc` }));
    for (const row of rows) if (row.kind === 'walk' && row.to && row.metres) rt.push({ points: [row.from, row.to], walk: true });
    const mk: MapMarker[] = [];
    if (f.start) mk.push({ key: 'start', at: f.start, node: <StartDot /> });
    if (f.end) mk.push({ key: 'end', at: f.end, node: <EndRing /> });
    if (f.board) {
      // Only now are lines black: every line onward from the boarding stop (the whole metro from a station), and the stops they reach.
      if (net) for (const points of metroLinesDrawn(net)) rt.push({ points });
      else for (const l of onward) rt.push({ points: roads.get(l.shortName) ?? [f.board, ...l.next] });
      mk.push({ key: `board-${f.board.id}`, at: f.board, node: <StopDot on tint={color.ink} /> });
      for (const s of candidates) mk.push({ key: s.id, at: s, node: <StopDot big={hot === s.id} />, sig: hot === s.id ? 'big' : '', onPress: () => getOff(s) });
    } else {
      // The pin floats: every stop and station around it can be tapped, metro stations in their colour.
      for (const s of candidates) {
        const metro = s.mode === 'SUBWAY';
        const on = s.id === lastOff?.id;
        const tint = metro ? kindColor.metro : color.ink;
        mk.push({ key: s.id, at: s, node: <StopDot big={hot === s.id || metro} on={on && hot !== s.id} tint={tint} />, sig: `${hot === s.id ? 'big' : ''}${on ? 'on' : ''}`, onPress: () => dropOnStop(s) });
      }
    }
    return { routes: rt, markers: mk };
  }, [f, rows, shapes, net, onward, roads, candidates, hot, lastOff]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSheet = (e: LayoutChangeEvent) => {
    const h = Math.round(e.nativeEvent.layout.height / 8) * 8;
    if (h !== sheetH) setSheetH(h);
  };
  // The sheet's height bounds: a set share of the screen, and always room for the map, the pin and the buttons above it.
  const maxSheet = Math.max(MIN_SHEET, Math.min(win.height * MAX_SHEET, win.height - insets.top - 200));

  // ——— What the pin's button does now. ———
  const sameStop = hotStop && hotStop.id === lastOff?.id && phase === 'floating';
  let main: { label: string; onPress: () => void; disabled?: boolean } | null = null;
  // A metro trip onto another line: where the change is (the rides are put in on Get off).
  const change = phase === 'awaitingOff' && hotStop && net && f.board ? metroRides(net, f.board.id, hotStop.id) : null;
  const via = change && change.length > 1 ? ` (change at ${change.slice(0, -1).map((r) => r.off.name).join(', ')})` : '';
  if (phase === 'awaitingOff') main = { label: hotStop ? `Get off at ${hotStop.name}` : 'Move the pin onto a stop', onPress: () => hotStop && getOff(hotStop), disabled: !hotStop || !lines };
  else if (hotStop) main = { label: sameStop ? `Change here at ${hotStop.name}` : `Board at ${hotStop.name}`, onPress: () => dropOnStop(hotStop) };
  else if (groundOk(f)) main = { label: phase === 'first' ? 'Walk starts here' : phase === 'walkEnd' ? 'Walk ends here' : 'Walk to here', onPress: dropOnGround, disabled: address.loading || naming || (phase === 'walkEnd' && !!f.start && distM(pinAt, f.start) < 30) };
  else main = { label: 'Move the pin onto a stop', onPress: () => {}, disabled: true };

  // The row to keep in view: the ride being built or replaced, else an open ride, else the newest row.
  const active = rows.findIndex((r) => r.kind === 'boarding' || (r.kind === 'ride' && r.replacing));
  const openRow = open === null ? -1 : rows.findIndex((r) => r.kind === 'ride' && r.index === open);
  const keep = active >= 0 ? active : openRow >= 0 ? openRow : rows.length - 1;
  const pending = phase === 'awaitingOff' || phase === 'insertBoard';

  return (
    <View style={styles.screen}>
      <MapCanvas
        ref={map}
        style={StyleSheet.absoluteFill}
        start={{ center: startAt, zoom: 15.5 }}
        routes={routes}
        markers={markers}
        pin
        onMove={onMove}
        onIdle={onIdle}
        onMoveStart={onMoveStart}
        inset={{ top: insets.top + 64, bottom: Math.max(MIN_SHEET, sheetH) }}
      />
      <View style={[styles.floating, { top: insets.top + 12 }]} pointerEvents="box-none">
        <MapButton icon="back" label="Back" onPress={() => router.back()} />
      </View>
      {/* My location, as on the place picker: just above the sheet, in every step. */}
      <View style={[styles.locateWrap, { bottom: sheetH + 12 }]} pointerEvents="box-none">
        <MapButton icon="locate" label="My location" onPress={locate} style={locating && styles.busy} />
      </View>

      <Animated.View
        onLayout={onSheet}
        entering={FadeInDown.springify().damping(spring.sheet.damping).stiffness(spring.sheet.stiffness)}
        style={[styles.sheet, { paddingBottom: insets.bottom + 12, maxHeight: maxSheet }]}
      >
        {/* Header: what the pin does now. Never shrinks. */}
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <Text variant="label16" numberOfLines={1} style={styles.flex}>
              {TITLE[phase]}
            </Text>
            {b.past.length > 0 && (
              <Tap onPress={undo} hitSlop={8} haptic="none" style={styles.undo} accessibilityRole="button" accessibilityLabel="Undo the last change">
                <Icon name="back" size={16} />
                <Text variant="label14">Undo</Text>
              </Tap>
            )}
          </View>
          <Animated.View key={phase} entering={FadeIn.duration(160)}>
            <Text variant="body14" color={color.textSecondary} numberOfLines={2}>
              {HINT[phase]}
            </Text>
          </Animated.View>
        </View>

        {/* The rail: takes the room left and scrolls, keeping the active row in view. */}
        <BuildRail
          rows={rows}
          keep={keep}
          open={open}
          hotName={phase === 'awaitingOff' && hotStop ? `${hotStop.name}${via}` : null}
          editable={phase === 'floating'}
          onOpen={(i) => setOpen((o) => (o === i ? null : i))}
          onToggle={(i, label) => (haptic('selection'), act((x) => toggleRideLine(x, i, label)))}
          onReplace={(i) => (haptic('selection'), setOpen(null), act((x) => replaceAt(x, i)), map.current?.flyTo(f.rides[i].board, 15.5))}
          onRemove={(i) => (haptic('selection'), setOpen(null), act((x) => removeRide(x, i)))}
          onInsert={(i) => (haptic('selection'), setOpen(null), act((x) => insertAt(x, i)), map.current?.flyTo(f.rides[i - 1]?.off ?? f.rides[i].board, 15.5))}
        >
          {phase === 'awaitingOff' && !lines && !linesError && <Busy label="Loading the lines at this stop…" />}
          {phase === 'awaitingOff' && linesError && (
            <View style={styles.row}>
              <Text variant="body14" color={color.textSecondary} style={styles.flex}>
                Can't load the lines for this stop right now.
              </Text>
              <Button label="Try again" kind="secondary" onPress={retryLines} haptic="none" style={styles.slim} />
            </View>
          )}
          {across && <Button label="Other direction: board across the road" kind="secondary" onPress={boardAcross} haptic="none" style={styles.slim} />}
          {phase !== 'awaitingOff' && !nearby.stops.length && (nearby.loading ? <Busy label="Loading stops…" /> : nearby.error ? <Button label="Can't load stops. Try again" kind="secondary" onPress={nearby.retry} haptic="none" style={styles.slim} /> : null)}
          {metroNear && (
            <Button label={`Metro ${metroNear.s.name} · ${distanceLabel(metroNear.d)}`} icon="metro" kind="secondary" onPress={() => map.current?.flyTo(metroNear.s, 16.2)} haptic="none" style={styles.slim} />
          )}
          {phase === 'floating' && f.rides.length > 0 && <Preview it={it} plan={plan} />}
          {ending && (
            <Text variant="caption" color={color.textSecondary} numberOfLines={1}>
              Destination: {ending.to.label}
            </Text>
          )}
        </BuildRail>

        {/* Footer: the pin's action, then leave or finish. Never shrinks, never overlaps the rail. */}
        <View style={styles.footer}>
          {main && <Button label={main.label} onPress={main.onPress} disabled={main.disabled} haptic="none" />}
          <View style={styles.footRow}>
            {pending ? (
              <Button label="Cancel this ride" kind="secondary" onPress={() => (haptic('selection'), act(cancelRide))} haptic="none" style={styles.footBtn} />
            ) : (
              <Button label="Cancel" kind="secondary" onPress={() => router.back()} haptic="none" style={styles.footBtn} />
            )}
            <Button label="Done" onPress={done} disabled={!canFinish(f)} haptic="none" style={styles.footBtn} />
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

/** When to leave for the rides built so far. */
function Preview({ it, plan }: { it: Itinerary | null; plan: ReturnType<typeof useTripPlan> }) {
  if (it) {
    return (
      <View style={styles.preview}>
        <LineChain slots={slotsFor(it, plan.itineraries)} size="sm" />
        <Text variant="caption" color={color.textSecondary} style={styles.flex}>
          Board around {hhmm(leaveAt(it, settings.get().bufferMin))} · arrive {hhmm(it.arriveAt)}
        </Text>
      </View>
    );
  }
  if (plan.error) return <Text variant="caption" color={color.textSecondary}>Can't reach the planner right now.</Text>;
  if (plan.loaded && !plan.refreshing) return <Text variant="caption" color={color.textSecondary}>No ride fits these stops at that time.</Text>;
  return <Busy label="Checking every line…" />;
}

const styles = StyleSheet.create({
  header: { gap: 4, paddingBottom: 10, flexShrink: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 32 },
  undo: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface, ...shadow.soft },
  screen: { flex: 1, backgroundColor: color.bg },
  floating: { position: 'absolute', left: 12 },
  locateWrap: { position: 'absolute', right: 12 },
  busy: { opacity: 0.6 },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'column', backgroundColor: color.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: gutter, paddingTop: 16, ...shadow.bar },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  slim: { height: 44 },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  footer: { gap: 8, paddingTop: 10, flexShrink: 0, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.border },
  footRow: { flexDirection: 'row', gap: 8 },
  footBtn: { flex: 1, height: 48 },
});

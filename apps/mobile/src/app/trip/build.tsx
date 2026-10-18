import type { Itinerary, JourneyStep, StopHit } from '@transit/shared';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { finishSteps, stepsDraft } from '../../lib/handoff';
import { distM, rideFromStep, stepOf } from '../../lib/chain';
import {
  builder, cancelRide, canFinish, commit, endsOf, finish, groundOk, initFlow, insertAt, phaseOf, pinDropped, reachableFrom,
  removeRide, replaceAt, rideEnded, rowsOf, seeded, toggleRideLine, undo as undoFlow, type Flow, type Phase,
} from '../../lib/buildFlow';
import { kindOf, leaveAt } from '../../lib/plans';
import { locateMe } from '../../lib/locate';
import { settings } from '../../lib/settings';
import { distanceLabel } from '../../lib/stops';
import { hhmm, nextArriveBy } from '../../lib/time';
import { decodePolyline } from '../../lib/mapMath';
import { useNow } from '../../lib/useNow';
import { useRideShapes } from '../../lib/shapes';
import { useTripPlan } from '../../lib/useTripPlan';
import { useAddress, useLines, useStopsNear } from '../../lib/useStopData';
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
/** The sheet is at least this tall; the map's middle (and the pin) sit above whatever it covers. */
const MIN_SHEET = 290;
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

  useEffect(() => () => finishSteps(null), []);

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
  const reachable = useMemo(() => (f.board && lines ? reachableFrom(f.board, lines) : []), [f.board, lines]);

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
  const snapped = useRef<string | null>(null); // one pull per stop, so it can never loop
  const stopAt = (c: Point, zoom: number) => {
    const reach = SNAP_PT * metresPerPoint(c.lat, zoom);
    let best: { s: StopHit; d: number } | null = null;
    for (const s of candRef.current) {
      if (s.id === boardRef.current?.id) continue;
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
  const onMove = (c: Point, zoom: number) => mark(stopAt(c, zoom)?.s.id ?? null);
  const onIdle = (c: Point, zoom: number) => {
    const s = stopAt(c, zoom);
    mark(s?.s.id ?? null);
    if (s && s.pt > 1.5 && s.s.id !== snapped.current) {
      snapped.current = s.s.id;
      map.current?.flyTo(s.s, zoom); // eases the pin onto the stop; the next idle reports the stop itself
      return;
    }
    if (!s) snapped.current = null;
    setCentre(c);
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
  const dropOnGround = () => {
    haptic('selection');
    setOpen(null);
    act((x) => pinDropped(x, { lat: pinAt.lat, lon: pinAt.lon, label: address.name ?? 'Dropped pin' }, null));
  };
  const getOff = (s: StopHit) => {
    if (!lines) return;
    haptic('success');
    act((x) => rideEnded(x, s, lines));
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
    const at = await locateMe();
    if (typeof at === 'object') map.current?.flyTo(at, 16);
  };

  /** A metro station near the bus stop you got off at: a shortcut that puts the pin on its dot (you still board with a tap). */
  const metroNear = useMemo(() => {
    if (phase !== 'floating' || !lastOff || lastOff.mode === 'SUBWAY') return null;
    const m = nearby.stops.filter((s) => s.mode === 'SUBWAY' && s.id !== lastOff.id).map((s) => ({ s, d: distM(lastOff, s) })).sort((x, y) => x.d - y.d)[0];
    return m && m.d <= METRO_NEAR_M && m.s.id !== hot ? m : null;
  }, [phase, lastOff, nearby.stops, hot]);

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
      // Only now are lines black: every line onward from the boarding stop, and the stops they reach.
      for (const l of lines ?? []) rt.push({ points: [f.board, ...l.next] });
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
  }, [f, rows, shapes, lines, candidates, hot, lastOff]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSheet = (e: LayoutChangeEvent) => {
    const h = Math.max(MIN_SHEET, Math.round(e.nativeEvent.layout.height / 8) * 8);
    if (h !== sheetH) setSheetH(h);
  };

  // ——— What the pin's button does now. ———
  const sameStop = hotStop && hotStop.id === lastOff?.id && phase === 'floating';
  let main: { label: string; onPress: () => void; disabled?: boolean } | null = null;
  if (phase === 'awaitingOff') main = { label: hotStop ? `Get off at ${hotStop.name}` : 'Move the pin onto a stop', onPress: () => hotStop && getOff(hotStop), disabled: !hotStop || !lines };
  else if (hotStop) main = { label: sameStop ? `Change here at ${hotStop.name}` : `Board at ${hotStop.name}`, onPress: () => dropOnStop(hotStop) };
  else if (groundOk(f)) main = { label: phase === 'first' ? 'Walk starts here' : phase === 'walkEnd' ? 'Walk ends here' : 'Walk to here', onPress: dropOnGround, disabled: address.loading || (phase === 'walkEnd' && !!f.start && distM(pinAt, f.start) < 30) };
  else main = { label: 'Move the pin onto a stop', onPress: () => {}, disabled: true };

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
        inset={{ top: insets.top + 64, bottom: sheetH }}
      />
      <View style={[styles.floating, { top: insets.top + 12 }]} pointerEvents="box-none">
        <MapButton icon="back" label="Back" onPress={() => router.back()} />
        <MapButton icon="locate" label="Go to my location" onPress={locate} />
      </View>

      <Animated.View
        onLayout={onSheet}
        entering={FadeInDown.springify().damping(spring.sheet.damping).stiffness(spring.sheet.stiffness)}
        style={[styles.sheet, { paddingBottom: insets.bottom + 16, minHeight: MIN_SHEET }]}
      >
        <View style={styles.header}>
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

        {rows.length > 0 && (
          <BuildRail
            rows={rows}
            open={open}
            hotName={phase === 'awaitingOff' ? (hotStop?.name ?? null) : null}
            editable={phase === 'floating'}
            onOpen={(i) => setOpen((o) => (o === i ? null : i))}
            onToggle={(i, label) => (haptic('selection'), act((x) => toggleRideLine(x, i, label)))}
            onReplace={(i) => (haptic('selection'), setOpen(null), act((x) => replaceAt(x, i)), map.current?.flyTo(f.rides[i].board, 15.5))}
            onRemove={(i) => (haptic('selection'), setOpen(null), act((x) => removeRide(x, i)))}
            onInsert={(i) => (haptic('selection'), setOpen(null), act((x) => insertAt(x, i)), map.current?.flyTo(f.rides[i - 1]?.off ?? f.rides[i].board, 15.5))}
          />
        )}

        <Animated.View key={phase} entering={FadeIn.duration(160)} style={styles.gap}>
          <Text variant="body14" color={color.textSecondary}>
            {HINT[phase]}
          </Text>
          {phase === 'awaitingOff' && !lines && !linesError && <Busy label="Loading the lines at this stop…" />}
          {phase === 'awaitingOff' && linesError && (
            <View style={styles.row}>
              <Text variant="body14" color={color.textSecondary} style={styles.flex}>
                Can't load the lines for this stop right now.
              </Text>
              <Button label="Try again" kind="secondary" onPress={retryLines} haptic="none" style={styles.slim} />
            </View>
          )}
          {phase !== 'awaitingOff' && !nearby.stops.length && (nearby.loading ? <Busy label="Loading stops…" /> : nearby.error ? <Button label="Can't load stops. Try again" kind="secondary" onPress={nearby.retry} haptic="none" /> : null)}
          {main && <Button label={main.label} onPress={main.onPress} disabled={main.disabled} haptic="none" />}
          {metroNear && (
            <Button label={`Metro ${metroNear.s.name} · ${distanceLabel(metroNear.d)}`} icon="metro" kind="secondary" onPress={() => map.current?.flyTo(metroNear.s, 16.2)} haptic="none" />
          )}
          {(phase === 'awaitingOff' || phase === 'insertBoard') && <Button label="Cancel this ride" kind="secondary" onPress={() => act(cancelRide)} haptic="none" style={styles.slim} />}
        </Animated.View>

        {phase === 'floating' && f.rides.length > 0 && <Preview it={it} plan={plan} />}

        <View style={styles.footer}>
          <Button label="Cancel" kind="secondary" onPress={() => router.back()} haptic="none" style={styles.footBtn} />
          <Button label="Done" onPress={done} disabled={!canFinish(f)} haptic="none" style={styles.footBtn} />
        </View>
        {ending && (
          <Text variant="caption" color={color.textSecondary} numberOfLines={1}>
            Destination: {ending.to.label}
          </Text>
        )}
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
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 10 },
  undo: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface, ...shadow.soft },
  screen: { flex: 1, backgroundColor: color.bg },
  floating: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '62%', backgroundColor: color.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: gutter, paddingTop: 16, ...shadow.bar },
  gap: { gap: 8, flexShrink: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  slim: { height: 44 },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 8 },
  footer: { flexDirection: 'row', gap: 8, paddingTop: 10, paddingBottom: 4 },
  footBtn: { flex: 1, height: 48 },
});

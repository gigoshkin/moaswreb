import type { JourneyStep, StopHit, StopLine } from '@transit/shared';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { nearStops, searchStops, stopLines } from '../../lib/api';
import { finishSteps, stepsDraft } from '../../lib/handoff';
import { distanceLabel } from '../../lib/stops';
import { isMetro, leaveAt, transitLegs } from '../../lib/plans';
import { settings } from '../../lib/settings';
import { hhmm, nextArriveBy } from '../../lib/time';
import { useNow } from '../../lib/useNow';
import { useTripPlan } from '../../lib/useTripPlan';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { MapCanvas, type MapCanvasHandle, type MapMarker } from '../../ui/MapCanvas';
import { StopDot } from '../../ui/MapMarks';
import { RoutePlate } from '../../ui/RoutePlate';
import { Tap, haptic } from '../../ui/Tap';
import { Text } from '../../ui/Text';
import { MapButton } from '../../ui/kit';
import { overlay } from '../../ui/overlay';
import { color, font, gutter, radius, shadow, spring } from '../../ui/theme';

const TBILISI = { lat: 41.7151, lon: 44.793 };
const distM = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const rad = Math.PI / 180;
  return Math.hypot((b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad), (b.lat - a.lat) * rad) * 6_371_000;
};

/**
 * Build the route by hand: board at a stop, see every line there, get off at a
 * stop, then another ride or the walk to the end. A ride keeps all the lines
 * that fit (untick the ones you never want); the planner then compares them
 * link by link, with live arrivals, like any other trip.
 */
export default function BuildRoute() {
  const insets = useSafeAreaInsets();
  const now = useNow(30_000);
  const [init] = useState(stepsDraft);
  const map = useRef<MapCanvasHandle>(null);
  const [steps, setSteps] = useState<JourneyStep[]>(init?.steps ?? []);
  const [sheetH, setSheetH] = useState(280);
  // Where the next ride starts looking for stops: the end of the last one.
  const [anchor, setAnchor] = useState<StopHit | null>(null);
  const [board, setBoard] = useState<StopHit | null>(null);
  const [adding, setAdding] = useState(!init?.steps.length);

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
  const rides = it ? transitLegs(it) : [];
  const here = anchor ?? (rides.length ? { ...rides.at(-1)!.to } : null) ?? from;

  const { routes, markers: planMarkers, points } = useMemo(() => overlay(from, to, it), [it]);
  const markers: MapMarker[] = useMemo(() => (board ? [...planMarkers, { key: 'board', at: board, node: <StopDot /> }] : planMarkers), [planMarkers, board]);

  const fitKey = `${it?.id ?? ''}|${board?.id ?? ''}`;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const pts = [...points, ...(board ? [board] : [])];
    if (pts.length) map.current?.fit(pts);
  }, [fitKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const addRide = (b: StopHit, a: StopHit, lines: string[] | undefined) => {
    haptic('success');
    setSteps((s) => [...s, { fromStops: [b.id], toStops: [a.id], ...(lines?.length ? { routes: lines } : {}) }]);
    setAnchor(a);
    setBoard(null);
    setAdding(false);
  };

  const done = () => {
    haptic('success');
    finishSteps(steps.length ? steps : null);
    router.back();
  };

  const start = points.length ? { fit: points } : { center: here, zoom: 15 };

  return (
    <View style={styles.screen}>
      <MapCanvas ref={map} style={StyleSheet.absoluteFill} start={start} routes={routes} markers={markers} inset={{ top: insets.top + 64, bottom: sheetH }} />
      <View style={[styles.floating, { top: insets.top + 12 }]} pointerEvents="box-none">
        <MapButton icon="back" label="Back" onPress={() => router.back()} />
      </View>

      <Animated.View
        entering={FadeInDown.springify().damping(spring.smooth.damping).stiffness(spring.smooth.stiffness)}
        layout={LinearTransition.springify().damping(spring.smooth.damping).stiffness(spring.smooth.stiffness)}
        style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}
        onLayout={(e) => setSheetH(e.nativeEvent.layout.height)}
      >
        {adding ? (
          board ? (
            <GetOff board={board} to={to} onBack={() => setBoard(null)} onPick={addRide} />
          ) : (
            <BoardAt near={here} onPick={setBoard} first={steps.length === 0} onCancel={steps.length ? () => setAdding(false) : undefined} />
          )
        ) : (
          <View style={styles.gap}>
            <Text variant="title18">Your route</Text>
            {it ? (
              <View style={styles.gap}>
                {rides.map((l, i) => (
                  <View key={i} style={styles.rideRow}>
                    <RoutePlate label={l.route?.shortName ?? l.mode} metro={isMetro(l)} size="md" />
                    <Text variant="body14" style={styles.flex} numberOfLines={1}>
                      {l.from.name} → {l.to.name}
                    </Text>
                  </View>
                ))}
                <Text variant="caption" color={color.textSecondary}>
                  Leave around {hhmm(leaveAt(it, settings.get().bufferMin))} · arrive {hhmm(it.arriveAt)}
                </Text>
              </View>
            ) : (
              <Text variant="body14" color={color.textSecondary}>
                {plan.error ? "Can't reach the planner right now." : plan.loaded ? 'No ride fits these stops at that time.' : 'Checking every line…'}
              </Text>
            )}
            <View style={styles.actions}>
              <Button label="Add another ride" kind="secondary" onPress={() => setAdding(true)} haptic="none" />
              {steps.length > 0 && <Button label="Remove last ride" kind="secondary" onPress={() => { setSteps((s) => s.slice(0, -1)); setAnchor(null); }} haptic="none" />}
              <Button label="Done" onPress={done} disabled={!steps.length} haptic="none" />
            </View>
          </View>
        )}
      </Animated.View>
    </View>
  );
}

/** Step 1 of a ride: pick the stop to board at (the nearest ones, or search). */
function BoardAt({ near, onPick, first, onCancel }: { near: { lat: number; lon: number }; onPick: (s: StopHit) => void; first: boolean; onCancel?: () => void }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<StopHit[]>([]);
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    let live = true;
    setBusy(true);
    const run = q.trim().length >= 2 ? searchStops(q.trim(), 'en', 12) : nearStops(near, { radiusM: 700, limit: 14 });
    run.then(
      (r) => live && (setList(r), setBusy(false)),
      () => live && (setList([]), setBusy(false)),
    );
    return () => {
      live = false;
    };
  }, [q, near.lat, near.lon]);
  return (
    <View style={styles.gap}>
      <View style={styles.titleRow}>
        <Text variant="title18" style={styles.flex}>
          {first ? 'Where do you board?' : 'Where do you board next?'}
        </Text>
        {onCancel && (
          <Tap onPress={onCancel} hitSlop={8}>
            <Text variant="label14" color={color.textSecondary}>
              Cancel
            </Text>
          </Tap>
        )}
      </View>
      <View style={styles.search}>
        <Icon name="search" size={20} color={color.textSecondary} />
        <TextInput value={q} onChangeText={setQ} placeholder="Stop name or number" placeholderTextColor={color.textSecondary} style={styles.input} autoCorrect={false} maxFontSizeMultiplier={1.15} />
      </View>
      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {busy && <Text variant="body14" color={color.textSecondary}>Looking…</Text>}
        {!busy && !list.length && <Text variant="body14" color={color.textSecondary}>No stops found.</Text>}
        {list.map((s) => (
          <Tap key={s.id} onPress={() => onPick(s)} feedback="tint" style={styles.row} accessibilityRole="button">
            <Icon name={s.mode === 'SUBWAY' ? 'metro' : 'bus'} size={20} />
            <Text variant="label16" style={styles.flex} numberOfLines={1}>
              {s.name}
            </Text>
            <Text variant="caption" color={color.textSecondary}>
              {distanceLabel(distM(near, s))}
            </Text>
          </Tap>
        ))}
      </ScrollView>
    </View>
  );
}

/** Step 2: the lines at the stop (untick any you never want) and where each can take you. */
function GetOff({ board, to, onBack, onPick }: { board: StopHit; to: { lat: number; lon: number; label: string }; onBack: () => void; onPick: (b: StopHit, a: StopHit, lines: string[] | undefined) => void }) {
  const [lines, setLines] = useState<StopLine[] | null>(null);
  const [error, setError] = useState(false);
  const [off, setOff] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    stopLines(board.id).then(
      (r) => live && setLines(r.lines),
      () => live && setError(true),
    );
    return () => {
      live = false;
    };
  }, [board.id]);

  const names = useMemo(() => [...new Set((lines ?? []).map((l) => l.shortName))], [lines]);
  // Stops reachable on the lines that are on, with which of them get there; closest to the destination first.
  const stops = useMemo(() => {
    const m = new Map<string, { stop: StopHit; lines: Set<string> }>();
    for (const l of lines ?? []) {
      if (off.includes(l.shortName)) continue;
      for (const s of l.next) {
        const e = m.get(s.id) ?? { stop: { id: s.id, name: s.name, lat: s.lat, lon: s.lon, mode: l.mode }, lines: new Set<string>() };
        e.lines.add(l.shortName);
        m.set(s.id, e);
      }
    }
    return [...m.values()].sort((a, b) => distM(a.stop, to) - distM(b.stop, to)).slice(0, 60);
  }, [lines, off, to]);

  return (
    <View style={styles.gap}>
      <View style={styles.titleRow}>
        <Text variant="title18" style={styles.flex} numberOfLines={1}>
          Board at {board.name}
        </Text>
        <Tap onPress={onBack} hitSlop={8}>
          <Text variant="label14" color={color.textSecondary}>
            Change
          </Text>
        </Tap>
      </View>
      {!lines && !error && <Animated.View entering={FadeIn}><Text variant="body14" color={color.textSecondary}>Loading the lines at this stop…</Text></Animated.View>}
      {error && <Text variant="body14" color={color.textSecondary}>Can't load the lines for this stop right now.</Text>}
      {lines && (
        <>
          <Text variant="caption" color={color.textSecondary}>
            Lines here. Tap one to leave it out.
          </Text>
          <View style={styles.plates}>
            {names.map((n) => (
              <Tap key={n} onPress={() => setOff((o) => (o.includes(n) ? o.filter((x) => x !== n) : [...o, n]))} haptic="selection" style={off.includes(n) ? styles.off : undefined} accessibilityRole="checkbox" accessibilityState={{ checked: !off.includes(n) }} accessibilityLabel={`Line ${n}`}>
                <RoutePlate label={n} size="md" />
              </Tap>
            ))}
          </View>
          <Text variant="label14">Get off at</Text>
          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {stops.map(({ stop, lines: ls }) => (
              <Tap key={stop.id} onPress={() => onPick(board, stop, off.length ? [...ls] : undefined)} feedback="tint" style={styles.row} accessibilityRole="button">
                <View style={styles.flex}>
                  <Text variant="label16" numberOfLines={1}>
                    {stop.name}
                  </Text>
                  <Text variant="caption" color={color.textSecondary} numberOfLines={1}>
                    {[...ls].join(' · ')} · {distanceLabel(distM(stop, to))} from the end
                  </Text>
                </View>
                <Icon name="chevron-right" size={18} color={color.textSecondary} />
              </Tap>
            ))}
          </ScrollView>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  floating: { position: 'absolute', left: 12 },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '62%', backgroundColor: color.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: gutter, paddingTop: 16, ...shadow.bar },
  gap: { gap: 10, flexShrink: 1 },
  flex: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: color.surfaceMuted, borderRadius: radius.md, paddingHorizontal: 14, height: 46 },
  input: { flex: 1, fontFamily: font.regular, fontSize: 15, color: color.text, paddingVertical: 0, includeFontPadding: false },
  list: { flexGrow: 0, maxHeight: 320 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  plates: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  off: { opacity: 0.3 },
  rideRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actions: { gap: 8, paddingTop: 4 },
});

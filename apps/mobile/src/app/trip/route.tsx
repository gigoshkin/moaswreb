import type { Itinerary, JourneyStep, PlanAvoid } from '@transit/shared';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { buildSteps, finishRoute, pickPlace, routeDraft, type PickKind } from '../../lib/handoff';
import { firstWalkMin, isMetro, leaveAt, transitLegs } from '../../lib/plans';
import { settings } from '../../lib/settings';
import { hhmm, nextArriveBy } from '../../lib/time';
import type { Place } from '../../lib/trips';
import { useNow } from '../../lib/useNow';
import { useTripPlan } from '../../lib/useTripPlan';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Options } from '../../ui/Options';
import { MapCanvas, type MapCanvasHandle } from '../../ui/MapCanvas';
import { overlay } from '../../ui/overlay';

import { RoutePlate } from '../../ui/RoutePlate';
import { Tap, haptic } from '../../ui/Tap';
import { Text } from '../../ui/Text';
import { MapButton } from '../../ui/kit';
import { color, gutter, radius, shadow, spring } from '../../ui/theme';

const TBILISI = { lat: 41.7151, lon: 44.793 };

/** Taxi-style route builder: the map with From / To at the bottom and the planned route drawn on it. */
export default function RouteBuilder() {
  const insets = useSafeAreaInsets();
  const now = useNow(30_000);
  const [init] = useState(routeDraft);
  const [from, setFrom] = useState<Place | null>(init.from);
  const [to, setTo] = useState<Place | null>(init.to);
  const [avoid, setAvoid] = useState<PlanAvoid | undefined>(init.avoid);
  const [steps, setSteps] = useState<JourneyStep[] | undefined>(init.steps);
  const [showOptions, setShowOptions] = useState(false);
  const [sheetH, setSheetH] = useState(230);
  const map = useRef<MapCanvasHandle>(null);

  // Closing without Done resolves the form with null.
  useEffect(() => () => finishRoute(null), []);

  const trip = useMemo(() => (from && to ? { id: 'draft', name: '', from, to, arriveBy: init.arriveBy, days: init.days, avoid, steps } : null), [from, to, init.arriveBy, init.days, JSON.stringify(avoid), JSON.stringify(steps)]);
  const date = nextArriveBy(init.arriveBy, init.days, now).slice(0, 10);
  const plan = useTripPlan(trip, date, now);
  const it: Itinerary | null = plan.choice.kind === 'none' ? (plan.itineraries[0] ?? null) : plan.choice.it;

  const pick = async (kind: PickKind) => {
    const p = await pickPlace(kind, { near: (kind === 'from' ? to : from) ?? undefined });
    if (p) {
      (kind === 'from' ? setFrom : setTo)(p);
      setSteps(undefined); // a hand-built route belongs to its two ends
    }
  };

  // Like a taxi app: opens straight into "where to?".
  useEffect(() => {
    if (!init.from) pick('from');
    else if (!init.to) pick('to');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { routes, markers, points } = useMemo(() => overlay(from, to, it), [from, to, it]);

  // Frame the whole route whenever it changes (not on the first frame: the map starts framed).
  const fitKey = `${from?.lat},${from?.lon}|${to?.lat},${to?.lon}|${it?.id ?? ''}`;
  const firstFit = useRef(true);
  useEffect(() => {
    if (firstFit.current) {
      firstFit.current = false;
      return;
    }
    if (points.length) map.current?.fit(points);
  }, [fitKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const swap = () => {
    haptic('selection');
    setFrom(to);
    setTo(from);
    setSteps(undefined);
  };

  const finish = () => {
    if (!from || !to) return;
    haptic('success');
    finishRoute({ from, to, avoid, steps });
    router.back();
  };

  const start = points.length ? { fit: points } : { center: from ?? to ?? TBILISI, zoom: 14.5 };

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
        <View style={styles.ends}>
          <View style={styles.rail}>
            <View style={styles.railDot} />
            <View style={styles.railLine} />
            <Icon name="pin" size={20} color={color.ink} />
          </View>
          <View style={styles.rows}>
            <EndRow label="From" value={from?.label} empty="Choose start" onPress={() => pick('from')} divider />
            <EndRow label="To" value={to?.label} empty="Choose destination" onPress={() => pick('to')} />
          </View>
          {from && to && (
            <Animated.View entering={FadeIn.duration(150)} style={styles.swapWrap}>
              <Tap onPress={swap} scaleTo={0.9} hitSlop={8} style={styles.swap} accessibilityRole="button" accessibilityLabel="Swap start and destination">
                <Icon name="swap" size={20} />
              </Tap>
            </Animated.View>
          )}
        </View>

        {trip && (
          <Animated.View entering={FadeIn.duration(180)} style={styles.gap}>
            <Summary it={it} loaded={plan.loaded} error={plan.error} />
            <View style={styles.links}>
              <Tap onPress={() => setShowOptions((v) => !v)} hitSlop={8} accessibilityRole="button">
                <Text variant="label14">{showOptions ? 'Hide other ways' : `Compare all ways${plan.itineraries.length ? ` (${plan.itineraries.length})` : ''}`}</Text>
              </Tap>
              <Tap
                onPress={async () => {
                  const r = await buildSteps({ from: from!, to: to!, arriveBy: init.arriveBy, days: init.days, steps: steps ?? [], avoid });
                  if (r) setSteps(r);
                }}
                hitSlop={8}
                accessibilityRole="button"
              >
                <Text variant="label14">{steps?.length ? 'Edit rides by hand' : 'Build by hand'}</Text>
              </Tap>
            </View>
            {showOptions && (
              <ScrollView style={styles.options} showsVerticalScrollIndicator={false}>
                <Options
                  itineraries={plan.itineraries}
                  chosenId={plan.choice.kind === 'none' ? undefined : plan.choice.it.id}
                  now={now}
                  bufferMin={settings.get().bufferMin}
                  avoid={avoid}
                  loading={!plan.loaded && !plan.error}
                  onAvoid={setAvoid}
                />
              </ScrollView>
            )}
            {steps?.length ? (
              <Text variant="caption" color={color.textSecondary}>
                Hand-built route. The app still compares every line that fits each ride.
              </Text>
            ) : null}
          </Animated.View>
        )}

        <Button label="Done" onPress={finish} disabled={!from || !to} haptic="none" />
      </Animated.View>
    </View>
  );
}

function EndRow({ label, value, empty, onPress, divider }: { label: string; value?: string; empty: string; onPress: () => void; divider?: boolean }) {
  return (
    <Tap onPress={onPress} feedback="tint" style={[styles.endRow, divider && styles.endRowDivider]} accessibilityRole="button" accessibilityLabel={`${label}: ${value ?? 'not set'}`}>
      <Text variant="label16" color={value ? color.text : color.textSecondary} numberOfLines={1}>
        {value ?? empty}
      </Text>
      {divider && <View style={styles.divider} />}
    </Tap>
  );
}

/** What the app will use for this trip: the plates, when to leave, when you get there. */
function Summary({ it, loaded, error }: { it: Itinerary | null; loaded: boolean; error: string | null }) {
  const bufferMin = settings.use().bufferMin;
  if (!it) {
    return (
      <View style={styles.summary}>
        <Text variant="body14" color={color.textSecondary}>
          {error ? "Can't reach the planner right now." : loaded ? 'No bus or metro route found for this trip.' : 'Finding a route…'}
        </Text>
      </View>
    );
  }
  const legs = transitLegs(it);
  const min = Math.max(1, Math.round(it.durationSec / 60));
  return (
    <View style={styles.summary}>
      <View style={styles.summaryTop}>
        {legs.slice(0, 3).map((l, i) => (
          <RoutePlate key={i} label={l.route?.shortName ?? l.mode} metro={isMetro(l)} size="md" />
        ))}
        <Text variant="label16" style={styles.flex} numberOfLines={1}>
          Leave around {hhmm(leaveAt(it, bufferMin))}
        </Text>
      </View>
      <Text variant="caption" color={color.textSecondary}>
        Arrive {hhmm(it.arriveAt)} · {min} min{firstWalkMin(it) > 0 ? ` · ${firstWalkMin(it)} min walk first` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  floating: { position: 'absolute', left: 12 },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: color.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: gutter, paddingTop: 16, gap: 12, ...shadow.bar },
  ends: { flexDirection: 'row', alignItems: 'stretch', gap: 12, backgroundColor: color.surfaceMuted, borderRadius: radius.md, paddingLeft: 14, overflow: 'hidden' },
  rail: { width: 20, alignItems: 'center', paddingVertical: 20 },
  railDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: color.ink },
  railLine: { flex: 1, width: 2, borderRadius: 1, backgroundColor: color.border, marginVertical: 4 },
  rows: { flex: 1 },
  endRow: { height: 52, justifyContent: 'center', paddingRight: 56 },
  endRowDivider: {},
  divider: { position: 'absolute', left: 0, right: 56, bottom: 0, height: StyleSheet.hairlineWidth * 2, backgroundColor: color.border },
  swapWrap: { position: 'absolute', right: 8, top: 0, bottom: 0, justifyContent: 'center' },
  swap: { width: 40, height: 40, borderRadius: 20, backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center', ...shadow.soft },
  gap: { gap: 10 },
  links: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2 },
  options: { maxHeight: 240 },
  summary: { gap: 4, paddingHorizontal: 2 },
  summaryTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
});

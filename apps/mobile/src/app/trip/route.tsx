import type { Itinerary, PlanAvoid } from '@transit/shared';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { slotsFor, variantSteps, type RideStep } from '../../lib/ways';
import { buildSteps, finishRoute, pickPlace, routeDraft, type PickKind } from '../../lib/handoff';
import { firstWalkMin, leaveAt } from '../../lib/plans';
import { settings } from '../../lib/settings';
import { daysText, hhmm, nextArriveBy } from '../../lib/time';
import type { Place } from '../../lib/trips';
import { useNow } from '../../lib/useNow';
import { useRoadItinerary } from '../../lib/shapes';
import { useTripPlan } from '../../lib/useTripPlan';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { RideLines } from '../../ui/RideLines';
import { Ways } from '../../ui/Ways';
import { Busy } from '../../ui/Spinner';
import { LineChain } from '../../ui/LineChain';
import { MapCanvas, type MapCanvasHandle } from '../../ui/MapCanvas';
import { overlay } from '../../ui/overlay';

import { Tap, haptic } from '../../ui/Tap';
import { TimeSpinner, openTimeDialog } from '../../ui/TimePick';
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
  const [steps, setSteps] = useState<RideStep[] | undefined>(init.steps);
  const [arriveBy, setArriveBy] = useState(init.arriveBy);
  const [timeOpen, setTimeOpen] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  // The way picked in the list, as rides with the lines ticked for each: what Done hands back as the trip's route.
  const [pinned, setPinned] = useState<RideStep[] | null>(null);
  const [sheetH, setSheetH] = useState(230);
  const map = useRef<MapCanvasHandle>(null);

  // Closing without Done resolves the form with null.
  useEffect(() => () => finishRoute(null), []);

  const trip = useMemo(() => (from && to ? { id: 'draft', name: '', from, to, arriveBy, days: init.days, avoid, steps } : null), [from, to, arriveBy, init.days, JSON.stringify(avoid), JSON.stringify(steps)]);
  const date = nextArriveBy(arriveBy, init.days, now).slice(0, 10);
  const plan = useTripPlan(trip, date, now);
  const best: Itinerary | null = plan.choice.kind === 'none' ? (plan.itineraries[0] ?? null) : plan.choice.it;
  // A way tapped in the list is shown on the map; the app still uses the best one.
  const it = plan.itineraries.find((x) => x.id === picked) ?? best;
  const roadIt = useRoadItinerary(it);
  const busy = !plan.error && (!plan.loaded || plan.refreshing);

  const pick = async (kind: PickKind) => {
    const p = await pickPlace(kind, { near: (kind === 'from' ? to : from) ?? undefined });
    if (p) {
      (kind === 'from' ? setFrom : setTo)(p); // a hand-built route stays: the walk to the first stop and from the last is recomputed from the new end
    }
  };

  // Like a taxi app: opens straight into "where to?".
  useEffect(() => {
    if (!init.from) pick('from');
    else if (!init.to) pick('to');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { routes, markers, points } = useMemo(() => overlay(from, to, roadIt), [from, to, roadIt]);

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
    setPinned(null);
  };

  const buildByHand = async () => {
    if (!from || !to) return;
    const r = await buildSteps({ from, to, arriveBy, days: init.days, steps: pinned ?? steps ?? [], avoid });
    if (r) {
      setSteps(r.steps);
      setPinned(null);
    }
  };

  const finish = () => {
    if (!from || !to) return;
    haptic('success');
    // A way picked in the list is the route: it goes back as its own rides with the lines ticked for each, not just a highlight.
    finishRoute({ from, to, avoid, steps: pinned ?? steps, ...(arriveBy !== init.arriveBy ? { arriveBy } : {}) });
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
        entering={FadeInDown.springify().damping(spring.sheet.damping).stiffness(spring.sheet.stiffness)}
        layout={LinearTransition.duration(240)}
        style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}
        onLayout={(e) => setSheetH(e.nativeEvent.layout.height)}
      >
        <Tap onPress={() => (openTimeDialog(arriveBy, setArriveBy) ? undefined : setTimeOpen((v) => !v))} feedback="tint" style={styles.timeChip} accessibilityRole="button" accessibilityLabel={`Arrive by ${arriveBy}, ${daysText(init.days)}. Change`}>
          <Icon name="clock" size={16} />
          <Text variant="label14" style={styles.flex}>
            Arrive by {arriveBy} · {daysText(init.days)}
          </Text>
          <Text variant="label13" color={color.textSecondary}>
            {timeOpen ? 'Done' : 'Change'}
          </Text>
        </Tap>
        {timeOpen && <TimeSpinner value={arriveBy} onChange={setArriveBy} />}

        {from && to ? (
          // Both ends set: one row split in half, with the swap button between, and the by-hand builder under it.
          <View style={styles.gap}>
          <View style={styles.pair}>
            <Tap onPress={() => pick('from')} feedback="tint" style={styles.half} accessibilityRole="button" accessibilityLabel={`From: ${from.label}`}>
              <View style={styles.railDot} />
              <Text variant="label14" numberOfLines={1} style={styles.flex}>
                {from.label}
              </Text>
            </Tap>
            <Tap onPress={swap} scaleTo={0.9} hitSlop={8} style={styles.swapMid} accessibilityRole="button" accessibilityLabel="Swap start and destination">
              <View style={{ transform: [{ rotate: '90deg' }] }}>
                <Icon name="swap" size={18} />
              </View>
            </Tap>
            <Tap onPress={() => pick('to')} feedback="tint" style={styles.half} accessibilityRole="button" accessibilityLabel={`To: ${to.label}`}>
              <Icon name="pin" size={16} color={color.ink} />
              <Text variant="label14" numberOfLines={1} style={styles.flex}>
                {to.label}
              </Text>
            </Tap>
          </View>
          <Tap onPress={buildByHand} feedback="tint" style={styles.byHand} accessibilityRole="button" accessibilityLabel="Build the route by hand, stop by stop">
            <Icon name="map" size={18} />
            <Text variant="label14" style={styles.flex}>
              {steps?.length ? 'Change my hand-built route' : 'Build route by hand'}
            </Text>
            <Icon name="chevron-right" size={18} color={color.textTertiary} />
          </Tap>
          </View>
        ) : (
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
          </View>
        )}

        {trip && (
          <Animated.View entering={FadeIn.duration(180)} style={styles.gap}>
            <Summary it={it} all={plan.itineraries} busy={busy} error={plan.error} />
            <View style={styles.links}>
              <Tap onPress={() => setShowOptions((v) => !v)} scaleTo={0.96} style={styles.pill} accessibilityRole="button">
                <Text variant="label14">{showOptions ? 'Hide ways' : `All ways${plan.itineraries.length ? ` (${plan.itineraries.length})` : ''}`}</Text>
              </Tap>
            </View>
            {showOptions && (
              <ScrollView style={styles.options} contentContainerStyle={styles.optionsContent} showsVerticalScrollIndicator={false}>
                <Ways
                  itineraries={plan.itineraries}
                  chosenId={best?.id}
                  selectedId={picked ?? undefined}
                  now={now}
                  bufferMin={settings.get().bufferMin}
                  avoid={avoid}
                  loading={busy}
                  onSelect={(x) => {
                    setPicked(x.id);
                    // A route already pinned (hand-built, or the trip's own) stays: the list only shows its variations then.
                    if (!steps?.length) setPinned(variantSteps(x, plan.itineraries) ?? null);
                  }}
                  onAvoid={(a) => {
                    setPicked(null);
                    setPinned(null);
                    setAvoid(a);
                  }}
                />
              </ScrollView>
            )}
            {pinned ?? steps ? (
              <RideLines steps={pinned ?? steps ?? []} planned={pinned || !it ? [] : slotsFor(it, plan.itineraries)} onChange={pinned ? setPinned : setSteps} />
            ) : null}
            {pinned ? (
              <Tap
                onPress={() => {
                  setPinned(null);
                  setPicked(null);
                }}
                hitSlop={6}
                accessibilityRole="button"
              >
                <Text variant="caption" color={color.textSecondary}>
                  This way is kept for the trip. <Text variant="captionStrong">Let the app pick instead</Text>
                </Text>
              </Tap>
            ) : steps?.length ? (
              <Text variant="caption" color={color.textSecondary}>
                Stops picked on the map. Only the ticked lines are used on each ride.
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

/** The rides of the way on screen (stacked numbers = alternatives, arrows = changes), when to leave, when you get there. */
function Summary({ it, all, busy, error }: { it: Itinerary | null; all: Itinerary[]; busy: boolean; error: string | null }) {
  const bufferMin = settings.use().bufferMin;
  if (!it) {
    return (
      <View style={styles.summary}>
        {busy ? (
          <Busy label="Finding a route…" />
        ) : (
          <Text variant="body14" color={color.textSecondary}>
            {error ? "Can't reach the planner right now." : 'No bus or metro route found for this trip.'}
          </Text>
        )}
      </View>
    );
  }
  const min = Math.max(1, Math.round(it.durationSec / 60));
  return (
    <View style={styles.summary}>
      <LineChain slots={slotsFor(it, all)} />
      <Text variant="label16" numberOfLines={1}>
        Leave around {hhmm(leaveAt(it, bufferMin))}
      </Text>
      <Text variant="caption" color={color.textSecondary}>
        Arrive {hhmm(it.arriveAt)} · {min} min{firstWalkMin(it) > 0 ? ` · ${firstWalkMin(it)} min walk first` : ''}
      </Text>
      {busy && <Busy label="Checking every line…" />}
    </View>
  );
}

const styles = StyleSheet.create({
  timeChip: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: color.surfaceMuted, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12 },
  byHand: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: color.surfaceMuted, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12 },
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
  gap: { gap: 10 },
  links: { flexDirection: 'row', gap: 8 },
  pill: { flex: 1, height: 40, borderRadius: radius.md, backgroundColor: color.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  options: { maxHeight: 240, borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: color.border },
  optionsContent: { paddingTop: 10, paddingBottom: 4 },
  pair: { flexDirection: 'row', alignItems: 'center', backgroundColor: color.surfaceMuted, borderRadius: radius.md, height: 52, paddingHorizontal: 6 },
  half: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, height: 52 },
  swapMid: { width: 32, height: 32, borderRadius: 16, backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center', ...shadow.soft },
  summary: { gap: 4, paddingHorizontal: 2 },
  flex: { flex: 1 },
});

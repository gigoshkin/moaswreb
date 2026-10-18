import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { buildRoute, buildSteps, takeDraft } from '../../lib/handoff';
import { tripTourSeen } from '../../lib/onboarding';
import { firstWalkMin, leaveAt, placeName, transitLegs } from '../../lib/plans';
import { chainOf, tripWays, waysFields } from '../../lib/ways';
import { settings } from '../../lib/settings';
import { DAY_SHORT, hhmm, nextArriveBy } from '../../lib/time';
import { DEFAULT_DAYS, getTrip, newTripId, removeTrip, saveTrip, withStops, type Place, type SavedTrip } from '../../lib/trips';
import { useNow } from '../../lib/useNow';
import { useTripPlan } from '../../lib/useTripPlan';
import { Button } from '../../ui/Button';
import { CoachTour, type ViewRef } from '../../ui/CoachTour';
import { ask } from '../../ui/Dialog';
import { Icon } from '../../ui/Icon';
import { LineChain } from '../../ui/LineChain';
import { StaticMap } from '../../ui/StaticMap';
import { Tap, haptic } from '../../ui/Tap';
import { TimeSpinner, openTimeDialog } from '../../ui/TimePick';
import { Text } from '../../ui/Text';
import { Card, Chip, TopBar } from '../../ui/kit';
import { color, font, gutter, radius, shadow } from '../../ui/theme';

/** Figma "Add trip / default"; also edits a saved trip (`?id=`). */
export default function EditTrip() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const insets = useSafeAreaInsets();
  const now = useNow(30_000);
  const existing = id ? getTrip(id) : undefined;
  // Read once: a draft from chat, or the trip being edited, or Home → ?.
  const [init] = useState(() => {
    const draft = takeDraft();
    const home = settings.get().home;
    return {
      name: existing?.name ?? draft?.name,
      from: existing?.from ?? draft?.from ?? (home ? { ...home, label: 'Home' } : null),
      to: existing?.to ?? draft?.to ?? null,
      arriveBy: existing?.arriveBy ?? draft?.arriveBy ?? '09:00',
      days: existing?.days ?? draft?.days ?? DEFAULT_DAYS,
      avoid: existing?.avoid ?? draft?.avoid,
      ways: tripWays(existing ?? draft ?? {}),
    };
  });
  const [from, setFrom] = useState<Place | null>(init.from);
  const [to, setTo] = useState<Place | null>(init.to);
  const [name, setName] = useState(init.name ?? '');
  const [arriveBy, setArriveBy] = useState(init.arriveBy);
  const [days, setDays] = useState<number[]>(init.days);
  const [avoid, setAvoid] = useState(init.avoid);
  // The ways kept for the trip (ticked in the route builder, or built by hand); empty: the app picks.
  const [ways, setWays] = useState(init.ways);
  const [iosPicker, setIosPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  // First open of a NEW trip only; the flag is set when the tour ends (or is skipped).
  const [tour, setTour] = useState(() => !existing && !tripTourSeen.get());
  const arriveRef = useRef<ViewRef>(null);
  const routeRef = useRef<ViewRef>(null);
  const handRef = useRef<ViewRef>(null);
  const endTour = () => {
    tripTourSeen.set(true);
    setTour(false);
  };

  // Preview of the next occurrence, also the source of the stop ids on save.
  const draftTrip: SavedTrip | null = useMemo(
    () => (from && to ? { id: existing?.id ?? 'draft', name: '', from, to, arriveBy, days, avoid, ...waysFields(ways) } : null),
    [from, to, arriveBy, days.join(), JSON.stringify(avoid), JSON.stringify(ways)],
  );
  const date = nextArriveBy(arriveBy, days, now).slice(0, 10);
  const { choice } = useTripPlan(draftTrip, date, now);
  const it = choice.kind === 'none' ? null : choice.it;
  const legs = it ? transitLegs(it) : [];

  const openBuilder = async () => {
    const r = await buildRoute({ from, to, arriveBy, days, avoid, ...waysFields(ways) });
    if (r) {
      setFrom(r.from);
      setTo(r.to);
      setAvoid(r.avoid);
      setWays(tripWays(r)); // a new start or end keeps the kept ways; only the walks change
      if (r.arriveBy) setArriveBy(r.arriveBy); // changed on the route screen
    }
  };

  // Straight into the manual builder. Without ends it starts from scratch and takes them from the first and last stop.
  const buildByHand = async () => {
    const r = await buildSteps({ from, to, arriveBy, days, steps: ways[0] ?? [], avoid });
    if (!r) return;
    setFrom(r.from);
    setTo(r.to);
    // The builder edits the first kept way; the others stay.
    const built = JSON.stringify(r.steps);
    setWays([r.steps, ...ways.slice(1).filter((w) => JSON.stringify(w) !== built)]);
  };

  const changeTime = () => {
    if (!openTimeDialog(arriveBy, setArriveBy)) setIosPicker((v) => !v);
  };

  const toggleDay = (d: number) => setDays((cur) => (cur.includes(d) ? (cur.length > 1 ? cur.filter((x) => x !== d) : cur) : [...cur, d].sort()));

  const save = async () => {
    if (!from || !to || saving) return;
    setSaving(true);
    const base: SavedTrip = { id: existing?.id ?? newTripId(), name: name.trim() || to.label, from, to, arriveBy, days, ...(avoid ? { avoid } : {}), ...waysFields(ways) };
    const first = legs[0];
    const trip =
      it && first
        ? { ...base, fromStopId: first.from.stopId ?? undefined, toStopId: legs.at(-1)!.to.stopId ?? undefined, walkMin: firstWalkMin(it) }
        : await Promise.race([withStops(base), new Promise<SavedTrip>((r) => setTimeout(() => r(base), 3000))]); // the stop lookup can be slow; save without it after 3 s
    saveTrip(trip);
    haptic('success');
    // A new trip came from chat or the Today tab, possibly through a route preview: close every screen above the tabs,
    // or Back would land on the preview and its "Save this route" button again.
    if (existing) router.back();
    else router.dismissAll();
  };

  const remove = async () => {
    if (!(await ask({ title: 'Delete this trip?', confirm: 'Delete', destructive: true }))) return;
    removeTrip(existing!.id);
    router.dismissAll();
  };

  const bufferMin = settings.use().bufferMin;

  return (
    <View style={styles.screen}>
      <TopBar
        title={existing ? 'Edit trip' : 'New trip'}
        close
        right={
          existing ? (
            <Tap onPress={remove} scaleTo={0.94} hitSlop={8} accessibilityRole="button">
              <Text variant="label14" color={color.textSecondary}>
                Delete
              </Text>
            </Tap>
          ) : undefined
        }
      />
      <ScrollView scrollEnabled={!tour} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 20 }]} showsVerticalScrollIndicator={false}>
        <View ref={arriveRef} collapsable={false}>
        <Card style={styles.arriveCard}>
          <View style={styles.arriveRow}>
            <View>
              <Text variant="caption" color={color.textSecondary}>
                Arrive by
              </Text>
              <Text variant="time56">{arriveBy}</Text>
            </View>
            <Tap onPress={changeTime} style={styles.changePill} scaleTo={0.94} accessibilityRole="button" accessibilityLabel="Change arrive-by time">
              <Text variant="label13" color={color.textSecondary}>
                {iosPicker ? 'Done' : 'Change'}
              </Text>
            </Tap>
          </View>
          {iosPicker && (
            <TimeSpinner value={arriveBy} onChange={setArriveBy} />
          )}
        </Card>
        </View>

        <Card style={styles.daysCard}>
          <Text variant="caption" color={color.textSecondary}>
            Days
          </Text>
          <View style={styles.days}>
            {DAY_SHORT.map((label, i) => (
              <Chip key={label} label={label} on={days.includes(i + 1)} onPress={() => toggleDay(i + 1)} />
            ))}
          </View>
        </Card>

        <View style={styles.stepLabel}>
          <Text variant="caption" color={color.textSecondary}>
            Route
          </Text>
          <Text variant="caption" color={color.textSecondary}>
            Planned for {arriveBy}
          </Text>
        </View>
        <View ref={routeRef} collapsable={false}>
        {from && to ? (
          <Tap onPress={openBuilder} scaleTo={0.99} style={styles.routeMap} accessibilityRole="button" accessibilityLabel={`Route from ${from.label} to ${to.label}. Change`}>
            <StaticMap itinerary={it} endpoints={{ from, to }} height={150} fadeTo={color.surface} />
            <View style={styles.routeText}>
              <View style={styles.routeLines}>
                <Text variant="label16" numberOfLines={1}>
                  {from.label}
                </Text>
                <Text variant="label16" color={color.textSecondary} numberOfLines={1}>
                  to {to.label}
                </Text>
                {it ? (
                  <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(120)} style={styles.preview}>
                    <Text variant="body13" color={color.textSecondary}>
                      Leave around {hhmm(leaveAt(it, bufferMin))}
                    </Text>
                    <LineChain slots={chainOf(it)} size="sm" />
                  </Animated.View>
                ) : null}
              </View>
              <Icon name="chevron-right" size={20} color={color.textTertiary} />
            </View>
          </Tap>
        ) : (
          <View style={styles.routeCard}>
            <Field label="From" value={from?.label} onPress={openBuilder} divider />
            <Field label="To" value={to?.label} onPress={openBuilder} />
          </View>
        )}
        </View>
        <View ref={handRef} collapsable={false}>
          <Tap
            onPress={buildByHand}
            feedback="tint"
            style={styles.byHand}
            accessibilityRole="button"
            accessibilityLabel={ways.length ? 'Change my hand-built route' : 'Build route by hand, stop by stop'}
          >
            <Icon name="map" size={18} />
            <Text variant="label14" style={styles.byHandText}>
              {ways.length ? 'Change my hand-built route' : 'Build route by hand'}
            </Text>
            <Icon name="chevron-right" size={18} color={color.textTertiary} />
          </Tap>
        </View>

        <Card style={styles.nameCard}>
          <Text variant="caption" color={color.textSecondary}>
            Name
          </Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={to?.label ?? 'Optional'}
            placeholderTextColor={color.textTertiary}
            style={styles.nameInput}
            maxLength={40}
            returnKeyType="done"
            maxFontSizeMultiplier={1.15}
          />
        </Card>

        <View style={styles.spacer} />

        <View style={styles.bottom}>
          <Button label={saving ? 'Saving…' : 'Save'} onPress={save} disabled={!from || !to || saving} haptic="none" />
        </View>
      </ScrollView>
      {tour && (
        <CoachTour
          onDone={endTour}
          steps={[
            { target: arriveRef, text: 'Pick when you need to be there. The app tells you when to leave.' },
            { target: routeRef, text: 'Choose where you start and where you go. We compare every bus and the metro.' },
            { target: handRef, text: 'Want a specific bus, a change or the metro? Build it stop by stop on the map.' },
          ]}
        />
      )}
    </View>
  );
}


function Field({ label, value, sub, onPress, divider }: { label: string; value?: string; sub?: string; onPress: () => void; divider?: boolean }) {
  return (
    <Tap onPress={onPress} feedback="tint" style={[styles.field, divider && styles.fieldDivider]} accessibilityRole="button" accessibilityLabel={`${label}: ${value ?? 'not set'}`}>
      <View style={styles.fieldText}>
        <Text variant="caption" color={color.textSecondary}>
          {label}
        </Text>
        <Text variant="label16" color={value ? color.text : color.textSecondary} numberOfLines={1} style={styles.fieldValue}>
          {value ?? 'Choose a place'}
        </Text>
        {sub ? (
          <Text variant="caption" color={color.textSecondary} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      <Icon name="chevron-right" size={20} color={color.textTertiary} />
    </Tap>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { flexGrow: 1, paddingHorizontal: gutter, paddingTop: 8, gap: 12 },
  routeCard: { backgroundColor: color.sky, borderRadius: radius.lg, overflow: 'hidden', ...shadow.soft },
  field: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 20 },
  fieldDivider: { borderBottomWidth: StyleSheet.hairlineWidth * 2, borderBottomColor: 'rgba(28,26,26,0.08)' },
  fieldText: { flex: 1, gap: 2 },
  fieldValue: { fontFamily: font.bold },
  stepLabel: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, marginBottom: -4 },
  byHand: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: color.surfaceMuted, borderRadius: radius.full, paddingHorizontal: 20, paddingVertical: 14 },
  byHandText: { flex: 1 },
  arriveCard: { gap: 4 },
  arriveRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  changePill: { backgroundColor: color.surfaceMuted, borderRadius: radius.full, paddingHorizontal: 16, paddingVertical: 8 },
  daysCard: { gap: 12 },
  days: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  nameCard: { gap: 4 },
  nameInput: { fontFamily: font.bold, fontSize: 16, lineHeight: 22, color: color.text, paddingVertical: 4, includeFontPadding: false },
  routeMap: { backgroundColor: color.surface, borderRadius: radius.lg, overflow: 'hidden', ...shadow.card },
  routeText: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 16, marginTop: -8 },
  routeLines: { flex: 1, gap: 2 },
  spacer: { flex: 1, minHeight: 12 },
  bottom: { gap: 8 },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 6 },
});

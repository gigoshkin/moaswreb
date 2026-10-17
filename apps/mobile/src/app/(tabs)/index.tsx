import type { Itinerary } from '@transit/shared';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, interpolateColor, LinearTransition, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { openNewTrip } from '../../lib/handoff';
import { durationText, leaveAt as leaveAtOf, minutesUntil, transitLegs, firstWalkMin, type Choice } from '../../lib/plans';
import { settings } from '../../lib/settings';
import { addDays, hhmm, isoWeekday, longDate, relativeDay, todayLocal } from '../../lib/time';
import { tripDays, useTrips, type SavedTrip } from '../../lib/trips';
import { useNow } from '../../lib/useNow';
import { useTripPlan } from '../../lib/useTripPlan';
import { chainOf, slotsFor } from '../../lib/ways';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { LeaveByBar } from '../../ui/LeaveByBar';
import { LineChain } from '../../ui/LineChain';
import { Tap, haptic } from '../../ui/Tap';
import { Text } from '../../ui/Text';
import { Countdown } from '../../ui/Countdown';
import { RouteSummary } from '../../ui/kit';
import { color, gutter, shadow, spring } from '../../ui/theme';

/** Tbilisi wall-clock `HH:mm` now, for comparing with trips' arrive-by times. */
const clock = (now: number) => hhmm(now);

/** Trips on a date, by arrive-by time. */
const tripsOn = (trips: SavedTrip[], date: string) =>
  trips.filter((t) => tripDays(t).includes(isoWeekday(date))).sort((a, b) => a.arriveBy.localeCompare(b.arriveBy));

export default function Today() {
  const insets = useSafeAreaInsets();
  const now = useNow();
  const trips = useTrips();
  const today = todayLocal(now);
  const ahead = useMemo(() => tripsOn(trips, today).filter((t) => t.arriveBy > clock(now)), [trips, today, now]);
  const hero = ahead[0] ?? null;
  const later = ahead.slice(1);
  const plan = useTripPlan(hero, today, now, { refreshMs: 60_000, trackChanges: true });

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
      <View style={[styles.header, { paddingTop: insets.top + 28 }]}>
        <Text variant="caption" color={color.textSecondary}>
          {longDate(today)}
        </Text>
        {hero && plan.choice.kind !== 'none' && (
          <Animated.View key={plan.choice.kind} entering={FadeIn.duration(250)}>
            <Text variant="title18">{plan.choice.kind === 'onTime' ? "You'll make it." : 'Running late'}</Text>
          </Animated.View>
        )}
      </View>

      {hero ? <Hero trip={hero} date={today} now={now} plan={plan} /> : trips.length ? <NothingLeft trips={trips} now={now} /> : <FirstRun />}

      {later.length > 0 && (
        <Animated.View layout={LinearTransition.springify()}>
          <Text variant="label14" color={color.textSecondary} style={styles.sectionLabel}>
            Later today
          </Text>
          {later.map((t) => (
            <LaterRow key={t.id} trip={t} date={today} now={now} />
          ))}
        </Animated.View>
      )}

      {trips.length > 0 && (
        <View style={styles.cta}>
          <Button label="View full schedule" kind="secondary" onPress={() => router.navigate('/week')} haptic="none" />
        </View>
      )}
    </ScrollView>
  );
}

function Hero({ trip, date, now, plan }: { trip: SavedTrip; date: string; now: number; plan: ReturnType<typeof useTripPlan> }) {
  const { choice } = plan;
  const minutes = choice.kind === 'none' ? null : minutesUntil(choice.leaveAt, now);
  const dark = minutes !== null && minutes <= 0;

  // Cream → ink when it's time to go.
  const d = useSharedValue(dark ? 1 : 0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    d.value = withSpring(dark ? 1 : 0, spring.smooth);
    if (dark) haptic('success');
  }, [dark]);
  const bg = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(d.value, [0, 1], [color.cream, color.ink]) }));

  const fg = dark ? color.onInk : color.text;
  const muted = dark ? color.onInkMuted : color.textSecondary;

  return (
    <Tap onPress={() => router.push({ pathname: '/trip/[id]', params: { id: trip.id, date } })} feedback="tint" accessibilityRole="button">
      <Animated.View style={[styles.hero, bg]}>
        <Text variant="body14" color={muted} numberOfLines={1}>
          {trip.name} · by {trip.arriveBy}
        </Text>
        {choice.kind === 'none' ? (
          <HeroEmpty plan={plan} trip={trip} />
        ) : (
          <Animated.View key={dark ? 'now' : 'count'} entering={FadeIn.duration(280)} style={styles.heroBody}>
            {dark ? (
              <>
                <Text variant="headline" color={fg}>
                  Leave now
                </Text>
                <View style={styles.statusPill}>
                  <Text variant="label13" color={color.onInk}>
                    {choice.kind === 'late' ? `${choice.lateMin} min late` : 'On time'}
                  </Text>
                  {choice.kind === 'onTime' && <Icon name="check" size={16} color={color.onInk} />}
                </View>
              </>
            ) : minutes! < 60 ? (
              <Countdown prefix="Leave in" value={String(minutes)} suffix="min" tint={fg} />
            ) : (
              <Countdown prefix="Leave at" value={hhmm(choice.leaveAt)} tint={fg} />
            )}
            {(plan.change || choice.kind === 'late') && (
              <View style={styles.alert}>
                <Icon name="alert" size={24} color={fg} />
                <Text variant="body14" color={fg} style={styles.flex}>
                  {plan.change ?? `Nothing gets you there by ${trip.arriveBy} — you'd arrive ${hhmm(choice.it.arriveAt)}`}
                </Text>
              </View>
            )}
            <LeaveByBar leaveAt={choice.leaveAt} arriveAt={Date.parse(choice.it.arriveAt)} now={now} tone={dark ? 'dark' : 'cream'} />
            <Summary choice={choice} all={plan.itineraries} dark={dark} />
          </Animated.View>
        )}
      </Animated.View>
    </Tap>
  );
}

function Summary({ choice, all, dark }: { choice: Exclude<Choice, { kind: 'none' }>; all: Itinerary[]; dark: boolean }) {
  return (
    <RouteSummary
      walkMin={firstWalkMin(choice.it)}
      slots={slotsFor(choice.it, all)}
      arrive={`Arrive ${hhmm(choice.it.arriveAt)}`}
      dark={dark}
    />
  );
}

/** Hero without an option to show: loading, offline, or no route. */
function HeroEmpty({ plan, trip }: { plan: ReturnType<typeof useTripPlan>; trip: SavedTrip }) {
  if (!plan.loaded && !plan.error) {
    // First load ever (no cache): still blocks, no spinner.
    return (
      <View style={styles.heroBody}>
        <View style={[styles.skeleton, { width: 220, height: 56 }]} />
        <View style={[styles.skeleton, { width: '100%', height: 8, marginTop: 12 }]} />
        <View style={[styles.skeleton, { width: 180, height: 14, marginTop: 12 }]} />
      </View>
    );
  }
  return (
    <View style={styles.heroBody}>
      <Text variant="title26">{plan.error && !plan.loaded ? "Can't reach the planner" : 'No route found'}</Text>
      <Text variant="body14" color={color.textSecondary}>
        {plan.error && !plan.loaded ? 'It will try again in a minute.' : `Nothing runs from ${trip.from.label} in time. Check the trip's start and end.`}
      </Text>
    </View>
  );
}

function LaterRow({ trip, date, now }: { trip: SavedTrip; date: string; now: number }) {
  const { choice } = useTripPlan(trip, date, now);
  const bufferMin = settings.use().bufferMin;
  const hasRides = choice.kind !== 'none' && transitLegs(choice.it).length > 0;
  const leave = choice.kind === 'none' ? null : leaveAtOf(choice.it, bufferMin);
  return (
    <Tap onPress={() => router.push({ pathname: '/trip/[id]', params: { id: trip.id, date } })} feedback="tint" style={styles.row} accessibilityRole="button">
      <Text variant="time18" color={leave ? color.text : color.textTertiary} style={styles.rowTime}>
        {leave ? hhmm(leave) : '--:--'}
      </Text>
      <View style={styles.rowMain}>
        <Text variant="name16" numberOfLines={1}>
          {trip.name}
        </Text>
        <View style={styles.rowMeta}>
          {choice.kind !== 'none' && <LineChain slots={chainOf(choice.it)} size="sm" />}
          <Text variant="caption" color={color.textSecondary} style={hasRides ? styles.metaText : null}>
            {leave ? `in ${durationText(leave - now)}` : `by ${trip.arriveBy}`}
          </Text>
        </View>
      </View>
      <Icon name="chevron-right" size={20} color={color.textTertiary} />
    </Tap>
  );
}

/** Trips exist, but none are left today. */
function NothingLeft({ trips, now }: { trips: SavedTrip[]; now: number }) {
  const today = todayLocal(now);
  let next: { date: string; trip: SavedTrip } | null = null;
  for (let i = 1; i <= 7 && !next; i++) {
    const date = addDays(today, i);
    const t = tripsOn(trips, date)[0];
    if (t) next = { date, trip: t };
  }
  return (
    <View style={[styles.hero, { backgroundColor: color.cream }]}>
      <Text variant="title26">Nothing else today</Text>
      {next && (
        <Tap onPress={() => router.push({ pathname: '/trip/[id]', params: { id: next.trip.id, date: next.date } })} style={styles.nextRow} scaleTo={0.98}>
          <Text variant="body14" color={color.textSecondary} style={styles.flex}>
            Next: {relativeDay(next.date, now)} · {next.trip.name} by {next.trip.arriveBy}
          </Text>
          <Icon name="chevron-right" size={20} color={color.textTertiary} />
        </Tap>
      )}
    </View>
  );
}

/** No trips saved yet. */
function FirstRun() {
  return (
    <View style={[styles.hero, { backgroundColor: color.cream }]}>
      <Text variant="title26">Where do you go often?</Text>
      <Text variant="body14" color={color.textSecondary}>
        Add a trip and this screen counts down to when you leave.
      </Text>
      <View style={styles.firstRunActions}>
        <Button label="Add a trip" onPress={() => openNewTrip()} />
        <Tap onPress={() => router.navigate('/chat')} style={styles.textButton} scaleTo={0.96}>
          <Text variant="label14">Or ask the assistant to set it up</Text>
        </Tap>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: gutter, paddingBottom: 12 },
  hero: { padding: 20, gap: 12, ...shadow.soft },
  heroBody: { gap: 12 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: color.onInkPill, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 },
  alert: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  flex: { flex: 1 },
  skeleton: { backgroundColor: 'rgba(28,26,26,0.06)', borderRadius: 8 },
  sectionLabel: { paddingHorizontal: gutter, paddingTop: 24, paddingBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: gutter, paddingVertical: 16, backgroundColor: color.surface, borderBottomWidth: StyleSheet.hairlineWidth * 2, borderBottomColor: color.border },
  rowTime: { width: 56 },
  rowMain: { flex: 1, gap: 4 },
  rowMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 4, rowGap: 4 },
  metaText: { marginLeft: 4 },
  cta: { paddingHorizontal: gutter, paddingTop: 20 },
  nextRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  firstRunActions: { gap: 4, marginTop: 8 },
  textButton: { alignSelf: 'center', paddingVertical: 12, paddingHorizontal: 8 },
});

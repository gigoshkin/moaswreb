import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, interpolateColor, useAnimatedStyle, useDerivedValue, withSpring } from 'react-native-reanimated';
import { openNewTrip } from '../../lib/handoff';
import { durationText, leaveAt, transitLegs } from '../../lib/plans';
import { chainOf } from '../../lib/ways';
import { settings } from '../../lib/settings';
import { addDays, DAY_SHORT, hhmm, isoWeekday, todayLocal, weekdayName } from '../../lib/time';
import { tripDays, useTrips, type SavedTrip } from '../../lib/trips';
import { useNow } from '../../lib/useNow';
import { useTripPlan } from '../../lib/useTripPlan';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { LineChain } from '../../ui/LineChain';
import { Tap } from '../../ui/Tap';
import { Text } from '../../ui/Text';
import { ScreenTitle } from '../../ui/kit';
import { color, gutter, radius, shadow, spring } from '../../ui/theme';

// Not in the Figma file: the weekly plan (spec F3), built from the Today
// rows and the Add-trip day chips. Pick a day, see when to leave for each trip.

export default function Week() {
  const now = useNow(30_000);
  const today = todayLocal(now);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(today, i)), [today]);
  const [selected, setSelected] = useState(0);
  const date = days[selected];
  const trips = useTrips();
  const onDay = trips.filter((t) => tripDays(t).includes(isoWeekday(date))).sort((a, b) => a.arriveBy.localeCompare(b.arriveBy));

  return (
    <View style={styles.screen}>
      <ScreenTitle title="Week" />
      <View style={styles.days}>
        {days.map((d, i) => (
          <DayPill key={d} date={d} on={i === selected} count={trips.filter((t) => tripDays(t).includes(isoWeekday(d))).length} onPress={() => setSelected(i)} />
        ))}
      </View>
      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        <Animated.View key={date} entering={FadeIn.duration(220)}>
          <Text variant="label14" color={color.textSecondary} style={styles.dayLabel}>
            {selected === 0 ? 'Today' : selected === 1 ? 'Tomorrow' : weekdayName(date)}
          </Text>
          {onDay.length ? (
            onDay.map((t) => <WeekRow key={t.id} trip={t} date={date} now={now} />)
          ) : (
            <View style={styles.empty}>
              <Text variant="body15" color={color.textSecondary}>
                No trips on {weekdayName(date)}.
              </Text>
            </View>
          )}
        </Animated.View>
        <View style={styles.cta}>
          <Button label="Add a trip" onPress={() => openNewTrip({ days: [isoWeekday(date)] })} />
        </View>
      </ScrollView>
    </View>
  );
}

function DayPill({ date, on, count, onPress }: { date: string; on: boolean; count: number; onPress: () => void }) {
  const v = useDerivedValue(() => withSpring(on ? 1 : 0, spring.snappy), [on]);
  const bg = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(v.value, [0, 1], [color.surface, color.ink]) }));
  const fg = on ? color.onInk : color.text;
  return (
    <Tap onPress={onPress} haptic="selection" scaleTo={0.92} style={styles.pillTap} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={weekdayName(date)}>
      <Animated.View style={[styles.pill, bg]}>
        <Text variant="caption" color={on ? color.onInkMuted : color.textSecondary}>
          {DAY_SHORT[isoWeekday(date) - 1]}
        </Text>
        <Text variant="title18" color={fg}>
          {Number(date.slice(8))}
        </Text>
        <View style={[styles.dot, { backgroundColor: count ? (on ? color.onInk : color.ink) : 'transparent' }]} />
      </Animated.View>
    </Tap>
  );
}

function WeekRow({ trip, date, now }: { trip: SavedTrip; date: string; now: number }) {
  const { choice } = useTripPlan(trip, date, now);
  const bufferMin = settings.use().bufferMin;
  const hasRides = choice.kind !== 'none' && transitLegs(choice.it).length > 0;
  const leave = choice.kind === 'none' ? null : leaveAt(choice.it, bufferMin);
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
            {choice.kind === 'none' ? `by ${trip.arriveBy}` : `${durationText(Date.parse(choice.it.arriveAt) - leave!)} · by ${trip.arriveBy}`}
          </Text>
        </View>
      </View>
      <Icon name="chevron-right" size={20} color={color.textTertiary} />
    </Tap>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  days: { flexDirection: 'row', paddingHorizontal: gutter, gap: 8, paddingBottom: 8 },
  pillTap: { flex: 1 },
  pill: { paddingVertical: 10, borderRadius: radius.md, alignItems: 'center', gap: 2, ...shadow.soft },
  dot: { width: 4, height: 4, borderRadius: 2, marginTop: 2 },
  list: { paddingBottom: 24 },
  dayLabel: { paddingHorizontal: gutter, paddingTop: 16, paddingBottom: 8 },
  empty: { paddingHorizontal: gutter, paddingVertical: 24 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: gutter, paddingVertical: 16, backgroundColor: color.surface, borderBottomWidth: StyleSheet.hairlineWidth * 2, borderBottomColor: color.border },
  rowTime: { width: 56 },
  rowMain: { flex: 1, gap: 4 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { marginLeft: 4 },
  cta: { paddingHorizontal: gutter, paddingTop: 20 },
});

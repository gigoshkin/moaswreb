import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { firstWalkMin, leaveAt } from '../lib/plans';
import { settings } from '../lib/settings';
import { hhmm } from '../lib/time';
import type { SavedTrip } from '../lib/trips';
import { dismissSuggestion, keepSuggestion, type TripSuggestion } from '../lib/useTripPlan';
import { slotsFor, wayLabel } from '../lib/ways';
import { Button } from './Button';
import { Icon } from './Icon';
import { Text } from './Text';
import { RouteSummary } from './kit';
import { color, gutter, radius } from './theme';

/**
 * Another way, shown apart from the kept one when every kept way missed (see
 * suggestOther): "Your usual ways missed it. 315 -> 550 gets you there by
 * 09:02". It never replaces the kept way on screen; Keep ticks it into the
 * trip's ways, Dismiss hides it for the day.
 */
export function SuggestionCard({ trip, date, s, inset }: { trip: SavedTrip; date: string; s: TripSuggestion; inset?: boolean }) {
  const bufferMin = settings.use().bufferMin;
  const slots = slotsFor(s.it, s.all);
  const name = wayLabel(slots);
  return (
    <Animated.View entering={FadeIn.duration(220)} style={[styles.card, inset && styles.inset]} accessibilityLiveRegion="polite">
      <View style={styles.head}>
        <Icon name="alert" size={20} />
        <Text variant="captionStrong" style={styles.flex}>
          Suggestion · not one of your ways
        </Text>
      </View>
      <Text variant="body15">
        {`Your usual ways missed it. ${name} gets you there ${s.onTime ? `by ${hhmm(s.it.arriveAt)}` : `at ${hhmm(s.it.arriveAt)}, sooner than your ways`}.`}
      </Text>
      <Text variant="caption" color={color.textSecondary}>
        Leave at {hhmm(leaveAt(s.it, bufferMin))}
      </Text>
      <RouteSummary walkMin={firstWalkMin(s.it)} slots={slots} arrive={`Arrive ${hhmm(s.it.arriveAt)}`} />
      <View style={styles.actions}>
        <Button label="Keep this way" kind="secondary" style={styles.flex} onPress={() => keepSuggestion(trip, s)} />
        <Button label="Dismiss" kind="secondary" style={styles.flex} haptic="none" onPress={() => dismissSuggestion(trip.id, date)} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 8, padding: 16, borderRadius: radius.lg, borderWidth: 2, borderStyle: 'dashed', borderColor: color.border, backgroundColor: color.surface },
  inset: { marginHorizontal: gutter, marginTop: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  flex: { flex: 1 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4 },
});

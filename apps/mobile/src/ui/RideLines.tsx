import { StyleSheet, View } from 'react-native';
import { rideChoice, toggleRideLine, type RideStep } from '../lib/ways';
import { Icon } from './Icon';
import type { Slot } from './LineChain';
import { RoutePlate } from './RoutePlate';
import { Tap, haptic } from './Tap';
import { Text } from './Text';
import { color } from './theme';

interface Props {
  steps: RideStep[];
  /** Per ride, the lines in the current plan (for rides saved without their list). */
  planned?: Slot[];
  onChange: (steps: RideStep[]) => void;
}

/**
 * The lines the rider takes on each ride of a pinned route: every line that can
 * do the ride as a plate, ticked or not (at least one per ride stays ticked).
 * The planner looks at the ticked ones only; the rides themselves never change.
 */
export function RideLines({ steps, planned = [], onChange }: Props) {
  const rides = steps.map((s, i) => rideChoice(s, planned[i]));
  if (!rides.some((r) => r.lines.length > 1)) return null;
  const toggle = (i: number, label: string) => {
    haptic('selection');
    onChange(steps.map((s, j) => (j === i ? toggleRideLine(s, label, planned[i]) : s)));
  };
  return (
    <View style={styles.wrap}>
      <Text variant="caption" color={color.textSecondary}>
        Lines you take on each ride (tap to switch off)
      </Text>
      {rides.map((r, i) => (
        <View key={i} style={styles.ride}>
          <Text variant="captionStrong" color={color.textTertiary} style={styles.num}>
            {i + 1}
          </Text>
          <View style={styles.row}>
            {r.lines.map((l) => {
              const on = r.on.includes(l.label);
              const last = on && r.on.length === 1;
              return (
                <Tap
                  key={l.label}
                  onPress={() => toggle(i, l.label)}
                  disabled={last || r.lines.length === 1}
                  scaleTo={0.92}
                  style={[styles.chip, !on && styles.off]}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: on, disabled: last }}
                  accessibilityLabel={`Ride ${i + 1}, line ${l.label}`}
                >
                  <RoutePlate label={l.label} kind={l.kind} size="sm" />
                  {r.lines.length > 1 && <Icon name={on ? 'close' : 'plus'} size={12} color={last ? color.textTertiary : color.textSecondary} />}
                </Tap>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  ride: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  num: { width: 12, textAlign: 'center' },
  row: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5, paddingLeft: 6, paddingRight: 8, borderRadius: 14, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface },
  off: { opacity: 0.4 },
});

import { StyleSheet, View } from 'react-native';
import type { Kind } from '../lib/plans';
import { Icon } from './Icon';
import { RoutePlate } from './RoutePlate';
import { Text } from './Text';
import { color } from './theme';

/** One line of a ride. */
export interface LineRef {
  label: string;
  kind: Kind;
}

/** One ride of a trip: the lines that can do it. More than one means "any of these" (same stops). */
export type Slot = LineRef[];

interface Props {
  slots: Slot[];
  size?: 'sm' | 'md';
  onDark?: boolean;
  /** Rides shown before the rest are cut off. */
  max?: number;
}

/**
 * The rides of a trip like Google Maps draws them: an arrow between rides
 * (you change there) and numbers held in one capsule when several lines
 * cover the same ride (any of them works).
 */
export function LineChain({ slots, size = 'md', onDark, max = 3 }: Props) {
  const shown = slots.slice(0, max);
  return (
    <View style={styles.row}>
      {shown.map((slot, i) => (
        <View key={i} style={styles.row}>
          {i > 0 && <Icon name="chevron-right" size={size === 'sm' ? 14 : 16} color={onDark ? color.onInkMuted : color.textTertiary} />}
          <Stack slot={slot} size={size} onDark={onDark} />
        </View>
      ))}
    </View>
  );
}

/** Alternatives for one ride, held together in one capsule: any of these lines does the ride. */
export function Stack({ slot, size = 'md', onDark }: { slot: Slot; size?: 'sm' | 'md'; onDark?: boolean }) {
  if (slot.length === 1) return <RoutePlate label={slot[0].label} kind={slot[0].kind} size={size} onDark={onDark} />;
  const shown = slot.slice(0, 3);
  return (
    <View style={[styles.capsule, { backgroundColor: onDark ? color.onInkPill : color.surfaceMuted }]} accessibilityLabel={`Any of ${slot.map((l) => l.label).join(', ')}`}>
      {shown.map((l) => (
        <RoutePlate key={l.label} label={l.label} kind={l.kind} size={size} />
      ))}
      {slot.length > shown.length && (
        <Text variant="captionStrong" color={onDark ? color.onInk : color.textSecondary}>
          +{slot.length - shown.length}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  capsule: { flexDirection: 'row', alignItems: 'center', gap: 3, padding: 3, paddingRight: 4, borderRadius: 14 },
});

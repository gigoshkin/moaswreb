import { StyleSheet, View } from 'react-native';
import type { Kind } from '../lib/plans';
import { Icon } from './Icon';
import { RoutePlate } from './RoutePlate';
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

/** Plates are at least 40 wide; this much of each plate behind shows. */
const SLIVER = 12;
const PLATE_MIN_W = 40;

/**
 * The rides of a trip like Google Maps draws them: an arrow between rides
 * (you change there) and numbers stacked on top of each other when several
 * lines cover the same ride (any of them works).
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

/** Alternatives for one ride, overlapped: the first in front, a sliver of each behind. */
export function Stack({ slot, size = 'md', onDark }: { slot: Slot; size?: 'sm' | 'md'; onDark?: boolean }) {
  const lines = slot.slice(0, 3);
  return (
    <View style={styles.stack} accessibilityLabel={slot.length > 1 ? `Any of ${slot.map((l) => l.label).join(', ')}` : slot[0]?.label}>
      {lines.map((l, i) => (
        <View key={l.label} style={[{ zIndex: lines.length - i }, i > 0 && { marginLeft: SLIVER - PLATE_MIN_W }]}>
          <RoutePlate label={l.label} kind={l.kind} size={size} onDark={onDark} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  stack: { flexDirection: 'row', alignItems: 'center' },
});

import { StyleSheet, View } from 'react-native';
import { Icon } from './Icon';
import type { Kind } from '../lib/plans';
import { kindColor } from './RoutePlate';
import { color } from './theme';

// Small things drawn on the map: where a route starts, where it ends, where you board.

export const StartDot = () => <View style={styles.start} />;

/** A stop on the map you can tap. `on` marks the one picked; `tint` is the colour of the line it is on. */
export const StopDot = ({ on, big, tint = color.ink }: { on?: boolean; big?: boolean; tint?: string }) =>
  on ? <View style={[styles.stopOn, { borderColor: tint }]} /> : <View style={[big ? styles.stopBig : styles.stop, { borderColor: tint }]} />;

export const EndRing = () => <View style={styles.end} />;

export const RideBadge = ({ kind = 'bus' }: { kind?: Kind }) => (
  <View style={[styles.badge, { backgroundColor: kindColor[kind] }]}>
    <Icon name={kind === 'metro' ? 'metro' : 'bus'} size={16} color={color.onInk} />
  </View>
);

const styles = StyleSheet.create({
  stop: { width: 12, height: 12, borderRadius: 6, backgroundColor: color.surface, borderWidth: 2.5 },
  stopBig: { width: 18, height: 18, borderRadius: 9, backgroundColor: color.surface, borderWidth: 3.5 },
  stopOn: { width: 20, height: 20, borderRadius: 10, backgroundColor: color.surface, borderWidth: 6 },
  start: { width: 16, height: 16, borderRadius: 8, backgroundColor: color.ink, borderWidth: 3, borderColor: color.surface },
  end: { width: 18, height: 18, borderRadius: 9, backgroundColor: color.surface, borderWidth: 4, borderColor: color.ink },
  badge: { width: 30, height: 30, borderRadius: 15, borderWidth: 2.5, borderColor: color.surface, alignItems: 'center', justifyContent: 'center' },
});

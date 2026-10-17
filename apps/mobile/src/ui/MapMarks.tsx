import { StyleSheet, View } from 'react-native';
import { Icon } from './Icon';
import { color } from './theme';

// Small things drawn on the map: where a route starts, where it ends, where you board.

export const StartDot = () => <View style={styles.start} />;

export const EndRing = () => <View style={styles.end} />;

export const RideBadge = ({ metro }: { metro?: boolean }) => (
  <View style={styles.badge}>
    <Icon name={metro ? 'metro' : 'bus'} size={16} color={color.onInk} />
  </View>
);

const styles = StyleSheet.create({
  start: { width: 16, height: 16, borderRadius: 8, backgroundColor: color.ink, borderWidth: 3, borderColor: color.surface },
  end: { width: 18, height: 18, borderRadius: 9, backgroundColor: color.surface, borderWidth: 4, borderColor: color.ink },
  badge: { width: 30, height: 30, borderRadius: 15, backgroundColor: color.ink, borderWidth: 2.5, borderColor: color.surface, alignItems: 'center', justifyContent: 'center' },
});

import { StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { color } from './theme';

interface Props {
  label: string;
  /** Metro is a pill, buses and minibuses a rounded rectangle. */
  metro?: boolean;
  /** sm = 20 px (rows), md = 28 px (plan card), lg = timeline. */
  size?: 'sm' | 'md' | 'lg';
  /** On the dark hero the plate is outlined so it doesn't vanish. */
  onDark?: boolean;
}

/** Route number on a neutral plate. No per-route colours (George, 17 Oct). */
export function RoutePlate({ label, metro, size = 'sm', onDark }: Props) {
  const s = sizes[size];
  return (
    <View
      style={[
        styles.plate,
        { height: s.h, minWidth: s.minW, paddingHorizontal: s.px, borderRadius: metro ? s.h / 2 : s.r },
        onDark && styles.onDark,
      ]}
    >
      <Text variant={s.text} color={color.onInk} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const sizes = {
  sm: { h: 20, minW: 40, px: 6, r: 6, text: 'captionStrong' },
  md: { h: 28, minW: 40, px: 8, r: 8, text: 'label14' },
  lg: { h: 26, minW: 44, px: 8, r: 8, text: 'label14' },
} as const;

const styles = StyleSheet.create({
  plate: { backgroundColor: color.ink, alignItems: 'center', justifyContent: 'center' },
  onDark: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
});

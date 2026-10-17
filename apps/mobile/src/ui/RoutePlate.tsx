import { StyleSheet, View } from 'react-native';
import type { Kind } from '../lib/plans';
import { Text } from './Text';
import { color } from './theme';

interface Props {
  label: string;
  /** Colour and shape: metro is a red pill, buses green and minibuses blue rounded rectangles. */
  kind?: Kind;
  /** sm = 20 px (rows), md = 28 px (plan card), lg = timeline. */
  size?: 'sm' | 'md' | 'lg';
  /** On the dark hero the plate is outlined so it doesn't vanish. */
  onDark?: boolean;
}

export const kindColor = { bus: color.bus, minibus: color.minibus, metro: color.metro } as const;

/** Route number on a plate coloured by transport type. */
export function RoutePlate({ label, kind = 'bus', size = 'sm', onDark }: Props) {
  const s = sizes[size];
  return (
    <View
      style={[
        styles.plate,
        { height: s.h, minWidth: s.minW, paddingHorizontal: s.px, borderRadius: kind === 'metro' ? s.h / 2 : s.r, backgroundColor: kindColor[kind] },
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
  plate: { alignItems: 'center', justifyContent: 'center' },
  onDark: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
});

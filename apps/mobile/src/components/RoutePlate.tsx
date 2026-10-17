import type { LegMode, PlanRoute } from '@transit/shared';
import { View } from 'react-native';
import { onColor, useColors } from '../theme/theme';
import { metroColors, radius, type TypeVariant } from '../theme/tokens';
import { Text } from './Text';

const SIZES = {
  sm: { h: 24, px: 6, text: 'caption' },
  md: { h: 32, px: 8, text: 'label' },
  lg: { h: 48, px: 12, text: 'title' },
} as const satisfies Record<string, { h: number; px: number; text: TypeVariant }>;

interface Props {
  route: PlanRoute;
  mode: LegMode;
  size?: keyof typeof SIZES;
}

/**
 * Route number in the line's own colour: the only strong colour on screen.
 * Buses are rounded rectangles; the metro is a circle-ended pill so the two
 * read differently at a glance even in greyscale.
 */
export function RoutePlate({ route, mode, size = 'md' }: Props) {
  const c = useColors();
  const s = SIZES[size];
  const isMetro = mode === 'SUBWAY';
  const bg = route.color ?? (isMetro ? metroColors[route.shortName] : undefined) ?? c.text;
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={`${isMetro ? 'Metro' : 'Bus'} ${route.shortName}`}
      style={{
        height: s.h,
        minWidth: s.h,
        paddingHorizontal: s.px,
        borderRadius: isMetro ? radius.pill : radius.plate,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text variant={s.text} weight="bold" color={onColor(bg)} tabular>
        {route.shortName}
      </Text>
    </View>
  );
}

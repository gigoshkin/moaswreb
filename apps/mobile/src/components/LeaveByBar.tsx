import { Canvas, Circle, Group, RoundedRect } from '@shopify/react-native-skia';
import { useEffect } from 'react';
import { View } from 'react-native';
import { useDerivedValue, useSharedValue, withSpring } from 'react-native-reanimated';
import { hhmm } from '../lib/time';
import { useColors } from '../theme/theme';
import { space, springs } from '../theme/tokens';
import { Text } from './Text';

const BAR_H = 12;
const MARKER_R = 7;
const CANVAS_H = MARKER_R * 2 + 4;

interface Props {
  /** Leave window, epoch ms. */
  windowStart: number;
  windowEnd: number;
  now: number;
  /** Visible span. Defaults to the window padded by 15 min each side. */
  rangeStart?: number;
  rangeEnd?: number;
}

/**
 * Signature moment #1: a live leave-by window. The band narrows on a spring
 * as the estimate firms up, and the "now" marker slides into it. Drawn with
 * Skia so it stays at 60/120 fps while numbers update.
 */
export function LeaveByBar({ windowStart, windowEnd, now, rangeStart, rangeEnd }: Props) {
  const c = useColors();
  const from = rangeStart ?? windowStart - 15 * 60_000;
  const to = rangeEnd ?? windowEnd + 15 * 60_000;
  const span = Math.max(1, to - from);
  const frac = (t: number) => Math.min(1, Math.max(0, (t - from) / span));

  const width = useSharedValue(0);
  const a = useSharedValue(frac(windowStart));
  const b = useSharedValue(frac(windowEnd));
  const n = useSharedValue(frac(now));

  useEffect(() => {
    a.value = withSpring(frac(windowStart), springs.morph);
    b.value = withSpring(frac(windowEnd), springs.morph);
    n.value = withSpring(frac(now), springs.settle);
    // frac is derived from the props listed here.
  }, [windowStart, windowEnd, now, from, to]);

  const inside = now >= windowStart && now <= windowEnd;
  const late = now > windowEnd;

  const y = (CANVAS_H - BAR_H) / 2;
  const usable = useDerivedValue(() => Math.max(0, width.value - MARKER_R * 2));
  const bandX = useDerivedValue(() => MARKER_R + a.value * usable.value);
  const bandW = useDerivedValue(() => Math.max(BAR_H, (b.value - a.value) * usable.value));
  const trackW = useDerivedValue(() => usable.value);
  const markerX = useDerivedValue(() => MARKER_R + n.value * usable.value);

  return (
    <View
      accessible
      accessibilityLabel={`Leave between ${hhmm(windowStart)} and ${hhmm(windowEnd)}`}
      style={{ gap: space.sm }}
    >
      <Canvas
        style={{ height: CANVAS_H }}
        onLayout={(e) => {
          width.value = e.nativeEvent.layout.width;
        }}
      >
        <RoundedRect x={MARKER_R} y={y} width={trackW} height={BAR_H} r={BAR_H / 2} color={c.track} />
        <RoundedRect
          x={bandX}
          y={y}
          width={bandW}
          height={BAR_H}
          r={BAR_H / 2}
          color={late ? c.late : inside ? c.accent : c.windowFill}
        />
        <Group>
          <Circle cx={markerX} cy={CANVAS_H / 2} r={MARKER_R} color={c.bg} />
          <Circle cx={markerX} cy={CANVAS_H / 2} r={MARKER_R - 2.5} color={c.text} />
        </Group>
      </Canvas>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text variant="caption" color="textFaint" tabular>
          {hhmm(from)}
        </Text>
        <Text variant="caption" color="textMuted" weight="semibold" tabular>
          {`${hhmm(windowStart)}–${hhmm(windowEnd)}`}
        </Text>
        <Text variant="caption" color="textFaint" tabular>
          {hhmm(to)}
        </Text>
      </View>
    </View>
  );
}

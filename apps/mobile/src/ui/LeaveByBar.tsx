import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { hhmm } from '../lib/time';
import { Text } from './Text';
import { color, spring } from './theme';

interface Props {
  /** When to leave and when you arrive: the window on the bar. */
  leaveAt: number;
  arriveAt: number;
  now: number;
  tone?: 'cream' | 'dark' | 'card';
}

// The bar is a fixed stretch of time around the trip: from 30 min before the
// leave time to 10 min after arrival. "Now" slides right as time passes and
// reaches the window when it's time to go.
const BEFORE_MS = 30 * 60_000;
const AFTER_MS = 10 * 60_000;
const LABEL_W = 34;
const COMBINED_W = 76;

const tones = {
  cream: { track: '#DCDCE0', window: color.ink, now: color.ink, label: color.textSecondary, nowW: 2, nowH: 16, nowTop: -4 },
  dark: { track: color.onInkFaint, window: color.onInk, now: color.onInkMuted, label: color.onInkMuted, nowW: 2, nowH: 16, nowTop: -4 },
  card: { track: '#EBEBEC', window: color.sky, now: color.ink, label: color.textSecondary, nowW: 6, nowH: 20, nowTop: -6 },
};

export function LeaveByBar({ leaveAt, arriveAt, now, tone = 'cream' }: Props) {
  const c = tones[tone];
  const [width, setWidth] = useState(0);
  const t0 = leaveAt - BEFORE_MS;
  const span = Math.max(arriveAt + AFTER_MS - t0, 1);
  const x = (t: number) => Math.min(Math.max((t - t0) / span, 0), 1) * width;

  const winLeft = useSharedValue(0);
  const winWidth = useSharedValue(0);
  const nowX = useSharedValue(0);
  const ready = width > 0;
  // The first placement is instant; only later changes animate.
  const placed = useRef(false);

  useEffect(() => {
    if (!ready) return;
    const left = x(leaveAt);
    const w = Math.max(x(arriveAt) - left, 6);
    if (!placed.current) {
      winLeft.value = left;
      winWidth.value = w;
      nowX.value = x(now);
      placed.current = true;
      return;
    }
    winLeft.value = withSpring(left, spring.smooth);
    winWidth.value = withSpring(w, spring.smooth);
  }, [leaveAt, arriveAt, width]);

  useEffect(() => {
    if (!ready || !placed.current) return;
    nowX.value = withTiming(x(now), { duration: 900, easing: Easing.out(Easing.cubic) });
  }, [now, leaveAt, arriveAt, width]);

  const windowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: winLeft.value }], width: winWidth.value }));
  const nowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: nowX.value - c.nowW / 2 }] }));

  // Labels under the window ends; one combined label when the window is too short for two.
  const split = x(arriveAt) - x(leaveAt) >= LABEL_W * 2 + 8;
  const maxLeft = Math.max(width - LABEL_W, 0);
  const maxCombined = Math.max(width - COMBINED_W, 0);
  const leftLabel = useAnimatedStyle(() => ({
    transform: [{ translateX: Math.min(Math.max(winLeft.value, 0), split ? maxLeft : maxCombined) }],
  }));
  const rightLabel = useAnimatedStyle(() => ({
    transform: [{ translateX: Math.min(Math.max(winLeft.value + winWidth.value - LABEL_W, 0), maxLeft) }],
  }));

  return (
    <View style={styles.wrap} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {ready && (
        <>
          <View style={[styles.track, { backgroundColor: c.track }]} />
          <Animated.View style={[styles.window, { backgroundColor: c.window }, windowStyle]} />
          <Animated.View style={[styles.now, { backgroundColor: c.now, width: c.nowW, height: c.nowH, top: 4 + c.nowTop, borderRadius: c.nowW / 2 }, nowStyle]} />
          <Animated.View style={[styles.label, leftLabel]}>
            <Text variant="caption" color={c.label} numberOfLines={1}>
              {split ? hhmm(leaveAt) : `${hhmm(leaveAt)}–${hhmm(arriveAt)}`}
            </Text>
          </Animated.View>
          {split && (
            <Animated.View style={[styles.label, { width: LABEL_W }, rightLabel]}>
              <Text variant="caption" color={c.label} numberOfLines={1} style={{ textAlign: 'right' }}>
                {hhmm(arriveAt)}
              </Text>
            </Animated.View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 36, width: '100%' },
  track: { position: 'absolute', left: 0, right: 0, top: 4, height: 8, borderRadius: 4 },
  window: { position: 'absolute', left: 0, top: 4, height: 8, borderRadius: 4 },
  now: { position: 'absolute', left: 0 },
  label: { position: 'absolute', left: 0, top: 20 },
});

import { useEffect } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { color, gutter } from './theme';

const BUS_W = 30;
const STOPS = [0, 1 / 3, 2 / 3, 1];

/** "Searching": a bus glides along a line of stops (each lights up as it passes), with placeholder rows below. */
export function SearchLoading({ rows }: { rows: boolean }) {
  const t = useSharedValue(0);
  const width = useSharedValue(0);
  const shimmer = useSharedValue(0.5);

  useEffect(() => {
    t.value = withRepeat(withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.cubic) }), -1, false);
    shimmer.value = withRepeat(withSequence(withTiming(1, { duration: 700 }), withTiming(0.5, { duration: 700 })), -1, false);
    return () => {
      cancelAnimation(t);
      cancelAnimation(shimmer);
    };
  }, [t, shimmer]);

  const bus = useAnimatedStyle(() => ({ transform: [{ translateX: t.value * Math.max(0, width.value - BUS_W) }] }));
  const pulse = useAnimatedStyle(() => ({ opacity: shimmer.value }));
  const onLayout = (e: LayoutChangeEvent) => {
    width.value = e.nativeEvent.layout.width;
  };

  return (
    <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(120)} style={styles.wrap} accessibilityRole="progressbar" accessibilityLabel="Searching">
      <View style={styles.track} onLayout={onLayout}>
        <View style={styles.line} />
        {STOPS.map((f) => (
          <StopDot key={f} f={f} t={t} />
        ))}
        <Animated.View style={[styles.bus, bus]}>
          <View style={styles.window} />
          <View style={styles.window} />
          <View style={styles.window} />
        </Animated.View>
      </View>
      {rows && (
        <Animated.View style={[styles.skeleton, pulse]}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.skRow}>
              <View style={styles.skIcon} />
              <View style={styles.skText}>
                <View style={[styles.skBar, { width: `${68 - i * 12}%` }]} />
                <View style={[styles.skBar, styles.skBarSmall, { width: `${40 - i * 6}%` }]} />
              </View>
            </View>
          ))}
        </Animated.View>
      )}
    </Animated.View>
  );
}

/** A stop on the line: grows a little as the bus goes by. */
function StopDot({ f, t }: { f: number; t: { value: number } }) {
  const style = useAnimatedStyle(() => {
    const near = Math.max(0, 1 - Math.abs(t.value - f) * 4);
    return { transform: [{ scale: 1 + 0.7 * near }], backgroundColor: near > 0.5 ? color.ink : color.border };
  });
  return <Animated.View style={[styles.dot, { left: `${f * 100}%` }, style]} />;
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: gutter, paddingTop: 8, gap: 20 },
  track: { height: 28, justifyContent: 'center', marginHorizontal: 4 },
  line: { position: 'absolute', left: 0, right: 0, height: 3, borderRadius: 2, backgroundColor: color.track },
  dot: { position: 'absolute', width: 8, height: 8, borderRadius: 4, marginLeft: -4, top: 10 },
  bus: { position: 'absolute', left: 0, top: 4, width: BUS_W, height: 20, borderRadius: 7, backgroundColor: color.ink, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, boxShadow: '0 2px 6px rgba(0,0,0,0.2)' },
  window: { width: 6, height: 6, borderRadius: 2, backgroundColor: color.surface },
  skeleton: { gap: 18 },
  skRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  skIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: color.surfaceMuted },
  skText: { flex: 1, gap: 8 },
  skBar: { height: 12, borderRadius: 6, backgroundColor: color.surfaceMuted },
  skBarSmall: { height: 9 },
});

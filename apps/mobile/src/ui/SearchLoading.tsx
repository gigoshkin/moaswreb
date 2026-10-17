import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { Busy } from './Spinner';
import { color, gutter } from './theme';

/** "Searching": a spinner, with placeholder rows below while there are no results yet. */
export function SearchLoading({ rows }: { rows: boolean }) {
  const shimmer = useSharedValue(0.5);

  useEffect(() => {
    shimmer.value = withRepeat(withSequence(withTiming(1, { duration: 700 }), withTiming(0.5, { duration: 700 })), -1, false);
    return () => cancelAnimation(shimmer);
  }, [shimmer]);

  const pulse = useAnimatedStyle(() => ({ opacity: shimmer.value }));

  return (
    <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(120)} style={styles.wrap}>
      <Busy label="Searching…" />
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

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: gutter, paddingTop: 12, gap: 20 },
  skeleton: { gap: 18 },
  skRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  skIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: color.surfaceMuted },
  skText: { flex: 1, gap: 8 },
  skBar: { height: 12, borderRadius: 6, backgroundColor: color.surfaceMuted },
  skBarSmall: { height: 9 },
});

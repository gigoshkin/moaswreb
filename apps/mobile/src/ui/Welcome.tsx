import { useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Extrapolation, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { router } from 'expo-router';
import { setUpAlerts } from '../lib/alerts';
import { finishIntro } from '../lib/onboarding';
import { Button } from './Button';
import { haptic, Tap } from './Tap';
import { Text } from './Text';
import { color, gutter, spring } from './theme';
import { SLIDES } from './WelcomeSlides';

const LAST = SLIDES.length - 1;
const clamp = (v: number) => {
  'worklet';
  return Math.max(0, Math.min(LAST, v));
};

/** First-open intro: three skippable screens. Notifications are asked on the last one. */
export function Welcome() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const pos = useSharedValue(0);
  const start = useSharedValue(0);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const last = page === LAST;

  const move = (next: number) => {
    pos.value = reduceMotion ? next : withSpring(next, spring.smooth);
  };
  const goTo = (i: number) => {
    const next = clamp(i);
    move(next);
    setPage(next);
    haptic('selection');
  };

  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-16, 16])
    .onBegin(() => {
      start.value = pos.value;
    })
    .onUpdate((e) => {
      pos.value = clamp(start.value - e.translationX / width);
    })
    .onEnd((e) => {
      const target = Math.round(clamp(start.value - (e.translationX + e.velocityX * 0.15) / width));
      pos.value = reduceMotion ? target : withSpring(target, spring.smooth);
      scheduleOnRN(setPage, target);
    });

  const track = useAnimatedStyle(() => ({ transform: [{ translateX: -pos.value * width }] }));

  const finish = async (askAlerts: boolean) => {
    if (busy) return;
    setBusy(true);
    // The system prompt. Denied, Expo Go or no network must not keep the user here.
    if (askAlerts) await setUpAlerts().catch(() => {});
    haptic('success');
    finishIntro(askAlerts); // flips the guard in _layout: Today appears
  };

  return (
    <View style={styles.screen}>
      <View style={[styles.top, { paddingTop: insets.top + 12 }]}>
        {!last && (
          <Tap onPress={() => finish(false)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Skip introduction">
            <Text variant="label14" color={color.textSecondary}>
              Skip
            </Text>
          </Tap>
        )}
      </View>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.track, { width: width * SLIDES.length }, track]}>
          {SLIDES.map((s, i) => (
            <View key={s.title} style={{ width, paddingHorizontal: gutter }} accessibilityElementsHidden={i !== page} importantForAccessibility={i === page ? 'auto' : 'no-hide-descendants'}>
              <View style={styles.art}>{s.art}</View>
              <Text variant="headline" accessibilityRole="header">
                {s.title}
              </Text>
              <Text variant="body16" color={color.textSecondary} style={styles.body}>
                {s.body}
              </Text>
            </View>
          ))}
        </Animated.View>
      </GestureDetector>
      <View style={styles.dots}>
        {SLIDES.map((s, i) => (
          <PageDot key={s.title} i={i} pos={pos} />
        ))}
      </View>
      <View style={[styles.bottom, { paddingBottom: insets.bottom + 16 }]}>
        {last ? (
          <>
            <Button label="Turn on alerts" onPress={() => finish(true)} disabled={busy} />
            <Tap onPress={() => finish(false)} disabled={busy} style={styles.later} accessibilityRole="button">
              <Text variant="label14">Not now</Text>
            </Tap>
            <Tap onPress={() => router.push('/privacy')} style={styles.later} accessibilityRole="link">
              <Text variant="caption" color={color.textSecondary}>
                How we handle your data
              </Text>
            </Tap>
          </>
        ) : (
          <Button label="Next" onPress={() => goTo(page + 1)} />
        )}
      </View>
    </View>
  );
}

function PageDot({ i, pos }: { i: number; pos: SharedValue<number> }) {
  const s = useAnimatedStyle(() => ({
    width: interpolate(pos.value, [i - 1, i, i + 1], [6, 18, 6], Extrapolation.CLAMP),
    backgroundColor: Math.abs(pos.value - i) < 0.5 ? color.ink : color.track,
  }));
  return <Animated.View style={[styles.dot, s]} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  top: { height: 68, paddingHorizontal: gutter, alignItems: 'flex-end' },
  track: { flex: 1, flexDirection: 'row' },
  art: { flex: 1, maxHeight: 300, justifyContent: 'center', marginBottom: 24 },
  body: { marginTop: 12 },
  dots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingVertical: 16 },
  dot: { height: 6, borderRadius: 3 },
  bottom: { paddingHorizontal: gutter, gap: 0, alignItems: 'stretch', minHeight: 52 + 2 * 40 },
  later: { alignSelf: 'center', paddingVertical: 12, paddingHorizontal: 8 },
});

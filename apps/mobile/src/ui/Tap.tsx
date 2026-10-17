import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { spring } from './theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface Props extends Omit<PressableProps, 'style' | 'children'> {
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  /** How far it shrinks while pressed. Rows use a smaller value than buttons. */
  scaleTo?: number;
  /** Full-width rows darken a touch instead of shrinking (shrinking would pull their edges in). */
  feedback?: 'scale' | 'tint';
  haptic?: 'light' | 'selection' | 'success' | 'none';
}

export const haptic = (kind: Props['haptic']) => {
  if (kind === 'light') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  else if (kind === 'selection') Haptics.selectionAsync().catch(() => {});
  else if (kind === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
};

/** Pressable that gives way under the finger on a spring. Every tappable thing in the app uses it. */
export function Tap({ style, children, scaleTo = 0.97, feedback = 'scale', haptic: h = 'none', onPress, onPressIn, onPressOut, disabled, ...rest }: Props) {
  const pressed = useSharedValue(0);
  const animated = useAnimatedStyle(() => (feedback === 'scale' ? { transform: [{ scale: 1 - (1 - scaleTo) * pressed.value }] } : {}));
  const overlay = useAnimatedStyle(() => ({ opacity: pressed.value * 0.045 }));
  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(e) => {
        pressed.value = withSpring(1, spring.snappy);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        pressed.value = withSpring(0, spring.snappy);
        onPressOut?.(e);
      }}
      onPress={(e) => {
        haptic(h);
        onPress?.(e);
      }}
      style={[style, animated]}
    >
      {children}
      {feedback === 'tint' && <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.tint, overlay]} />}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({ tint: { backgroundColor: '#000' } });

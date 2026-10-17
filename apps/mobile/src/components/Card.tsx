import * as Haptics from 'expo-haptics';
import { useEffect, type ReactNode } from 'react';
import { Pressable, type ViewStyle } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useColors } from '../theme/theme';
import { radius, space, springs } from '../theme/tokens';

interface Props {
  children: ReactNode;
  /** "About to leave": corners tighten and the fill turns solid (shape change, not just colour). */
  urgent?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
}

/**
 * Base surface. Press feedback is a spring scale; the urgent state morphs the
 * radius and fill on a spring, with a light haptic when it flips on.
 */
export function Card({ children, urgent = false, onPress, style }: Props) {
  const c = useColors();
  const pressed = useSharedValue(0);
  const state = useSharedValue(urgent ? 1 : 0);

  useEffect(() => {
    state.value = withSpring(urgent ? 1 : 0, springs.morph);
    if (urgent) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, [urgent]);

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * 0.03 }],
    borderRadius: radius.card + (radius.cardUrgent - radius.card) * state.value,
    backgroundColor: interpolateColor(state.value, [0, 1], [c.surface, c.accent]),
    borderColor: interpolateColor(state.value, [0, 1], [c.hairline, c.accent]),
  }));

  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      onPressIn={() => (pressed.value = withSpring(1, springs.snappy))}
      onPressOut={() => (pressed.value = withSpring(0, springs.snappy))}
      accessibilityRole={onPress ? 'button' : undefined}
    >
      <Animated.View style={[{ padding: space.xl, borderWidth: 1, borderCurve: 'continuous' }, animated, style]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

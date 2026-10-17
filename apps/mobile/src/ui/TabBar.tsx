import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { interpolate, Extrapolation, useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from './Icon';
import { haptic } from './Tap';
import { Text } from './Text';
import { color, spring } from './theme';

const TABS: Record<string, { label: string; icon: IconName }> = {
  index: { label: 'Today', icon: 'today' },
  week: { label: 'Week', icon: 'week' },
  chat: { label: 'Chat', icon: 'chat' },
  settings: { label: 'Settings', icon: 'settings' },
};

const PILL_W = 64;
const PILL_H = 32;
export const TAB_BAR_HEIGHT = 72;

/**
 * Bottom navigation (Figma "Tab bar"): the active tab has an ink pill behind
 * its icon. Switching tabs stretches the pill toward the new tab on a stiff
 * spring for the leading edge and a softer one for the trailing edge, and
 * the icons change colour where the pill passes over them.
 */
export function TabBar({ state, emitter, navigateToTab }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const [width, setWidth] = useState(0);
  const count = state.routes.length;
  const slot = width / Math.max(count, 1);
  const center = (i: number) => slot * i + slot / 2;

  const left = useSharedValue(0);
  const right = useSharedValue(0);
  const placed = useRef(false);

  useEffect(() => {
    if (!width) return;
    const l = center(state.index) - PILL_W / 2;
    const r = l + PILL_W;
    if (!placed.current) {
      left.value = l;
      right.value = r;
      placed.current = true;
      return;
    }
    const goingRight = l > left.value;
    left.value = withSpring(l, goingRight ? spring.trail : spring.lead);
    right.value = withSpring(r, goingRight ? spring.lead : spring.trail);
  }, [state.index, width]);

  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: left.value }], width: right.value - left.value }));

  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom, height: TAB_BAR_HEIGHT + insets.bottom }]}>
      <View style={styles.row} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 && <Animated.View style={[styles.pill, pill]} />}
        {state.routes.map((route, i) => {
          const tab = TABS[route.name];
          if (!tab) return null;
          const focused = state.index === i;
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={tab.label}
              style={styles.tab}
              onPress={() => {
                const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) {
                  haptic('selection');
                  navigateToTab(route.key);
                }
              }}
            >
              <TabIcon name={tab.icon} center={center(i)} left={left} right={right} />
              <Text variant={focused ? 'captionStrong' : 'caption'} color={focused ? color.text : color.textSecondary}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Ink icon with a white copy on top that shows where the pill covers it. */
function TabIcon({ name, center, left, right }: { name: IconName; center: number; left: SharedValue<number>; right: SharedValue<number> }) {
  const white = useAnimatedStyle(() => {
    // How much of the icon (24 px wide) the pill covers.
    const covered = Math.min(right.value, center + 12) - Math.max(left.value, center - 12);
    return { opacity: interpolate(covered, [4, 20], [0, 1], Extrapolation.CLAMP) };
  });
  return (
    <View style={styles.icon}>
      <Icon name={name} size={24} color={color.ink} />
      <Animated.View style={[StyleSheet.absoluteFill, white]}>
        <Icon name={name} size={24} color={color.onInk} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: color.surface, borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: color.border, paddingHorizontal: 8 },
  row: { flex: 1, flexDirection: 'row' },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  icon: { width: 24, height: 24, marginVertical: (PILL_H - 24) / 2 },
  pill: { position: 'absolute', top: (TAB_BAR_HEIGHT - (PILL_H + 4 + 16)) / 2, height: PILL_H, borderRadius: PILL_H / 2, backgroundColor: color.ink },
});

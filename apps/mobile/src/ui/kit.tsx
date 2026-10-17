import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useDerivedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from './Icon';
import { RoutePlate } from './RoutePlate';
import { Tap } from './Tap';
import { Text } from './Text';
import { color, gutter, radius, shadow, spring } from './theme';

/** Screen top bar for pushed screens: back (or close) and a title (Figma "Top bar"). */
export function TopBar({ title, close, right }: { title: string; close?: boolean; right?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.topBar, { paddingTop: insets.top + 12 }]}>
      <Tap onPress={() => router.back()} hitSlop={10} scaleTo={0.9} accessibilityRole="button" accessibilityLabel={close ? 'Close' : 'Back'} style={styles.topBarButton}>
        <Icon name={close ? 'close' : 'back'} size={24} />
      </Tap>
      <Text variant={close ? 'title20' : 'label16'} numberOfLines={1} style={styles.topBarTitle}>
        {title}
      </Text>
      {right}
    </View>
  );
}

/** Tab screen title, e.g. "Chat", "Settings". `bar`: white with a hairline shadow, for content that scrolls under it. */
export function ScreenTitle({ title, right, bar }: { title: string; right?: ReactNode; bar?: boolean }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screenTitle, { paddingTop: insets.top + 24 }, bar && styles.screenTitleBar]}>
      <Text variant="title26">{title}</Text>
      {right}
    </View>
  );
}

/** White rounded card. */
export function Card({ children, style, tint }: { children: ReactNode; style?: StyleProp<ViewStyle>; tint?: string }) {
  return <View style={[styles.card, tint ? { backgroundColor: tint } : null, style]}>{children}</View>;
}

/** On/off switch, 48×28 (Figma "Switch"). */
export function Switch({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  const on = useDerivedValue(() => withSpring(value ? 1 : 0, spring.snappy), [value]);
  const track = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(on.value, [0, 1], [color.border, color.ink]) }));
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: 3 + on.value * 20 }] }));
  return (
    <Tap onPress={() => onChange(!value)} haptic="selection" scaleTo={0.94} accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value }}>
      <Animated.View style={[styles.switchTrack, track]}>
        <Animated.View style={[styles.switchKnob, knob]} />
      </Animated.View>
    </Tap>
  );
}

/** Day chip in Add trip: ink when on, grey with a hairline when off. */
export function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const v = useDerivedValue(() => withSpring(on ? 1 : 0, spring.snappy), [on]);
  const bg = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(v.value, [0, 1], [color.surfaceMuted, color.ink]),
    borderColor: interpolateColor(v.value, [0, 1], [color.border, color.ink]),
  }));
  return (
    <Tap onPress={onPress} haptic="selection" scaleTo={0.92} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={label}>
      <Animated.View style={[styles.chip, bg]}>
        <Text variant={on ? 'label13' : 'body13'} color={on ? color.onInk : color.text}>
          {label}
        </Text>
      </Animated.View>
    </Tap>
  );
}

/** Walk minutes, first route and arrival: "🚶 6 min [306] Arrive 08:41". */
export function RouteSummary({ walkMin, routes, arrive, dark }: { walkMin: number; routes: { label: string; metro: boolean }[]; arrive: string; dark?: boolean }) {
  const muted = dark ? color.onInkMuted : color.textSecondary;
  return (
    <View style={styles.summary}>
      {walkMin > 0 && (
        <>
          <Icon name="walk" size={20} color={muted} />
          <Text variant="caption" color={muted}>
            {walkMin} min
          </Text>
        </>
      )}
      {routes.map((r, i) => (
        <RoutePlate key={`${r.label}${i}`} label={r.label} metro={r.metro} onDark={dark} />
      ))}
      <Text variant="caption" color={muted} numberOfLines={1} style={styles.flexShrink}>
        {arrive}
      </Text>
    </View>
  );
}

/** Small uppercase section label ("LATER TODAY", "ROUTE DETAILS"). */
export function SectionLabel({ children, style }: { children: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.section, style]}>
      <Text variant="overline" color={color.textSecondary}>
        {children.toUpperCase()}
      </Text>
    </View>
  );
}

/** Settings-style row inside a grouped card. */
export function GroupRow({ label, value, icon, onPress, right, last }: { label: string; value?: string; icon?: IconName; onPress?: () => void; right?: ReactNode; last?: boolean }) {
  const body = (
    <View style={[styles.groupRow, !last && styles.groupRowBorder]}>
      {icon && <Icon name={icon} size={24} />}
      <Text variant="body15" style={styles.flex} numberOfLines={1}>
        {label}
      </Text>
      {value !== undefined && (
        <Text variant="body15" color={color.textSecondary} numberOfLines={1} style={styles.groupValue}>
          {value}
        </Text>
      )}
      {right ?? (onPress && <Icon name="chevron-right" size={20} color={color.textTertiary} />)}
    </View>
  );
  return onPress ? (
    <Tap onPress={onPress} scaleTo={0.985} accessibilityRole="button" accessibilityLabel={value ? `${label}, ${value}` : label}>
      {body}
    </Tap>
  ) : (
    body
  );
}

export function Group({ children }: { children: ReactNode }) {
  return <View style={styles.group}>{children}</View>;
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 12, paddingRight: gutter, paddingBottom: 12, backgroundColor: color.surface, ...shadow.bar },
  topBarButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.full },
  topBarTitle: { flex: 1 },
  screenTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: gutter, paddingBottom: 12 },
  screenTitleBar: { backgroundColor: color.surface, zIndex: 1, ...shadow.bar },
  card: { backgroundColor: color.surface, borderRadius: radius.lg, padding: 20, ...shadow.card },
  switchTrack: { width: 48, height: 28, borderRadius: 14, justifyContent: 'center' },
  switchKnob: { width: 22, height: 22, borderRadius: 11, backgroundColor: color.surface },
  chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: radius.full, borderWidth: 1 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flexShrink: { flexShrink: 1 },
  flex: { flex: 1 },
  section: { paddingHorizontal: gutter, paddingTop: 24, paddingBottom: 8 },
  group: { backgroundColor: color.surface, borderRadius: radius.md, overflow: 'hidden', ...shadow.card },
  groupRow: { height: 56, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16 },
  groupRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth * 2, borderBottomColor: color.border },
  groupValue: { maxWidth: '55%' },
});

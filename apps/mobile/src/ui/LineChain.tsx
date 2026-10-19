import { useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, Extrapolation, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import type { Slot } from '@transit/shared';
import { Icon } from './Icon';
import { RoutePlate } from './RoutePlate';
import { Tap, haptic } from './Tap';
import { color } from './theme';

/** One line of a ride, and one ride (the lines that can do it): the shared route model's types. */
export type { LineRef, Slot } from '@transit/shared';

interface Props {
  slots: Slot[];
  size?: 'xs' | 'sm' | 'md';
  onDark?: boolean;
  /** Rides shown before the rest are cut off. */
  max?: number;
}

/**
 * The rides of a trip like Google Maps draws them: an arrow between rides
 * (you change there) and numbers held in one capsule when several lines
 * cover the same ride (any of them works).
 */
export function LineChain({ slots, size = 'md', onDark, max = 3 }: Props) {
  const shown = slots.slice(0, max);
  return (
    <View style={styles.chain}>
      {/* The arrow belongs to the ride before it, so a wrapped line never starts with an arrow. */}
      {shown.map((slot, i) => (
        <View key={i} style={styles.row}>
          <Stack slot={slot} size={size} onDark={onDark} />
          {i < shown.length - 1 && <Icon name="chevron-right" size={size === 'md' ? 16 : size === 'sm' ? 14 : 12} color={onDark ? color.onInkMuted : color.textTertiary} />}
        </View>
      ))}
    </View>
  );
}

/** How far each card behind the front one peeks out (right and up), by plate size. */
const PEEK = { xs: { x: 3, y: 2 }, sm: { x: 3, y: 2 }, md: { x: 4, y: 3 } } as const;
/** Cards drawn behind the front one; more lines still come round when shuffled. */
const BEHIND = 2;
const SHUFFLE_MS = 340;

/**
 * Alternatives for one ride as a small deck of plates: the front one shows its
 * number, the others peek out behind it (any of these lines does the ride).
 * A tap shuffles the deck: the front plate lifts off and goes to the back, and
 * the next line comes forward. Only the look changes; every line stays allowed.
 */
export function Stack({ slot, size = 'md', onDark }: { slot: Slot; size?: 'xs' | 'sm' | 'md'; onDark?: boolean }) {
  if (slot.length === 1) return <RoutePlate label={slot[0].label} kind={slot[0].kind} size={size} onDark={onDark} />;
  return <Deck slot={slot} size={size} onDark={onDark} />;
}

function Deck({ slot, size, onDark }: { slot: Slot; size: 'xs' | 'sm' | 'md'; onDark?: boolean }) {
  // `turn` counts shuffles; the whole number is which line is in front, the fraction is a shuffle under way.
  const turn = useSharedValue(0);
  const reduced = useReducedMotion();
  const [front, setFront] = useState(0);
  // Every plate as wide as the widest, so the back ones peek out by the same edge.
  const [width, setWidth] = useState(0);
  const widths = useRef<number[]>([]);
  const n = slot.length;
  const peek = PEEK[size];
  const shown = Math.min(n - 1, BEHIND);

  const shuffle = () => {
    haptic('selection');
    const next = Math.floor(turn.value) + 1;
    turn.value = reduced ? next : withTiming(next, { duration: SHUFFLE_MS, easing: Easing.inOut(Easing.cubic) });
    setFront(next % n);
  };

  return (
    <Tap
      onPress={shuffle}
      scaleTo={0.94}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={`Any of ${slot.map((l) => l.label).join(', ')}. Showing ${slot[front].label}`}
      accessibilityHint="Shows the next line"
      style={{ paddingRight: shown * peek.x, paddingTop: shown * peek.y }}
    >
      <View>
        {slot.map((l, i) => (
          <Card
            key={l.label}
            index={i}
            n={n}
            turn={turn}
            peek={peek}
            width={width}
            first={i === 0}
            onWidth={(w) => {
              widths.current[i] = w;
              const max = Math.max(...widths.current.filter(Boolean));
              if (widths.current.filter(Boolean).length === n && max !== width) setWidth(max);
            }}
          >
            <RoutePlate label={l.label} kind={l.kind} size={size} onDark={onDark} edged />
          </Card>
        ))}
      </View>
    </Tap>
  );
}

function Card({ index, n, turn, peek, width, first, onWidth, children }: { index: number; n: number; turn: SharedValue<number>; peek: { x: number; y: number }; width: number; first: boolean; onWidth: (w: number) => void; children: ReactNode }) {
  const style = useAnimatedStyle(() => {
    const step = Math.floor(turn.value);
    const f = turn.value - step;
    // Depth when this shuffle began: 0 is the front card.
    const d = (((index - step) % n) + n) % n;
    // The front card travels to the back, lifting as it goes; the rest move up one place.
    const pos = d === 0 ? f * (n - 1) : d - f;
    const lift = d === 0 ? Math.sin(Math.PI * f) : 0;
    const shownPos = Math.min(pos, BEHIND);
    return {
      zIndex: d === 0 ? (f < 0.5 ? n + 1 : 0) : n - d,
      opacity: interpolate(pos, [BEHIND, BEHIND + 0.6], [1, 0], Extrapolation.CLAMP),
      transform: [
        { translateX: shownPos * peek.x + lift * 10 },
        { translateY: -shownPos * peek.y - lift * 8 },
        { rotate: `${lift * 6}deg` },
      ],
    };
  });
  return (
    <Animated.View
      onLayout={(e) => onWidth(e.nativeEvent.layout.width)}
      // The first card sizes the deck; the rest lie on top of it at their own width until the widest is known.
      style={[first ? null : styles.behind, width ? { width } : null, styles.card, style]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  // Wraps to a second line instead of running off the card when a trip has several rides.
  chain: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', rowGap: 4, flexShrink: 1, minWidth: 0 },
  // Plates stretch to the deck's width (the widest number); the plate's own centring keeps the label in the middle.
  card: { alignItems: 'stretch' },
  behind: { position: 'absolute', left: 0, top: 0 },
});

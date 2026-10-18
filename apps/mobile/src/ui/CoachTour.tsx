import { useCallback, useEffect, useRef, useState, type ComponentRef, type RefObject } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Tap } from './Tap';
import { Text } from './Text';
import { color, gutter, radius, shadow } from './theme';

/** What a ref on a `<View>` holds. */
export type ViewRef = ComponentRef<typeof View>;

export interface TourStep {
  /** The view to highlight (give it `collapsable={false}`). */
  target: RefObject<ViewRef | null>;
  text: string;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PAD = 8;
const DIM = 'rgba(28,26,26,0.72)';

/** Dims its parent (render it last, absolutely filling the screen) and spotlights one target at a time. */
export function CoachTour({ steps, onDone }: { steps: TourStep[]; onDone: () => void }) {
  const root = useRef<ViewRef>(null);
  const [i, setI] = useState(0);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hole, setHole] = useState<Rect | null>(null);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const w = useSharedValue(0);
  const h = useSharedValue(0);
  const first = useRef(true);

  const measure = useCallback(() => {
    const target = steps[i]?.target.current;
    if (!target || !root.current || !size.w) return;
    root.current.measureInWindow((ox, oy) => {
      target.measureInWindow((tx, ty, tw, th) => {
        if (!tw || !th) return; // not laid out yet: the next layout pass retries
        const r = { x: tx - ox - PAD, y: ty - oy - PAD, w: tw + PAD * 2, h: th + PAD * 2 };
        setHole(r);
        const t = { duration: first.current ? 0 : 260 };
        first.current = false;
        x.value = withTiming(r.x, t);
        y.value = withTiming(r.y, t);
        w.value = withTiming(r.w, t);
        h.value = withTiming(r.h, t);
      });
    });
  }, [i, size.w, steps]);

  // Wait a frame so the target has its final layout (Android reports 0s before that).
  useEffect(() => {
    const t = setTimeout(measure, 60);
    return () => clearTimeout(t);
  }, [measure]);

  const top = useAnimatedStyle(() => ({ left: 0, right: 0, top: 0, height: Math.max(0, y.value) }));
  const bottom = useAnimatedStyle(() => ({ left: 0, right: 0, top: y.value + h.value, bottom: 0 }));
  const left = useAnimatedStyle(() => ({ left: 0, width: Math.max(0, x.value), top: y.value, height: h.value }));
  const right = useAnimatedStyle(() => ({ left: x.value + w.value, right: 0, top: y.value, height: h.value }));
  const ring = useAnimatedStyle(() => ({ left: x.value, top: y.value, width: w.value, height: h.value }));

  const last = i === steps.length - 1;
  const below = hole ? hole.y + hole.h + 190 < size.h : true;
  const tipTop = hole ? (below ? hole.y + hole.h + 12 : undefined) : undefined;
  const tipBottom = hole && !below ? size.h - hole.y + 12 : undefined;

  return (
    <View
      ref={root}
      collapsable={false}
      style={StyleSheet.absoluteFill}
      onLayout={(e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      accessibilityViewIsModal
    >
      {/* Swallows touches so the form can't be used mid-tour. */}
      <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(160)} style={StyleSheet.absoluteFill}>
        <View style={StyleSheet.absoluteFill} onStartShouldSetResponder={() => true} />
        {hole && (
          <>
            <Animated.View pointerEvents="none" style={[styles.dim, top]} />
            <Animated.View pointerEvents="none" style={[styles.dim, bottom]} />
            <Animated.View pointerEvents="none" style={[styles.dim, left]} />
            <Animated.View pointerEvents="none" style={[styles.dim, right]} />
            <Animated.View pointerEvents="none" style={[styles.ring, ring]} />
            <View style={[styles.tip, { top: tipTop, bottom: tipBottom }]}>
              <Text variant="caption" color={color.textSecondary}>
                {i + 1} of {steps.length}
              </Text>
              <Text variant="label16">{steps[i]?.text}</Text>
              <View style={styles.actions}>
                {last ? (
                  <View />
                ) : (
                  <Tap onPress={onDone} hitSlop={8} accessibilityRole="button" accessibilityLabel="Skip intro">
                    <Text variant="label14" color={color.textSecondary}>
                      Skip
                    </Text>
                  </Tap>
                )}
                <Tap
                  onPress={() => (last ? onDone() : setI(i + 1))}
                  scaleTo={0.94}
                  style={styles.next}
                  accessibilityRole="button"
                  accessibilityLabel={last ? 'Done' : 'Next'}
                >
                  <Text variant="label14" color={color.surface}>
                    {last ? 'Done' : 'Next'}
                  </Text>
                </Tap>
              </View>
            </View>
          </>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  dim: { position: 'absolute', backgroundColor: DIM },
  ring: { position: 'absolute', borderRadius: radius.lg, borderWidth: 2, borderColor: color.surface },
  tip: {
    position: 'absolute',
    left: gutter,
    right: gutter,
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    padding: 20,
    gap: 8,
    ...shadow.card,
  },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8 },
  next: { backgroundColor: color.ink, borderRadius: radius.full, paddingHorizontal: 20, paddingVertical: 10 },
});

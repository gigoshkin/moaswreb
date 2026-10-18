import { useEffect, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color } from './theme';

const ENTER_MS = 280;
const EXIT_MS = 200;

interface Props {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Bottom sheet over a dimmed backdrop. Tap outside or the Android back button closes it.
 * The Modal stays mounted for the length of the exit animation, so the sheet can slide away.
 * The slide is one shared value on the sheet's own transform (not a layout animation), so what slides is what stays:
 * it starts below the screen, moves to 0 and stops, with no overshoot and no jump at the end.
 */
export function Sheet({ visible, onClose, children }: Props) {
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const screenH = useWindowDimensions().height;
  const y = useSharedValue(screenH);
  const slide = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));

  useEffect(() => {
    if (visible) {
      y.value = screenH;
      setMounted(true);
      y.value = withTiming(0, { duration: ENTER_MS, easing: Easing.out(Easing.cubic) });
      return;
    }
    y.value = withTiming(screenH, { duration: EXIT_MS, easing: Easing.in(Easing.cubic) });
    const t = setTimeout(() => setMounted(false), EXIT_MS);
    return () => clearTimeout(t);
  }, [visible, screenH, y]);

  return (
    <Modal visible={mounted} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      {visible && (
        <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(EXIT_MS)} style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        </Animated.View>
      )}
      <Animated.View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }, slide]}>
        <Animated.View style={styles.grip} />
        {children}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(28,26,26,0.45)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: color.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8, paddingHorizontal: 16 },
  grip: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: color.border, marginBottom: 12 },
});

import { useEffect, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, spring } from './theme';

const EXIT_MS = 200;

interface Props {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Bottom sheet over a dimmed backdrop. Tap outside or the Android back button closes it.
 * The Modal stays mounted for the length of the exit animation, so the sheet can slide away.
 */
export function Sheet({ visible, onClose, children }: Props) {
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      return;
    }
    const t = setTimeout(() => setMounted(false), EXIT_MS);
    return () => clearTimeout(t);
  }, [visible]);

  return (
    <Modal visible={mounted} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      {visible && (
        <>
          <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(EXIT_MS)} style={styles.backdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
          </Animated.View>
          <Animated.View
            entering={SlideInDown.springify().damping(spring.sheet.damping).stiffness(spring.sheet.stiffness).mass(spring.sheet.mass)}
            exiting={SlideOutDown.duration(EXIT_MS)}
            style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}
          >
            <Animated.View style={styles.grip} />
            {children}
          </Animated.View>
        </>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(28,26,26,0.45)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: color.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8, paddingHorizontal: 16 },
  grip: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: color.border, marginBottom: 12 },
});

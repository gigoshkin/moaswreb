import { ActivityIndicator, StyleSheet } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { Text } from './Text';
import { color } from './theme';

/** The system spinner in the app's ink colour. */
export const Spinner = ({ size = 'small', tint = color.ink }: { size?: 'small' | 'large'; tint?: string }) => <ActivityIndicator size={size} color={tint} />;

/** A spinner with what it is doing: "Looking at every line…". Fades in so quick answers don't flash it. */
export function Busy({ label, tint = color.textSecondary }: { label: string; tint?: string }) {
  return (
    <Animated.View entering={FadeIn.duration(150).delay(120)} exiting={FadeOut.duration(100)} style={styles.row} accessibilityRole="progressbar" accessibilityLabel={label}>
      <Spinner tint={tint} />
      <Text variant="body14" color={tint}>
        {label}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});

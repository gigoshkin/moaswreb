import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOutUp, LayoutAnimationConfig, LinearTransition } from 'react-native-reanimated';
import { Text } from './Text';
import { color, spring, type } from './theme';

interface Props {
  /** "Leave in" */
  prefix: string;
  /** "7" or "10:40": the part that rolls when it changes. */
  value: string;
  /** "min", or nothing. */
  suffix?: string;
  tint?: string;
}

// The big number and the 26 px words share a baseline. With the font's
// metrics (ascender 0.795, descender 0.205 em) the baseline sits this far
// above the bottom of a line box: (lineHeight − size)/2 + 0.205·size.
const fromBottom = (size: number, lineHeight: number) => (lineHeight - size) / 2 + 0.205 * size;
const WORD_OFFSET = fromBottom(type.display.fontSize!, type.display.lineHeight!) - fromBottom(type.title26.fontSize!, type.title26.lineHeight!);

const enter = FadeInDown.springify().damping(spring.smooth.damping).stiffness(spring.smooth.stiffness).withInitialValues({ transform: [{ translateY: 36 }] });
const exit = FadeOutUp.duration(220).withInitialValues({ transform: [{ translateY: 0 }] });
const layout = LinearTransition.duration(240);

/** "Leave in 7 min": the number rolls up when it changes, the words make room on a spring. */
export function Countdown({ prefix, value, suffix, tint = color.text }: Props) {
  return (
    <View style={styles.row} accessible accessibilityLabel={[prefix, value, suffix === 'min' ? 'minutes' : suffix].filter(Boolean).join(' ')}>
      <Animated.View layout={layout}>
        <Text variant="title26" color={tint} style={{ marginBottom: WORD_OFFSET }}>
          {prefix}
        </Text>
      </Animated.View>
      <Animated.View layout={layout} style={styles.numberClip}>
        {/* No roll on first show, only when the value changes. */}
        <LayoutAnimationConfig skipEntering>
          <Animated.View key={value} entering={enter} exiting={exit}>
            <Text variant="display" color={tint} numberOfLines={1}>
              {value}
            </Text>
          </Animated.View>
        </LayoutAnimationConfig>
      </Animated.View>
      {suffix ? (
        <Animated.View layout={layout}>
          <Text variant="title26" color={tint} style={{ marginBottom: WORD_OFFSET }}>
            {suffix}
          </Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  numberClip: { overflow: 'hidden', height: type.display.lineHeight },
});

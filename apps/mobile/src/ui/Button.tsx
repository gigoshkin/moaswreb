import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Icon, type IconName } from './Icon';
import { Tap } from './Tap';
import { Text } from './Text';
import { color, radius } from './theme';

interface Props {
  label: string;
  /** Drawn before the label. */
  icon?: IconName;
  onPress: () => void;
  /** primary = ink fill; secondary = white with a hairline. */
  kind?: 'primary' | 'secondary';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  haptic?: 'light' | 'success' | 'none';
}

/** 52 px tall, 14 px radius (Figma "Button"). */
export function Button({ label, icon, onPress, kind = 'primary', disabled, style, haptic = 'light' }: Props) {
  const primary = kind === 'primary';
  return (
    <Tap
      onPress={onPress}
      disabled={disabled}
      haptic={haptic}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={[styles.base, primary ? styles.primary : styles.secondary, disabled && styles.disabled, style]}
    >
      {icon && <Icon name={icon} size={20} color={primary ? color.onInk : color.text} />}
      <Text variant="label16" color={primary ? color.onInk : color.text} numberOfLines={1}>
        {label}
      </Text>
    </Tap>
  );
}

const styles = StyleSheet.create({
  base: { height: 52, borderRadius: radius.md, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  primary: { backgroundColor: color.ink },
  secondary: { backgroundColor: color.surface, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: color.border },
  disabled: { opacity: 0.35 },
});

import { Text as RNText, type TextProps } from 'react-native';
import { color, type, type TypeName } from './theme';

interface Props extends TextProps {
  variant?: TypeName;
  color?: string;
}

/**
 * Text in the app font. No font padding on Android, so line heights match
 * Figma. System font scaling is capped so fixed rows don't clip.
 */
export function Text({ variant = 'body15', color: c = color.text, style, ...rest }: Props) {
  return <RNText maxFontSizeMultiplier={1.15} {...rest} style={[type[variant], { color: c, includeFontPadding: false }, style]} />;
}

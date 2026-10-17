import { Text as RNText, type TextProps } from 'react-native';
import { fontFor, useColors } from '../theme/theme';
import { type as typeScale, type TypeVariant, type Weight } from '../theme/tokens';

interface Props extends TextProps {
  variant?: TypeVariant;
  weight?: Weight;
  color?: 'text' | 'textMuted' | 'textFaint' | 'accent' | 'late' | (string & {});
  /** Tabular numerals so live numbers don't jitter. */
  tabular?: boolean;
  children: string | number | (string | number)[];
}

/** The only text component. Picks the font by script, size by variant. */
export function Text({ variant = 'body', weight, color = 'text', tabular, style, children, ...rest }: Props) {
  const c = useColors();
  const t = typeScale[variant];
  const content = Array.isArray(children) ? children.join('') : String(children);
  const tint = color in c ? c[color as keyof typeof c] : color;
  return (
    <RNText
      {...rest}
      style={[
        {
          fontFamily: fontFor(content, weight ?? t.weight),
          fontSize: t.size,
          lineHeight: t.lineHeight,
          letterSpacing: t.tracking,
          color: tint,
          fontVariant: tabular ? ['tabular-nums'] : undefined,
        },
        style,
      ]}
    >
      {content}
    </RNText>
  );
}

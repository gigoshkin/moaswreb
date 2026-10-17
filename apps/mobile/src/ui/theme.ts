import { Platform, type TextStyle, type ViewStyle } from 'react-native';
import type { WithSpringConfig } from 'react-native-reanimated';

// Design tokens from andro's Figma ("Moaswreb App": style guide + Screens v2).
// Screens use a few near-duplicates (#111113 / #1C1A1A, radius 14 / 24 on
// buttons); these are the one value each that the app uses.

export const color = {
  ink: '#1C1A1A',
  text: '#1C1A1A',
  textSecondary: '#5C5C63',
  textTertiary: '#9C9CA3',
  bg: '#F7F7F7',
  surface: '#FFFFFF',
  surfaceMuted: '#F4F4F5',
  border: '#E7E7EA',
  track: '#E7E7EA',
  cream: '#FDF6E4',
  sky: '#D0EDF6',
  onInk: '#FFFFFF',
  onInkMuted: 'rgba(255,255,255,0.6)',
  onInkFaint: 'rgba(255,255,255,0.13)',
  onInkPill: 'rgba(255,255,255,0.1)',
} as const;

export const font = {
  regular: 'Metropolis-Regular',
  medium: 'Metropolis-Medium',
  semibold: 'Metropolis-SemiBold',
  bold: 'Metropolis-Bold',
} as const;

export const fontFiles = {
  [font.regular]: require('../../assets/fonts/Metropolis-Regular.ttf'),
  [font.medium]: require('../../assets/fonts/Metropolis-Medium.ttf'),
  [font.semibold]: require('../../assets/fonts/Metropolis-SemiBold.ttf'),
  [font.bold]: require('../../assets/fonts/Metropolis-Bold.ttf'),
};

const t = (fontFamily: string, fontSize: number, lineHeight: number, letterSpacing = 0): TextStyle => ({
  fontFamily,
  fontSize,
  lineHeight,
  letterSpacing,
});

/** Type scale. Names say size and role; weights are fixed per role. */
export const type = {
  display: t(font.bold, 72, 76),
  time56: t(font.bold, 56, 60, -1),
  headline: t(font.bold, 30, 38, -0.5),
  title26: t(font.bold, 26, 34, -0.13),
  title20: t(font.bold, 20, 28, -0.2),
  title18: t(font.bold, 18, 26),
  time18: t(font.semibold, 18, 26),
  body16: t(font.regular, 16, 24),
  label16: t(font.semibold, 16, 22),
  name16: t(font.medium, 16, 24),
  body15: t(font.regular, 15, 22),
  body14: t(font.regular, 14, 20),
  label14: t(font.semibold, 14, 20),
  body13: t(font.regular, 13, 18),
  label13: t(font.medium, 13, 18),
  caption: t(font.regular, 12, 16),
  captionStrong: t(font.semibold, 12, 16),
  overline: t(font.regular, 12, 16, 0.4),
} as const;

export type TypeName = keyof typeof type;

export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24 } as const;
export const radius = { xs: 6, sm: 8, md: 14, lg: 24, full: 999 } as const;

/** Screen side padding. */
export const gutter = 20;

export const shadow = {
  card: Platform.select<ViewStyle>({
    ios: { shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 2 } },
    default: { boxShadow: '0px 2px 10px rgba(0,0,0,0.06)' },
  }),
  soft: Platform.select<ViewStyle>({
    ios: { shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
    default: { boxShadow: '0px 2px 6px rgba(0,0,0,0.05)' },
  }),
  bar: Platform.select<ViewStyle>({
    ios: { shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
    default: { boxShadow: '0px 1px 2px rgba(0,0,0,0.04)' },
  }),
};

/** Springs. `snappy` for taps and toggles, `smooth` for things that travel. */
export const spring = {
  snappy: { damping: 18, stiffness: 320, mass: 0.6 } satisfies WithSpringConfig,
  smooth: { damping: 22, stiffness: 180, mass: 0.9 } satisfies WithSpringConfig,
  lead: { damping: 20, stiffness: 420, mass: 0.6 } satisfies WithSpringConfig,
  trail: { damping: 24, stiffness: 170, mass: 0.8 } satisfies WithSpringConfig,
};

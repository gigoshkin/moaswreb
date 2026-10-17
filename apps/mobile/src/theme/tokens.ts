// Design tokens. Source of truth for colour, type, shape, spacing and motion.
// Direction: knowledge-base/ideas/tbilisi-transit/06-design-direction.md.
// Fixed by George: Georgian first, light theme, premium feel, good motion,
// not vibecoded. Fonts, colours and shapes below are placeholders; andro
// decides the look and may replace any of them.

import type { WithSpringConfig } from 'react-native-reanimated';

const palette = {
  // Warm neutrals for light mode
  paper: '#F7F5F0',
  paperRaised: '#FFFFFF',
  paperSunken: '#EEEBE4',
  ink: '#1A1916',
  inkMuted: '#5E5B54',
  inkFaint: '#9A968C',
  hairlineLight: '#E2DED5',
  // Near-black with lifted surfaces for dark mode
  night: '#0B0B0C',
  nightRaised: '#17171A',
  nightRaised2: '#222226',
  snow: '#F4F3EF',
  snowMuted: '#A9A7A0',
  snowFaint: '#6D6B66',
  hairlineDark: '#2C2C31',
  // The one accent: a confident green for "go"; warning/late is amber.
  go: '#0F9D58',
  goDark: '#3DDC84',
  late: '#E37400',
  lateDark: '#FFB74D',
} as const;

export interface ColorTokens {
  bg: string;
  surface: string;
  surfaceRaised: string;
  sunken: string;
  text: string;
  textMuted: string;
  textFaint: string;
  hairline: string;
  accent: string;
  onAccent: string;
  late: string;
  /** Fill of the leave-by window when you're inside it. */
  windowFill: string;
  track: string;
}

export const colors: Record<'light' | 'dark', ColorTokens> = {
  light: {
    bg: palette.paper,
    surface: palette.paperRaised,
    surfaceRaised: palette.paperRaised,
    sunken: palette.paperSunken,
    text: palette.ink,
    textMuted: palette.inkMuted,
    textFaint: palette.inkFaint,
    hairline: palette.hairlineLight,
    accent: palette.go,
    onAccent: '#FFFFFF',
    late: palette.late,
    windowFill: 'rgba(15,157,88,0.16)',
    track: palette.paperSunken,
  },
  dark: {
    bg: palette.night,
    surface: palette.nightRaised,
    surfaceRaised: palette.nightRaised2,
    sunken: palette.nightRaised,
    text: palette.snow,
    textMuted: palette.snowMuted,
    textFaint: palette.snowFaint,
    hairline: palette.hairlineDark,
    accent: palette.goDark,
    onAccent: '#06210F',
    late: palette.lateDark,
    windowFill: 'rgba(61,220,132,0.20)',
    track: palette.nightRaised2,
  },
};

/** Tbilisi metro lines (fallback when TTC sends no colour). [?] check against TTC's own colours. */
export const metroColors: Record<string, string> = {
  M1: '#E53935',
  M2: '#43A047',
};

export const fonts = {
  // Latin + numerals. Static weights from @expo-google-fonts/google-sans-flex.
  latin: {
    regular: 'GoogleSansFlex_400Regular',
    medium: 'GoogleSansFlex_500Medium',
    semibold: 'GoogleSansFlex_600SemiBold',
    bold: 'GoogleSansFlex_700Bold',
    black: 'GoogleSansFlex_900Black',
  },
  // Google Sans Flex has no Georgian glyphs (checked 17 Oct). Noto Sans
  // Georgian's x-height (0.536 em) is close to Google Sans Flex's (0.51 em).
  georgian: {
    regular: 'NotoSansGeorgian_400Regular',
    medium: 'NotoSansGeorgian_500Medium',
    semibold: 'NotoSansGeorgian_600SemiBold',
    bold: 'NotoSansGeorgian_700Bold',
    black: 'NotoSansGeorgian_900Black',
  },
} as const;

export type Weight = keyof typeof fonts.latin;

/** Few sizes, big contrast between them. */
export const type = {
  hero: { size: 64, lineHeight: 68, weight: 'black', tracking: -1.5 },
  title: { size: 28, lineHeight: 34, weight: 'bold', tracking: -0.4 },
  body: { size: 17, lineHeight: 24, weight: 'regular', tracking: 0 },
  label: { size: 15, lineHeight: 20, weight: 'medium', tracking: 0 },
  caption: { size: 13, lineHeight: 18, weight: 'medium', tracking: 0.1 },
} as const satisfies Record<string, { size: number; lineHeight: number; weight: Weight; tracking: number }>;

export type TypeVariant = keyof typeof type;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

export const radius = {
  plate: 8,
  /** Card at rest: large and soft. */
  card: 28,
  /** Card in "about to leave" state: tighter, more solid. */
  cardUrgent: 16,
  pill: 999,
} as const;

/** Spring presets. Nothing animates linearly. */
export const springs = {
  /** Taps, toggles, press feedback. */
  snappy: { damping: 22, stiffness: 380, mass: 0.8 },
  /** Cards and sheets settling. */
  settle: { damping: 26, stiffness: 220, mass: 1 },
  /** Shape morphs (radius, window narrowing). */
  morph: { damping: 20, stiffness: 160, mass: 1 },
} as const satisfies Record<string, WithSpringConfig>;

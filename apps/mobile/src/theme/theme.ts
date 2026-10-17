import { useColorScheme } from 'react-native';
import { colors, fonts, type ColorTokens, type Weight } from './tokens';

export const useColors = (): ColorTokens => colors[useColorScheme() === 'dark' ? 'dark' : 'light'];

const GEORGIAN = /[Ⴀ-ჿᲐ-Ჿ]/;

/** Georgian strings use Noto Sans Georgian (it also covers Latin and digits); everything else Google Sans Flex. */
export const fontFor = (text: string, weight: Weight): string =>
  GEORGIAN.test(text) ? fonts.georgian[weight] : fonts.latin[weight];

/** WCAG relative luminance → pick black or white text on a line colour. */
export const onColor = (hex: string): '#000000' | '#FFFFFF' => {
  const v = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(v.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Contrast vs white = 1.05/(l+0.05), vs black = (l+0.05)/0.05.
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.05 ? '#FFFFFF' : '#000000';
};

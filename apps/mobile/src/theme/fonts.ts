// Per-weight imports so only the faces we use get bundled.
import { GoogleSansFlex_400Regular } from '@expo-google-fonts/google-sans-flex/400Regular';
import { GoogleSansFlex_500Medium } from '@expo-google-fonts/google-sans-flex/500Medium';
import { GoogleSansFlex_600SemiBold } from '@expo-google-fonts/google-sans-flex/600SemiBold';
import { GoogleSansFlex_700Bold } from '@expo-google-fonts/google-sans-flex/700Bold';
import { GoogleSansFlex_900Black } from '@expo-google-fonts/google-sans-flex/900Black';
import { NotoSansGeorgian_400Regular } from '@expo-google-fonts/noto-sans-georgian/400Regular';
import { NotoSansGeorgian_500Medium } from '@expo-google-fonts/noto-sans-georgian/500Medium';
import { NotoSansGeorgian_600SemiBold } from '@expo-google-fonts/noto-sans-georgian/600SemiBold';
import { NotoSansGeorgian_700Bold } from '@expo-google-fonts/noto-sans-georgian/700Bold';
import { NotoSansGeorgian_900Black } from '@expo-google-fonts/noto-sans-georgian/900Black';
import { useFonts } from 'expo-font';

/** Loads every face referenced in tokens.fonts. Returns true when ready. */
export const useAppFonts = (): boolean => {
  const [loaded, error] = useFonts({
    GoogleSansFlex_400Regular,
    GoogleSansFlex_500Medium,
    GoogleSansFlex_600SemiBold,
    GoogleSansFlex_700Bold,
    GoogleSansFlex_900Black,
    NotoSansGeorgian_400Regular,
    NotoSansGeorgian_500Medium,
    NotoSansGeorgian_600SemiBold,
    NotoSansGeorgian_700Bold,
    NotoSansGeorgian_900Black,
  });
  // On a font error, render with system fonts rather than a blank screen.
  return loaded || error !== null;
};

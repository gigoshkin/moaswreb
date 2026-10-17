import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { KitScreen } from './src/dev/KitScreen';
import { useAppFonts } from './src/theme/fonts';
import { useColors } from './src/theme/theme';

export default function App() {
  const ready = useAppFonts();
  const c = useColors();
  // Fonts are bundled, so this is one frame, not a spinner.
  if (!ready) return <View style={{ flex: 1, backgroundColor: c.bg }} />;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <KitScreen />
        <StatusBar style="auto" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

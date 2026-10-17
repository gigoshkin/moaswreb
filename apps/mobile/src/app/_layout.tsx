import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { setUpAlerts } from '../lib/alerts';
import { useAppFonts } from '../theme/fonts';
import { useColors } from '../theme/theme';

export default function RootLayout() {
  const ready = useAppFonts();
  const c = useColors();
  useEffect(() => {
    // Permission prompt + push token + trip sync. Failure must not block the app.
    setUpAlerts().catch(() => {});
  }, []);
  // Fonts are bundled, so this is one frame, not a spinner.
  if (!ready) return <View style={{ flex: 1, backgroundColor: c.bg }} />;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }} />
        <StatusBar style="dark" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

import { useFonts } from 'expo-font';
import { router, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { onAlertTap, setUpAlerts } from '../lib/alerts';
import { getTrip } from '../lib/trips';
import { DialogHost } from '../ui/Dialog';
import { color, fontFiles } from '../ui/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontFiles);
  const ready = fontsLoaded || fontError !== null;

  useEffect(() => {
    // Permission prompt + push token + trip sync. Failure must not block the app.
    setUpAlerts().catch(() => {});
  }, []);

  useEffect(() => {
    if (!ready) return;
    SplashScreen.hideAsync().catch(() => {});
    return onAlertTap((tripId) => {
      if (getTrip(tripId)) router.push({ pathname: '/trip/[id]', params: { id: tripId } });
    });
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: color.bg }}>
      <SafeAreaProvider>
        {/* gestureEnabled:false on the map screens: the iOS edge swipe-back fights map panning and would leave the place picker from map mode. They all have an on-screen back/close button. */}
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg }, animation: 'ios_from_right' }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="trip/[id]" />
          <Stack.Screen name="trip/edit" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="trip/route" options={{ gestureEnabled: false }} />
          <Stack.Screen name="trip/build" options={{ gestureEnabled: false }} />
          <Stack.Screen name="pick-place" options={{ animation: 'slide_from_bottom', gestureEnabled: false }} />
          <Stack.Screen name="buffer" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="privacy" />
        </Stack>
        <DialogHost />
        <StatusBar style="dark" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

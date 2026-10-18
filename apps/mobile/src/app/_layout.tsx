import { useFonts } from 'expo-font';
import { router, Stack, useGlobalSearchParams, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { onAlertTap, setUpAlerts } from '../lib/alerts';
import { alertsOffered, introSeen } from '../lib/onboarding';
import { settings } from '../lib/settings';
import { getTrip } from '../lib/trips';
import { DialogHost } from '../ui/Dialog';
import { color, fontFiles } from '../ui/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontFiles);
  const ready = fontsLoaded || fontError !== null;

  const seen = introSeen.use();
  const offered = alertsOffered.use();

  // Before the intro was seen, every route but the intro (and Privacy opened from it) is guarded, and the
  // router can land on Privacy instead. Send it to the intro.
  const segments = useSegments();
  const params = useGlobalSearchParams<{ from?: string }>();
  const top = segments[0] as string | undefined;
  useEffect(() => {
    if (seen || !ready) return;
    if (top === 'welcome' || (top === 'privacy' && params.from === 'welcome')) return;
    router.replace('/welcome');
  }, [seen, ready, top, params.from]);

  useEffect(() => {
    // Push token + trip sync. Not before the intro, and not before the user was offered
    // notifications (intro screen 3 or Settings), so the system prompt never fires cold.
    if (seen && offered && settings.get().alerts) setUpAlerts().catch(() => {});
  }, [seen, offered]);

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
          <Stack.Protected guard={!seen}>
            <Stack.Screen name="welcome" options={{ animation: 'fade', gestureEnabled: false }} />
          </Stack.Protected>
          <Stack.Protected guard={seen}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="trip/[id]" />
            <Stack.Screen name="trip/edit" options={{ animation: 'slide_from_bottom' }} />
            <Stack.Screen name="trip/route" options={{ gestureEnabled: false }} />
            <Stack.Screen name="trip/build" options={{ gestureEnabled: false }} />
            <Stack.Screen name="pick-place" options={{ animation: 'slide_from_bottom', gestureEnabled: false }} />
            <Stack.Screen name="buffer" options={{ animation: 'slide_from_bottom' }} />
          </Stack.Protected>
          <Stack.Screen name="privacy" />
        </Stack>
        <DialogHost />
        <StatusBar style="dark" />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

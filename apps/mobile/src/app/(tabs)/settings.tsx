import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { cancelBackups, sendTestNotification, setUpAlerts } from '../../lib/alerts';
import { deleteMyData, hasApi } from '../../lib/api';
import { isExpoGo } from '../../lib/kv';
import { exactAlarmsAllowed, leaveCardAvailable, openExactAlarmSettings, testLeaveCard } from '../../lib/leaveCard';
import { clearChat } from '../../lib/chat';
import { pickPlace } from '../../lib/handoff';
import { alertsOffered, replayIntro } from '../../lib/onboarding';
import { bufferText, settings, updateSettings } from '../../lib/settings';
import { todayLocal } from '../../lib/time';
import { clearTrips, listTrips, newTripId, saveTrip, syncNow, withStops, type SavedTrip } from '../../lib/trips';
import { ask, notify } from '../../ui/Dialog';
import { Icon } from '../../ui/Icon';
import { Tap, haptic } from '../../ui/Tap';
import { Button } from '../../ui/Button';
import { Sheet } from '../../ui/Sheet';
import { Text } from '../../ui/Text';
import { Group, GroupRow, ScreenTitle, Switch } from '../../ui/kit';
import { color, gutter } from '../../ui/theme';

// Figma "Settings / default", without the Language row: the app is
// English-only (George, 17 Oct).

const build = Constants.expoConfig?.extra?.build as { branch?: string; commit?: string; dirty?: boolean } | undefined;
const versionText = [Constants.expoConfig?.version, build?.commit ? `${build.branch ? `${build.branch} ` : ''}${build.commit}${build.dirty ? '+' : ''}` : ''].filter(Boolean).join(' · ');

/** Arrive-by for the seeded trip: about two hours from now (Tbilisi time, 15-minute steps), else 09:00 when that is past midnight. */
const seedArriveBy = (): string => {
  const slot = 15 * 60_000;
  const local = new Date(Math.ceil((Date.now() + 2 * 3600_000) / slot) * slot + 4 * 3600_000);
  return local.toISOString().slice(0, 10) === todayLocal() ? local.toISOString().slice(11, 16) : '09:00';
};

const apiHost = (() => {
  try {
    return new URL(process.env.EXPO_PUBLIC_API_URL ?? '').host || 'not set';
  } catch {
    return 'not set';
  }
})();

export default function Settings() {
  const s = settings.use();

  // Hidden developer menu: tap the bus icon in the corner (or the Version row) 7 times.
  const [dev, setDev] = useState(false);
  const taps = useRef({ n: 0, at: 0 });
  const tapSecret = () => {
    const now = Date.now();
    taps.current = { n: now - taps.current.at > 2000 ? 1 : taps.current.n + 1, at: now };
    if (taps.current.n >= 7) {
      taps.current.n = 0;
      haptic('success');
      setDev(true);
    }
  };

  const setHome = async () => {
    const place = await pickPlace('home');
    if (place) updateSettings({ home: place });
  };

  const setAlerts = (on: boolean) => {
    updateSettings({ alerts: on });
    syncNow();
    if (on) {
      alertsOffered.set(true); // so later launches keep the token and trips in sync
      setUpAlerts().catch(() => {});
    }
    else cancelBackups();
  };

  const deleteAll = async () => {
    const ok = await ask({
      title: 'Delete my data?',
      message: 'Removes your trips, home and chat from this phone, and your trips and push token from our server.',
      confirm: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    // Server first: if it can't be reached nothing is cleared, so Delete can be tried again.
    if (hasApi) {
      try {
        await deleteMyData();
      } catch {
        haptic('error');
        notify("Couldn't delete your data", 'The server could not be reached, so nothing was removed. Check your connection and try again.');
        return;
      }
    }
    clearTrips();
    clearChat();
    updateSettings({ home: null, bufferMin: 0 });
    haptic('success');
    notify('Your data was deleted', 'Your trips, home and chat are gone from this phone' + (hasApi ? ', and your trips and push token from our server.' : '.'));
  };

  // Dev builds only: a leave card in 1 min, to check it on a phone.
  const testCard = async () => {
    const msg = await testLeaveCard().catch((e: Error) => `Failed: ${e.message}`);
    if ((await exactAlarmsAllowed()) === false) {
      const open = await ask({ title: 'Test leave card', message: `${msg}\n\nOpen "Alarms & reminders" now?`, confirm: 'Open' });
      if (open) openExactAlarmSettings();
    } else notify('Test leave card', msg);
  };

  // A ready-made trip (every day) so Today has something to count down to.
  const seedRoute = async () => {
    const base: SavedTrip = { id: newTripId(), name: 'Example: Didi Dighomi to Rustaveli', from: { label: 'Didi Dighomi III microdistrict', lat: 41.7910541, lon: 44.7380951 }, to: { label: 'Rustaveli Ave, Freedom Square', lat: 41.6934, lon: 44.8015 }, arriveBy: seedArriveBy(), days: [1, 2, 3, 4, 5, 6, 7] };
    // Stop lookup can be slow: save without it after 3 s.
    saveTrip(await Promise.race([withStops(base), new Promise<SavedTrip>((r) => setTimeout(() => r(base), 3000))]));
    haptic('success');
    setDev(false);
    router.navigate('/');
  };

  return (
    <View style={styles.screen}>
      <ScreenTitle
        title="Settings"
        right={
          <Tap onPress={tapSecret} haptic="none" scaleTo={1} hitSlop={12} accessibilityLabel="Settings">
            <Icon name="bus-deco" size={24} color={color.textTertiary} />
          </Tap>
        }
      />
      <ScrollView contentContainerStyle={styles.content}>
        <Group>
          <GroupRow label="Home" value={s.home?.label ?? 'Set'} onPress={setHome} />
          <GroupRow label="Buffer time" value={bufferText(s.bufferMin)} onPress={() => router.push('/buffer')} last />
        </Group>
        <Group>
          <GroupRow label="Notifications" right={<Switch value={s.alerts} onChange={setAlerts} label="Notifications" />} last />
        </Group>
        <Group>
          <GroupRow label="Privacy" onPress={() => router.push('/privacy')} />
          <GroupRow label="Replay intro" onPress={() => { replayIntro(); setTimeout(() => router.replace('/welcome'), 0); }} last />
        </Group>
        {__DEV__ && (
          <Group>
            <GroupRow label="Test leave card (dev)" value="in 1 min" onPress={testCard} last />
          </Group>
        )}
        <Group>
          <GroupRow label="Version" value={versionText} onPress={tapSecret} right={<View />} last />
        </Group>
        <Group>
          <GroupRow label="Delete my data" icon="alert" onPress={deleteAll} right={<View />} last />
        </Group>
      </ScrollView>
      <Sheet visible={dev} onClose={() => setDev(false)}>
        <Text variant="title26">Developer</Text>
        <View style={styles.devInfo}>
          {[
            ['Build', versionText],
            ['Server', `${apiHost}${hasApi ? '' : ' (no server)'}`],
            ['API key', process.env.EXPO_PUBLIC_API_KEY ? 'set' : 'missing'],
            ['Runs in', isExpoGo ? 'Expo Go' : 'standalone build'],
            ['Leave card', leaveCardAvailable ? 'available' : 'not here (Android build only)'],
            ['Trips on this phone', String(listTrips().length)],
          ].map(([k, v]) => (
            <View key={k} style={styles.devRow}>
              <Text variant="body14" color={color.textSecondary}>
                {k}
              </Text>
              <Text variant="body14" style={styles.devValue} numberOfLines={1}>
                {v}
              </Text>
            </View>
          ))}
        </View>
        <View style={styles.devActions}>
          <Button label="Send test notification" kind="secondary" onPress={async () => notify('Test notification', await sendTestNotification().catch((e: Error) => `Failed: ${e.message}`))} />
          <Button label="Seed test route" kind="secondary" onPress={seedRoute} />
          <Button label="Test leave card in 1 min" kind="secondary" onPress={testCard} />
          <Button label="Replay intro and tips" kind="secondary" onPress={() => { setDev(false); replayIntro(); setTimeout(() => router.replace('/welcome'), 0); }} />
          <Button label="Clear saved trips" kind="secondary" onPress={async () => { if (await ask({ title: 'Clear all trips on this phone?', confirm: 'Clear', destructive: true })) { clearTrips(); syncNow(); } }} />
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { paddingHorizontal: gutter, gap: 12, paddingBottom: 24 },
  devInfo: { gap: 8, paddingVertical: 12 },
  devRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16 },
  devValue: { flexShrink: 1, textAlign: 'right' },
  devActions: { gap: 8, paddingBottom: 4 },
});

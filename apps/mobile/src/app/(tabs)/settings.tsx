import Constants from 'expo-constants';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { cancelBackups, setUpAlerts } from '../../lib/alerts';
import { deleteMyData, hasApi } from '../../lib/api';
import { exactAlarmsAllowed, openExactAlarmSettings, testLeaveCard } from '../../lib/leaveCard';
import { clearChat } from '../../lib/chat';
import { pickPlace } from '../../lib/handoff';
import { alertsOffered, replayIntro } from '../../lib/onboarding';
import { bufferText, settings, updateSettings } from '../../lib/settings';
import { clearTrips, syncNow } from '../../lib/trips';
import { ask, notify } from '../../ui/Dialog';
import { Icon } from '../../ui/Icon';
import { haptic } from '../../ui/Tap';
import { Group, GroupRow, ScreenTitle, Switch } from '../../ui/kit';
import { color, gutter } from '../../ui/theme';

// Figma "Settings / default", without the Language row: the app is
// English-only (George, 17 Oct).

const build = Constants.expoConfig?.extra?.build as { branch?: string; commit?: string; dirty?: boolean } | undefined;
const versionText = [Constants.expoConfig?.version, build?.commit ? `${build.branch ? `${build.branch} ` : ''}${build.commit}${build.dirty ? '+' : ''}` : ''].filter(Boolean).join(' · ');

export default function Settings() {
  const s = settings.use();

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

  return (
    <View style={styles.screen}>
      <ScreenTitle title="Settings" right={<Icon name="bus-deco" size={24} color={color.textTertiary} />} />
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
          <GroupRow label="Version" value={versionText} right={<View />} last />
        </Group>
        <Group>
          <GroupRow label="Delete my data" icon="alert" onPress={deleteAll} right={<View />} last />
        </Group>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { paddingHorizontal: gutter, gap: 12, paddingBottom: 24 },
});

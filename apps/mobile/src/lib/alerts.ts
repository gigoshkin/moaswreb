import Constants from 'expo-constants';
import * as Device from 'expo-device';
import type * as NotificationsModule from 'expo-notifications';
import { Platform } from 'react-native';
import { hasApi, registerPushToken, syncTrips } from './api';
import { t } from './strings';
import { isExpoGo } from './kv';
import { hhmm } from './time';
import { listTrips, toStored } from './trips';

// Server pushes and local backups use this channel; high importance so they show on the lock screen.
const CHANNEL = 'alerts';

// Not loaded in Expo Go: expo-notifications 58.1 needs a native module Expo Go 58.0.4 lacks. Alerts need a dev build there anyway.
const Notifications: typeof NotificationsModule | null = isExpoGo ? null : require('expo-notifications');

Notifications?.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

/**
 * Ask for notification permission, create the channel and send the push token
 * and trips to the server. Safe to call on every app start.
 */
export async function setUpAlerts(): Promise<'ok' | 'denied' | 'no-server' | 'simulator' | 'expo-go'> {
  if (!Notifications) return 'expo-go';
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: 'გასვლის შეხსენებები',
      importance: Notifications.AndroidImportance.MAX,
    });
  }
  const { granted } = await Notifications.requestPermissionsAsync();
  if (!granted) return 'denied';
  if (!hasApi) return 'no-server';
  await syncTrips(toStored(listTrips()));
  if (!Device.isDevice) return 'simulator';
  // projectId comes from the EAS project (app.json → extra.eas.projectId), set up by George.
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  await registerPushToken(data);
  return 'ok';
}

/**
 * Backup alert on the phone itself, from the last known plan: fires at the
 * leave time even if the server or the push service is down. It knows only
 * the timetable, not live delays. One per trip; rescheduling replaces it.
 */
export async function scheduleBackup(tripId: string, tripName: string, leaveAt: number): Promise<void> {
  if (!Notifications) return;
  const id = `backup-${tripId}`;
  await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
  if (leaveAt <= Date.now()) return;
  await Notifications.scheduleNotificationAsync({
    identifier: id,
    content: { title: t.leaveNow, body: `${tripName} · ${hhmm(leaveAt)}`, data: { tripId } },
    // alarmClock = exact time even in battery saving. [?] may need the exact-alarm permission on Android 12+.
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: leaveAt, channelId: CHANNEL, delivery: 'alarmClock' },
  });
}

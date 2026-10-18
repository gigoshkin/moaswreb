import Constants from 'expo-constants';
import * as Device from 'expo-device';
import type * as NotificationsModule from 'expo-notifications';
import { Platform } from 'react-native';
import { hasApi, registerPushToken, syncTrips } from './api';
import { t } from './strings';
import { isExpoGo } from './kv';
import { cancelLeaveCard, startLeaveCard } from './leaveCard';
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
      name: t.alertsChannel,
      importance: Notifications.AndroidImportance.MAX,
    });
  }
  const { granted } = await Notifications.requestPermissionsAsync();
  if (!granted) return 'denied';
  // The Android countdown card (dev build only; does nothing elsewhere).
  startLeaveCard().catch(() => {});
  if (!hasApi) return 'no-server';
  // A failed sync must not block the token: the next trip change or app start syncs again.
  await syncTrips(toStored(listTrips())).catch(() => {});
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

/** Opens the trip when the user taps an alert (server push or local backup). Returns an unsubscribe. */
export function onAlertTap(open: (tripId: string) => void): () => void {
  if (!Notifications) return () => {};
  const handle = (r: NotificationsModule.NotificationResponse | null) => {
    const tripId = r?.notification.request.content.data?.tripId;
    if (typeof tripId === 'string') open(tripId);
  };
  // A tap that launched the app. Throws where the native module lacks it (web previews).
  try {
    handle(Notifications.getLastNotificationResponse());
  } catch {}
  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  return () => sub.remove();
}

/** Alerts switched off in Settings: no local backups either (the server gets no trips, see toStored). */
export async function cancelBackups(): Promise<void> {
  await Notifications?.cancelAllScheduledNotificationsAsync().catch(() => {});
  await cancelLeaveCard().catch(() => {});
}

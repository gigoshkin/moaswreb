import type { AlertPushData } from '@transit/shared';

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: AlertPushData;
}

export type SendPush = (messages: PushMessage[]) => Promise<void>;

/** Expo push service (expo-notifications on the phone). Token optional: EXPO_ACCESS_TOKEN. */
export const expoPush =
  (accessToken = process.env.EXPO_ACCESS_TOKEN): SendPush =>
  async (messages) => {
    if (!messages.length) return;
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(messages.map((m) => ({ ...m, priority: 'high', sound: 'default', channelId: 'alerts' }))),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Expo push ${res.status}: ${(await res.text()).slice(0, 200)}`);
  };

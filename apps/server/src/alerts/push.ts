import type { AlertPushData } from '@transit/shared';

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: AlertPushData;
}

/** Sends messages; resolves with one flag per message: true if Expo accepted it. */
export type SendPush = (messages: PushMessage[]) => Promise<boolean[]>;

const EXPO_BATCH = 100; // Expo's limit per request

interface ExpoTicket {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

/**
 * Expo push service (expo-notifications on the phone). Token optional:
 * EXPO_ACCESS_TOKEN. A failed batch or ticket comes back false so the
 * watcher retries it; errors are logged with the token cut short.
 */
export const expoPush =
  (accessToken = process.env.EXPO_ACCESS_TOKEN, log: (msg: string) => void = console.warn): SendPush =>
  async (messages) => {
    const ok: boolean[] = [];
    for (let i = 0; i < messages.length; i += EXPO_BATCH) {
      const batch = messages.slice(i, i + EXPO_BATCH);
      try {
        const tickets = await sendBatch(batch, accessToken);
        batch.forEach((m, j) => {
          const t = tickets[j];
          ok.push(t?.status === 'ok');
          if (t?.status !== 'ok') log(`Expo push rejected for ${m.to.slice(0, 22)}…: ${t?.details?.error ?? t?.message ?? 'no ticket'}`);
        });
      } catch (err) {
        log(`Expo push batch failed: ${(err as Error).message}`);
        ok.push(...batch.map(() => false));
      }
    }
    return ok;
  };

async function sendBatch(messages: PushMessage[], accessToken: string | undefined): Promise<ExpoTicket[]> {
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
  return ((await res.json()) as { data?: ExpoTicket[] }).data ?? [];
}

import type { ActionCard, ChatAttachment, ChatMessage } from '@transit/shared';
import { hasApi, sendChat } from './api';
import { locateMe, quietHere } from './locate';
import { memory, persisted } from './store';
import { settings } from './settings';
import { listTrips } from './trips';

/** One line in the chat. Attachments keep only a preview; their bytes are sent once and dropped. */
export interface ChatItem {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  image?: string;
  file?: string;
  cards?: ActionCard[];
  /** Card index → what the user did with it ("Saved"). */
  done?: Record<number, string>;
  error?: boolean;
}

export interface Attachment extends ChatAttachment {
  /** Local uri for the thumbnail. */
  uri?: string;
  name?: string;
}

export const chatStore = persisted<ChatItem[]>('chat:v1', []);
export const chatBusy = memory(false);

export const clearChat = () => chatStore.set([]);

const id = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const ctxPlace = (p: { label: string; lat: number; lon: number }) => ({ label: p.label.slice(0, 200), lat: p.lat, lon: p.lon });

/** Earlier turns sent as context, text only. */
const HISTORY = 12;

export function markCard(itemId: string, card: number, state: string) {
  chatStore.set(chatStore.get().map((m) => (m.id === itemId ? { ...m, done: { ...m.done, [card]: state } } : m)));
}

export function replaceCard(itemId: string, card: number, next: ActionCard) {
  chatStore.set(chatStore.get().map((m) => (m.id === itemId && m.cards ? { ...m, cards: m.cards.map((c, i) => (i === card ? next : c)) } : m)));
}

export function say(text: string) {
  chatStore.set([...chatStore.get(), { id: id(), role: 'assistant', text }]);
}

/** Questions that are about where the user is. */
const WANTS_LOCATION = /\b(near(by)?|nearest|closest|around me|here|my location|current location|where i am|from me)\b/i;

export async function send(text: string, attachment?: Attachment): Promise<void> {
  if (chatBusy.get()) return;
  const user: ChatItem = { id: id(), role: 'user', text, image: attachment?.kind === 'image' ? attachment.uri : undefined, file: attachment?.kind === 'pdf' ? (attachment.name ?? 'PDF') : undefined };
  const before = chatStore.get();
  chatStore.set([...before, user]);
  if (!hasApi) {
    say('Chat needs the server. Set EXPO_PUBLIC_API_URL.');
    return;
  }
  chatBusy.set(true);
  const history: ChatMessage[] = before
    .filter((m) => m.text && !m.error)
    .slice(-HISTORY)
    .map((m) => ({ role: m.role, text: m.text }));
  const last: ChatMessage = {
    role: 'user',
    text: text || (attachment?.kind === 'pdf' ? 'This is my schedule.' : 'This is my timetable.'),
    attachments: attachment ? [{ kind: attachment.kind, mediaType: attachment.mediaType, data: attachment.data }] : undefined,
  };
  try {
    const { home, bufferMin } = settings.get();
    // "Near me" and "from here" need the phone's position. The first time, the question itself asks for permission; afterwards it is sent without asking.
    const asked = WANTS_LOCATION.test(text);
    const here = asked ? await locateMe() : await quietHere();
    const res = await sendChat({
      messages: [...history, last],
      // Inside the server's limits (name ≤ 100, label ≤ 200, 50 trips): a long event title saved from a PDF must not break every later chat.
      trips: listTrips().slice(0, 50).map((t) => ({ name: t.name.slice(0, 100), from: ctxPlace(t.from), to: ctxPlace(t.to), arriveBy: t.arriveBy })),
      ...(typeof here === 'object' && here ? { here: { lat: here.lat, lon: here.lon } } : {}),
      ...(home ? { home: { label: home.label.slice(0, 200), lat: home.lat, lon: home.lon } } : {}),
      ...(bufferMin > 0 ? { bufferMin: Math.min(60, Math.round(bufferMin)) } : {}),
      locale: 'en',
    });
    chatStore.set([...chatStore.get(), { id: id(), role: 'assistant', text: res.reply, cards: res.cards }]);
  } catch (e) {
    const code = (e as { code?: string }).code;
    const msg = code === 'quota' ? "You've used today's assistant messages. Try again tomorrow." : code === 'rate_limited' ? 'Too many messages at once. Try again in a minute.' : code === 'timeout' ? 'That took too long. Try again.' : "Couldn't reach the server. Try again.";
    chatStore.set([...chatStore.get(), { id: id(), role: 'assistant', text: msg, error: true }]);
  } finally {
    chatBusy.set(false);
  }
}

import type { ActionCard, ChatAttachment, ChatMessage } from '@transit/shared';
import { hasApi, sendChat } from './api';
import { memory, persisted } from './store';
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
    const res = await sendChat({
      messages: [...history, last],
      trips: listTrips().map((t) => ({ name: t.name, from: t.from, to: t.to, arriveBy: t.arriveBy })),
      locale: 'en',
    });
    chatStore.set([...chatStore.get(), { id: id(), role: 'assistant', text: res.reply, cards: res.cards }]);
  } catch (e) {
    const code = (e as { code?: string }).code;
    const msg = code === 'rate_limited' ? 'Too many messages at once. Try again in a minute.' : code === 'timeout' ? 'That took too long. Try again.' : "Couldn't reach the server. Try again.";
    chatStore.set([...chatStore.get(), { id: id(), role: 'assistant', text: msg, error: true }]);
  } finally {
    chatBusy.set(false);
  }
}

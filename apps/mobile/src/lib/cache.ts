import { createMMKV } from 'react-native-mmkv';

// Instant start: the last good state is shown from here at launch, then refreshed.
const store = createMMKV({ id: 'cache' });

export const readCache = <T>(key: string): T | null => {
  const raw = store.getString(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export const writeCache = (key: string, value: unknown): void => store.set(key, JSON.stringify(value));

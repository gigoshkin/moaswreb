import { createKV } from './kv';

// Instant start: the last good state is shown from here at launch, then refreshed.
const store = createKV('cache');

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

/**
 * Like writeCache, for values keyed by something open-ended (plan queries
 * include the date): only the `max` most recently written keys of `group`
 * are kept, older ones are deleted.
 */
export const writeRecent = (group: string, key: string, value: unknown, max = 30): void => {
  const indexKey = `recent:${group}`;
  const keys = [key, ...(readCache<string[]>(indexKey) ?? []).filter((k) => k !== key)];
  for (const old of keys.splice(max)) store.remove(old);
  writeCache(indexKey, keys);
  writeCache(key, value);
};

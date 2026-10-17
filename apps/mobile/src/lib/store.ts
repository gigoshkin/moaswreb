import { useSyncExternalStore } from 'react';
import { readCache, writeCache } from './cache';

export interface Store<T> {
  get(): T;
  set(value: T): void;
  use(): T;
}

/** A value kept on the phone (kv cache) that screens can subscribe to. */
export function persisted<T>(key: string, initial: T): Store<T> {
  let value: T = readCache<T>(key) ?? initial;
  const listeners = new Set<() => void>();
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };
  const get = () => value;
  return {
    get,
    set(next) {
      value = next;
      writeCache(key, next);
      listeners.forEach((l) => l());
    },
    use: () => useSyncExternalStore(subscribe, get),
  };
}

/** Same, in memory only (state handed between screens). */
export function memory<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };
  const get = () => value;
  return {
    get,
    set(next) {
      value = next;
      listeners.forEach((l) => l());
    },
    use: () => useSyncExternalStore(subscribe, get),
  };
}

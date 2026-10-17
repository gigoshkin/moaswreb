import Constants, { ExecutionEnvironment } from 'expo-constants';

/** Synchronous string store. MMKV in real builds; expo-sqlite's kv-store in Expo Go, which has no MMKV. */
export interface KV {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
}

export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export function createKV(id: string): KV {
  if (isExpoGo) {
    // Required lazily so neither module is loaded where it isn't used.
    const { SQLiteStorage } = require('expo-sqlite/kv-store') as typeof import('expo-sqlite/kv-store');
    const store = new SQLiteStorage(`kv-${id}`);
    return {
      getString: (key) => store.getItemSync(key) ?? undefined,
      set: (key, value) => store.setItemSync(key, value),
    };
  }
  const { createMMKV } = require('react-native-mmkv') as typeof import('react-native-mmkv');
  const store = createMMKV({ id });
  return {
    getString: (key) => store.getString(key),
    set: (key, value) => store.set(key, value),
  };
}

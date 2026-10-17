import { getRandomBytes } from 'expo-crypto';
import { createMMKV } from 'react-native-mmkv';

const store = createMMKV({ id: 'device' });

/**
 * The app's only identity: 144 random bits created once and kept on the
 * phone. No account, name or phone number. The server stores only a hash.
 */
export const deviceId = (): string => {
  let id = store.getString('id');
  if (!id) {
    id = Array.from(getRandomBytes(18), (b) => b.toString(16).padStart(2, '0')).join('');
    store.set('id', id);
  }
  return id;
};

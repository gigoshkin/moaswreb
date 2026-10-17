import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { memory } from '../lib/store';
import { Button } from './Button';
import { Sheet } from './Sheet';
import { Text } from './Text';
import { color } from './theme';

interface Options {
  title: string;
  message?: string;
  /** Label of the main button. */
  confirm: string;
  /** Red main button, for things that can't be undone. */
  destructive?: boolean;
  /** Label of the second button; false shows only the main one. */
  cancel?: string | false;
}

interface Open extends Options {
  resolve: (ok: boolean) => void;
}

const current = memory<Open | null>(null);

/** Styled replacement for Alert.alert with two buttons. Resolves true on confirm, false on cancel or dismiss. */
export function ask(options: Options): Promise<boolean> {
  current.get()?.resolve(false);
  return new Promise((resolve) => current.set({ cancel: 'Cancel', ...options, resolve }));
}

/** Styled replacement for Alert.alert with one button. */
export const notify = (title: string, message?: string) => ask({ title, message, confirm: 'OK', cancel: false }).then(() => {});

const close = (ok: boolean) => {
  const open = current.get();
  if (!open) return;
  current.set(null);
  open.resolve(ok);
};

/** Mounted once in the root layout. */
export function DialogHost() {
  const open = current.use();
  const shown = useLast(open);
  return (
    <Sheet visible={open !== null} onClose={() => close(false)}>
      {shown && (
        <View style={styles.body}>
          <Text variant="title20" style={styles.title}>
            {shown.title}
          </Text>
          {shown.message ? (
            <Text variant="body15" color={color.textSecondary} style={styles.message}>
              {shown.message}
            </Text>
          ) : null}
          <Button
            label={shown.confirm}
            onPress={() => close(true)}
            haptic={shown.destructive ? 'none' : 'light'}
            style={shown.destructive ? styles.danger : undefined}
          />
          {shown.cancel !== false && <Button label={shown.cancel ?? 'Cancel'} kind="secondary" onPress={() => close(false)} />}
        </View>
      )}
    </Sheet>
  );
}

/** The last non-null value, so content stays up while a sheet slides away. */
function useLast<T>(value: T | null): T | null {
  const ref = useRef<T | null>(value);
  if (value) ref.current = value;
  return ref.current;
}

const styles = StyleSheet.create({
  body: { gap: 10 },
  title: { textAlign: 'center' },
  message: { textAlign: 'center', marginBottom: 8 },
  danger: { backgroundColor: color.metro },
});

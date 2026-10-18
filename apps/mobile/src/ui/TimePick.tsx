import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Platform } from 'react-native';

/** Shared arrive-by time picker: a dialog on Android, an inline spinner on iOS (render <TimeSpinner> while open). */
export const hhmmLocal = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

const toDate = (hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
};

/** Android: opens the dialog and returns true. iOS: returns false, so the caller toggles its inline <TimeSpinner>. */
export function openTimeDialog(value: string, onSet: (hm: string) => void): boolean {
  if (Platform.OS !== 'android') return false;
  DateTimePickerAndroid.open({
    value: toDate(value),
    mode: 'time',
    is24Hour: true,
    onChange: (e: DateTimePickerEvent, d?: Date) => e.type === 'set' && d && onSet(hhmmLocal(d)),
  });
  return true;
}

export function TimeSpinner({ value, onChange }: { value: string; onChange: (hm: string) => void }) {
  return <DateTimePicker value={toDate(value)} mode="time" display="spinner" themeVariant="light" is24Hour onChange={(_e: DateTimePickerEvent, d?: Date) => d && onChange(hhmmLocal(d))} />;
}

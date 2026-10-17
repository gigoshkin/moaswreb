import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { pickPlace, takeDraft, type PickKind } from '../../lib/handoff';
import { firstWalkMin, isMetro, leaveAt, placeName, transitLegs } from '../../lib/plans';
import { settings } from '../../lib/settings';
import { DAY_SHORT, hhmm, nextArriveBy } from '../../lib/time';
import { DEFAULT_DAYS, getTrip, newTripId, removeTrip, saveTrip, withStops, type Place, type SavedTrip } from '../../lib/trips';
import { useNow } from '../../lib/useNow';
import { useTripPlan } from '../../lib/useTripPlan';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { RoutePlate } from '../../ui/RoutePlate';
import { Tap, haptic } from '../../ui/Tap';
import { Text } from '../../ui/Text';
import { Card, Chip, TopBar } from '../../ui/kit';
import { color, font, gutter, radius, shadow } from '../../ui/theme';

/** Figma "Add trip / default"; also edits a saved trip (`?id=`). */
export default function EditTrip() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const insets = useSafeAreaInsets();
  const now = useNow(30_000);
  const existing = id ? getTrip(id) : undefined;
  // Read once: a draft from chat, or the trip being edited, or Home → ?.
  const [init] = useState(() => {
    const draft = takeDraft();
    const home = settings.get().home;
    return {
      name: existing?.name ?? draft?.name,
      from: existing?.from ?? draft?.from ?? (home ? { ...home, label: 'Home' } : null),
      to: existing?.to ?? draft?.to ?? null,
      arriveBy: existing?.arriveBy ?? draft?.arriveBy ?? '09:00',
      days: existing?.days ?? draft?.days ?? DEFAULT_DAYS,
    };
  });
  const [from, setFrom] = useState<Place | null>(init.from);
  const [to, setTo] = useState<Place | null>(init.to);
  const [arriveBy, setArriveBy] = useState(init.arriveBy);
  const [days, setDays] = useState<number[]>(init.days);
  const [iosPicker, setIosPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  // Preview of the next occurrence, also the source of the stop ids on save.
  const draftTrip: SavedTrip | null = useMemo(
    () => (from && to ? { id: existing?.id ?? 'draft', name: '', from, to, arriveBy, days } : null),
    [from, to, arriveBy, days.join()],
  );
  const date = nextArriveBy(arriveBy, days, now).slice(0, 10);
  const { choice } = useTripPlan(draftTrip, date, now);
  const it = choice.kind === 'none' ? null : choice.it;
  const legs = it ? transitLegs(it) : [];

  const pick = async (kind: PickKind) => {
    const p = await pickPlace(kind);
    if (p) (kind === 'from' ? setFrom : setTo)(p);
  };

  const changeTime = () => {
    const [h, m] = arriveBy.split(':').map(Number);
    const value = new Date();
    value.setHours(h, m, 0, 0);
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value,
        mode: 'time',
        is24Hour: true,
        onChange: (e: DateTimePickerEvent, d?: Date) => e.type === 'set' && d && setArriveBy(hhmmLocal(d)),
      });
    } else setIosPicker((v) => !v);
  };

  const toggleDay = (d: number) => setDays((cur) => (cur.includes(d) ? (cur.length > 1 ? cur.filter((x) => x !== d) : cur) : [...cur, d].sort()));

  const save = async () => {
    if (!from || !to || saving) return;
    setSaving(true);
    const base: SavedTrip = { id: existing?.id ?? newTripId(), name: init.name ?? (to.label === 'Home' ? 'Home' : to.label), from, to, arriveBy, days };
    const first = legs[0];
    const trip =
      it && first
        ? { ...base, fromStopId: first.from.stopId ?? undefined, toStopId: legs.at(-1)!.to.stopId ?? undefined, walkMin: firstWalkMin(it) }
        : await withStops(base);
    saveTrip(trip);
    haptic('success');
    router.back();
  };

  const remove = () =>
    Alert.alert('Delete this trip?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          removeTrip(existing!.id);
          router.dismissAll();
        },
      },
    ]);

  const bufferMin = settings.use().bufferMin;

  return (
    <View style={styles.screen}>
      <TopBar
        title={existing ? 'Edit trip' : 'New trip'}
        close
        right={
          existing ? (
            <Tap onPress={remove} scaleTo={0.94} hitSlop={8} accessibilityRole="button">
              <Text variant="label14" color={color.textSecondary}>
                Delete
              </Text>
            </Tap>
          ) : undefined
        }
      />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 20 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.routeCard}>
          <Field
            label="From"
            value={from?.label}
            sub={from && it && legs[0] ? `${placeName(legs[0].from.name, 'First stop')} · ${firstWalkMin(it)} min walk` : undefined}
            onPress={() => pick('from')}
            divider
          />
          <Field label="To" value={to?.label} sub={to && legs.length ? placeName(legs.at(-1)!.to.name, '') : undefined} onPress={() => pick('to')} />
        </View>

        <Card style={styles.arriveCard}>
          <View style={styles.arriveRow}>
            <View>
              <Text variant="caption" color={color.textSecondary}>
                Arrive by
              </Text>
              <Text variant="time56">{arriveBy}</Text>
            </View>
            <Tap onPress={changeTime} style={styles.changePill} scaleTo={0.94} accessibilityRole="button" accessibilityLabel="Change arrive-by time">
              <Text variant="label13" color={color.textSecondary}>
                {iosPicker ? 'Done' : 'Change'}
              </Text>
            </Tap>
          </View>
          {iosPicker && (
            <DateTimePicker
              value={(() => {
                const d = new Date();
                const [h, m] = arriveBy.split(':').map(Number);
                d.setHours(h, m, 0, 0);
                return d;
              })()}
              mode="time"
              display="spinner"
              is24Hour
              onChange={(_e: DateTimePickerEvent, d?: Date) => d && setArriveBy(hhmmLocal(d))}
            />
          )}
        </Card>

        <Card style={styles.daysCard}>
          <Text variant="caption" color={color.textSecondary}>
            Days
          </Text>
          <View style={styles.days}>
            {DAY_SHORT.map((label, i) => (
              <Chip key={label} label={label} on={days.includes(i + 1)} onPress={() => toggleDay(i + 1)} />
            ))}
          </View>
        </Card>

        <View style={styles.spacer} />

        <View style={styles.bottom}>
          {it && (
            <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(120)} style={styles.preview}>
              <Icon name={legs[0] && isMetro(legs[0]) ? 'metro' : 'bus'} size={16} color={color.textTertiary} />
              <Text variant="body13" color={color.textSecondary}>
                Leave around {hhmm(leaveAt(it, bufferMin))}
              </Text>
              {legs.slice(0, 3).map((l, i) => (
                <RoutePlate key={i} label={l.route?.shortName ?? l.mode} metro={isMetro(l)} />
              ))}
            </Animated.View>
          )}
          <Button label={saving ? 'Saving…' : 'Save'} onPress={save} disabled={!from || !to || saving} haptic="none" />
        </View>
      </ScrollView>
    </View>
  );
}

const hhmmLocal = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

function Field({ label, value, sub, onPress, divider }: { label: string; value?: string; sub?: string; onPress: () => void; divider?: boolean }) {
  return (
    <Tap onPress={onPress} feedback="tint" style={[styles.field, divider && styles.fieldDivider]} accessibilityRole="button" accessibilityLabel={`${label}: ${value ?? 'not set'}`}>
      <View style={styles.fieldText}>
        <Text variant="caption" color={color.textSecondary}>
          {label}
        </Text>
        <Text variant="label16" color={value ? color.text : color.textSecondary} numberOfLines={1} style={styles.fieldValue}>
          {value ?? 'Choose a place'}
        </Text>
        {sub ? (
          <Text variant="caption" color={color.textSecondary} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      <Icon name="chevron-right" size={20} color={color.textTertiary} />
    </Tap>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { flexGrow: 1, paddingHorizontal: gutter, paddingTop: 8, gap: 12 },
  routeCard: { backgroundColor: color.sky, borderRadius: radius.lg, overflow: 'hidden', ...shadow.soft },
  field: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 20 },
  fieldDivider: { borderBottomWidth: StyleSheet.hairlineWidth * 2, borderBottomColor: 'rgba(28,26,26,0.08)' },
  fieldText: { flex: 1, gap: 2 },
  fieldValue: { fontFamily: font.bold },
  arriveCard: { gap: 4 },
  arriveRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  changePill: { backgroundColor: color.surfaceMuted, borderRadius: radius.full, paddingHorizontal: 16, paddingVertical: 8 },
  daysCard: { gap: 12 },
  days: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  spacer: { flex: 1, minHeight: 12 },
  bottom: { gap: 8 },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4, paddingVertical: 12 },
});

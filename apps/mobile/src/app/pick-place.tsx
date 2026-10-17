import type { PlaceHit, StopHit } from '@transit/shared';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Keyboard, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { hasApi, searchPlaces, searchStops } from '../lib/api';
import { finishPick, type PickKind } from '../lib/handoff';
import { settings } from '../lib/settings';
import type { Place } from '../lib/trips';
import { Icon, type IconName } from '../ui/Icon';
import { Tap } from '../ui/Tap';
import { Text } from '../ui/Text';
import { TopBar } from '../ui/kit';
import { color, font, gutter, radius } from '../ui/theme';

// Not in the Figma file: the From / To / Home picker behind Add trip's
// chevrons and Settings → Home. Search covers places (OSM) and TTC stops.

interface Row {
  key: string;
  icon: IconName;
  title: string;
  sub?: string;
  place: () => Promise<Place | null>;
}

const TITLES: Record<PickKind, string> = { from: 'From', to: 'To', home: 'Home' };

export default function PickPlace() {
  const { kind = 'to' } = useLocalSearchParams<{ kind: PickKind }>();
  const home = settings.use().home;
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Row[]>([]);
  const [status, setStatus] = useState<'idle' | 'searching' | 'error' | 'locating' | 'denied'>('idle');
  const seq = useRef(0);

  // Closing without a choice resolves the caller with null.
  useEffect(() => () => finishPick(null), []);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2 || !hasApi) {
      setResults([]);
      setStatus('idle');
      return;
    }
    const id = ++seq.current;
    setStatus('searching');
    const timer = setTimeout(async () => {
      try {
        const [places, stops] = await Promise.all([searchPlaces(text, 'en', 6), searchStops(text, 'en', 5).catch(() => [] as StopHit[])]);
        if (id !== seq.current) return;
        setResults([...places.map(placeRow), ...stops.map(stopRow)]);
        setStatus('idle');
      } catch {
        if (id === seq.current) setStatus('error');
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  const choose = async (row: Row) => {
    Keyboard.dismiss();
    const place = await row.place();
    if (!place) return;
    finishPick(place);
    router.back();
  };

  const here: Row = {
    key: 'here',
    icon: 'locate',
    title: 'Current location',
    place: async () => {
      setStatus('locating');
      const { granted } = await Location.requestForegroundPermissionsAsync();
      if (!granted) {
        setStatus('denied');
        return null;
      }
      try {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const { latitude: lat, longitude: lon } = pos.coords;
        const addr = (await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon }).catch(() => []))[0];
        const street = [addr?.street, addr?.streetNumber].filter(Boolean).join(' ');
        setStatus('idle');
        return { lat, lon, label: street || 'Current location' };
      } catch {
        setStatus('error');
        return null;
      }
    },
  };
  const homeRow: Row | null =
    home && kind !== 'home' ? { key: 'home', icon: 'home', title: 'Home', sub: home.label, place: async () => ({ lat: home.lat, lon: home.lon, label: 'Home' }) } : null;
  const rows = q.trim().length >= 2 ? results : [homeRow, here].filter((r): r is Row => r !== null);

  const note =
    status === 'searching' ? null : status === 'error' ? "Couldn't search right now. Check the connection." : status === 'denied' ? 'Location is off for this app.' : status === 'locating' ? 'Finding you…' : !hasApi && q.trim().length >= 2 ? 'Search needs the server.' : q.trim().length >= 2 && !results.length ? 'Nothing found.' : null;

  return (
    <View style={styles.screen}>
      <TopBar title={TITLES[kind]} close />
      <View style={styles.searchWrap}>
        <View style={styles.search}>
          <Icon name="search" size={20} color={color.textSecondary} />
          <TextInput
            value={q}
            onChangeText={setQ}
            autoFocus
            placeholder="Search a place or stop"
            placeholderTextColor={color.textSecondary}
            style={styles.input}
            returnKeyType="search"
            autoCorrect={false}
            maxFontSizeMultiplier={1.15}
          />
        </View>
      </View>
      {note && (
        <Animated.View entering={FadeIn.duration(150)}>
          <Text variant="body14" color={color.textSecondary} style={styles.note}>
            {note}
          </Text>
        </Animated.View>
      )}
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        renderItem={({ item, index }) => (
          <Tap onPress={() => choose(item)} feedback="tint" style={[styles.row, index === rows.length - 1 && styles.rowLast]} accessibilityRole="button">
            <View style={styles.rowIcon}>
              <Icon name={item.icon} size={20} color={color.ink} />
            </View>
            <View style={styles.flex}>
              <Text variant="name16" numberOfLines={1}>
                {item.title}
              </Text>
              {item.sub ? (
                <Text variant="caption" color={color.textSecondary} numberOfLines={1}>
                  {item.sub}
                </Text>
              ) : null}
            </View>
          </Tap>
        )}
      />
    </View>
  );
}

const placeRow = (p: PlaceHit, i: number): Row => ({
  key: `p${i}${p.lat}${p.lon}`,
  icon: 'pin',
  title: p.name,
  sub: p.address ?? undefined,
  place: async () => ({ lat: p.lat, lon: p.lon, label: p.name }),
});

const stopRow = (s: StopHit): Row => ({
  key: `s${s.id}`,
  icon: s.mode === 'SUBWAY' ? 'metro' : 'bus',
  title: s.name,
  sub: s.mode === 'SUBWAY' ? 'Metro station' : 'Stop',
  place: async () => ({ lat: s.lat, lon: s.lon, label: s.name }),
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  searchWrap: { paddingHorizontal: gutter, paddingTop: 16, paddingBottom: 8 },
  search: { height: 52, borderRadius: radius.full, backgroundColor: color.surfaceMuted, borderWidth: 1, borderColor: color.border, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18 },
  input: { flex: 1, fontFamily: font.regular, fontSize: 15, color: color.text, paddingVertical: 0, includeFontPadding: false },
  note: { paddingHorizontal: gutter + 4, paddingVertical: 8 },
  list: { paddingTop: 8, paddingBottom: 40 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: gutter, paddingVertical: 14, backgroundColor: color.surface, borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: color.border },
  rowLast: { borderBottomWidth: StyleSheet.hairlineWidth * 2, borderBottomColor: color.border },
  rowIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: color.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
});

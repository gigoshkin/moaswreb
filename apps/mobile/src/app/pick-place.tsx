import type { NearStop, PlaceHit, StopHit } from '@transit/shared';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, FlatList, Keyboard, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { hasApi, nearStops, reversePlace, searchPlaces, searchStops } from '../lib/api';
import { finishPick, pickOptions, type PickKind } from '../lib/handoff';
import { settings } from '../lib/settings';
import type { Place } from '../lib/trips';
import { Button } from '../ui/Button';
import { Icon, type IconName } from '../ui/Icon';
import { MapCanvas, type MapCanvasHandle } from '../ui/MapCanvas';
import { Tap, haptic } from '../ui/Tap';
import { SearchLoading } from '../ui/SearchLoading';
import { Text } from '../ui/Text';
import { MapButton, TopBar } from '../ui/kit';
import { color, font, gutter, radius, shadow, spring } from '../ui/theme';

// Not in the Figma file: the From / To / Home picker behind Add trip and
// Settings → Home. Taxi-app flow: search a street, place or stop and tap it,
// or "Select on map" and drop a pin (with the stops around it as shortcuts).

const TBILISI = { lat: 41.7151, lon: 44.793 };

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
  const [mode, setMode] = useState<'search' | 'map'>('search');

  // Closing without a choice resolves the caller with null.
  useEffect(() => () => finishPick(null), []);

  useEffect(() => {
    if (mode !== 'map' || Platform.OS === 'web') return;
    // Android back from the map returns to the search, not out of the picker.
    const sub = BackHandler.addEventListener('hardwareBackPress', () => (setMode('search'), true));
    return () => sub.remove();
  }, [mode]);

  const done = (place: Place) => {
    Keyboard.dismiss();
    finishPick(place);
    router.back();
  };

  return mode === 'search' ? <Search kind={kind} onPick={done} onMap={() => (Keyboard.dismiss(), setMode('map'))} /> : <MapPick kind={kind} onPick={done} onBack={() => setMode('search')} />;
}

// --- search ---

function Search({ kind, onPick, onMap }: { kind: PickKind; onPick: (p: Place) => void; onMap: () => void }) {
  const home = settings.use().home;
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Row[]>([]);
  const [status, setStatus] = useState<'idle' | 'searching' | 'error' | 'locating' | 'denied'>('idle');
  const seq = useRef(0);

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
    const place = await row.place();
    if (place) onPick(place);
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
  const homeRow: Row | null = home && kind !== 'home' ? { key: 'home', icon: 'home', title: 'Home', sub: home.label, place: async () => ({ lat: home.lat, lon: home.lon, label: 'Home' }) } : null;
  const mapRow: Row = { key: 'map', icon: 'map', title: 'Select on map', place: async () => (onMap(), null) };
  const searching = q.trim().length >= 2;
  const rows = searching ? [...results, mapRow] : [mapRow, homeRow, here].filter((r): r is Row => r !== null);

  const note =
    status === 'searching'
      ? null
      : status === 'error'
        ? "Couldn't search right now. Check the connection."
        : status === 'denied'
          ? 'Location is off for this app.'
          : status === 'locating'
            ? 'Finding you…'
            : !hasApi && searching
              ? 'Search needs the server.'
              : searching && !results.length
                ? 'Nothing found. Try the street name, or select it on the map.'
                : null;

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
            placeholder="Street, place or stop"
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
      {status === 'searching' && <SearchLoading rows={!results.length} />}
      <FlatList
        data={status === 'searching' && !results.length ? [mapRow] : rows}
        keyExtractor={(r) => r.key}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        renderItem={({ item, index }) => (
          <Tap onPress={() => choose(item)} feedback="tint" style={[styles.row, index === rows.length - 1 && styles.rowLast]} accessibilityRole="button">
            <View style={[styles.rowIcon, item.key === 'map' && styles.rowIconMap]}>
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

// --- select on map ---

type Found = { state: 'loading' } | { state: 'ok'; hit: PlaceHit | null };

function MapPick({ kind, onPick, onBack }: { kind: PickKind; onPick: (p: Place) => void; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const home = settings.get().home;
  const { near } = pickOptions();
  const startAt = near ?? (kind !== 'home' && home ? { lat: home.lat, lon: home.lon } : null) ?? TBILISI;
  const map = useRef<MapCanvasHandle>(null);
  const [cardH, setCardH] = useState(180);
  const [center, setCenter] = useState(startAt);
  const [found, setFound] = useState<Found>({ state: 'loading' });
  const [stops, setStops] = useState<NearStop[]>([]);
  const [snapped, setSnapped] = useState<NearStop | null>(null);
  const [locating, setLocating] = useState(false);
  const seq = useRef(0);
  const lastKey = useRef('');
  const pendingSnap = useRef<NearStop | null>(null);

  // The map came to rest: find the address and the stops at the pin.
  const look = useCallback((p: { lat: number; lon: number }) => {
    const key = `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
    if (key === lastKey.current) return;
    lastKey.current = key;
    const id = ++seq.current;
    setCenter(p);
    // Arriving at a stop we flew to keeps it selected; moving the map by hand clears it.
    const want = pendingSnap.current;
    pendingSnap.current = null;
    setSnapped(want && Math.abs(want.lat - p.lat) < 1e-4 && Math.abs(want.lon - p.lon) < 1e-4 ? want : null);
    setFound({ state: 'loading' });
    if (!hasApi) {
      setFound({ state: 'ok', hit: null });
      return;
    }
    reversePlace(p).then(
      (hit) => id === seq.current && setFound({ state: 'ok', hit }),
      () => id === seq.current && setFound({ state: 'ok', hit: null }),
    );
    nearStops(p, { radiusM: 350, limit: 6 }).then(
      (s) => id === seq.current && setStops(s),
      () => id === seq.current && setStops([]),
    );
  }, []);

  useEffect(() => look(startAt), []); // eslint-disable-line react-hooks/exhaustive-deps

  const locate = async () => {
    setLocating(true);
    try {
      const { granted } = await Location.requestForegroundPermissionsAsync();
      if (!granted) return;
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      map.current?.flyTo({ lat: pos.coords.latitude, lon: pos.coords.longitude }, 16);
    } catch {
      // Staying where we are is a fine answer.
    } finally {
      setLocating(false);
    }
  };

  const snap = (s: NearStop) => {
    haptic('selection');
    map.current?.flyTo({ lat: s.lat, lon: s.lon }, 16.2);
    pendingSnap.current = s;
    setSnapped(s);
  };

  const title = snapped ? snapped.name : found.state === 'ok' && found.hit ? found.hit.name : found.state === 'loading' ? null : 'Dropped pin';
  const sub = snapped ? (snapped.mode === 'SUBWAY' ? 'Metro station' : 'Bus stop') : found.state === 'ok' && found.hit?.address ? found.hit.address : undefined;

  const confirm = () => {
    if (snapped) return onPick({ lat: snapped.lat, lon: snapped.lon, label: snapped.name });
    onPick({ lat: center.lat, lon: center.lon, label: title ?? 'Dropped pin' });
  };

  return (
    <View style={styles.screen}>
      <Animated.View style={StyleSheet.absoluteFill} entering={FadeIn.duration(180)}>
        <MapCanvas ref={map} style={StyleSheet.absoluteFill} start={{ center: startAt, zoom: near ? 14.8 : 15.6 }} pin inset={{ bottom: cardH, top: insets.top + 64 }} onIdle={look} />
      </Animated.View>

      <View style={[styles.floating, { top: insets.top + 12 }]} pointerEvents="box-none">
        <MapButton icon="back" label="Back to search" onPress={onBack} />
      </View>

      <View style={[styles.locateWrap, { bottom: cardH + 12 }]} pointerEvents="box-none">
        <MapButton icon="locate" label="My location" onPress={locate} style={locating && styles.busy} />
      </View>

      <Animated.View entering={FadeInDown.springify().damping(spring.smooth.damping).stiffness(spring.smooth.stiffness)} style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} onLayout={(e) => setCardH(e.nativeEvent.layout.height)}>
        <Text variant="caption" color={color.textSecondary}>
          {TITLES[kind]}
        </Text>
        <View style={styles.addressBox}>
          {title === null ? (
            <Animated.View entering={FadeIn.delay(150)} exiting={FadeOut.duration(80)} style={styles.skeleton} />
          ) : (
            <Animated.View key={title} entering={FadeIn.duration(160)}>
              <Text variant="label16" numberOfLines={1} style={styles.address}>
                {title}
              </Text>
              {sub ? (
                <Text variant="caption" color={color.textSecondary} numberOfLines={1}>
                  {sub}
                </Text>
              ) : null}
            </Animated.View>
          )}
        </View>
        {stops.length > 0 && (
          <Animated.View entering={FadeIn.duration(200)} layout={LinearTransition.springify()}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
              {stops.map((s) => (
                <Tap key={s.id} onPress={() => snap(s)} scaleTo={0.95} style={[styles.chip, snapped?.id === s.id && styles.chipOn]} accessibilityRole="button" accessibilityLabel={`${s.name}, ${s.distanceM} metres`}>
                  <Icon name={s.mode === 'SUBWAY' ? 'metro' : 'bus'} size={16} color={snapped?.id === s.id ? color.onInk : color.textSecondary} />
                  <Text variant="body13" color={snapped?.id === s.id ? color.onInk : color.text} numberOfLines={1} style={styles.chipText}>
                    {s.name} · {s.distanceM} m
                  </Text>
                </Tap>
              ))}
            </ScrollView>
          </Animated.View>
        )}
        <Button label="Confirm" onPress={confirm} haptic="none" />
      </Animated.View>
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
  rowIconMap: { backgroundColor: color.sky },
  flex: { flex: 1 },
  floating: { position: 'absolute', left: 12 },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: color.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: gutter, paddingTop: 16, gap: 8, ...shadow.bar },
  locateWrap: { position: 'absolute', right: 12 },
  busy: { opacity: 0.6 },
  addressBox: { minHeight: 44, justifyContent: 'center' },
  address: { fontFamily: font.bold },
  skeleton: { width: 180, height: 16, borderRadius: 8, backgroundColor: color.surfaceMuted },
  chips: { gap: 8, paddingVertical: 4, paddingRight: gutter },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: color.surfaceMuted, borderRadius: 18, borderWidth: 1, borderColor: color.border, paddingHorizontal: 12, paddingVertical: 8 },
  chipOn: { backgroundColor: color.ink, borderColor: color.ink },
  chipText: { maxWidth: 200 },
});

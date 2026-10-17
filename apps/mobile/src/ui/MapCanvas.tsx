import type { LatLon } from '@transit/shared';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, Polyline, type MapStyleElement, type Region } from 'react-native-maps';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { clamp, fitView, latOf, lonOf, normY } from '../lib/mapMath';
import { color, spring } from './theme';

// An interactive map: drag, pinch, optional centre pin. Google Maps through
// react-native-maps (inside Expo Go on Android, so no key is needed there; the
// app never calls a paid Google API). The pin is our own overlay; the map
// moves under it and we read the point under the pin from the region events.
//
// Props and handle are the same as the previous Esri map, so the screens above
// it don't change. `zoom` values keep the old Esri-tile scale (the screens pass
// 14.8–16.2); Google's zoom is that + 1, which frames a pick a little closer.

export interface MapRoute {
  points: LatLon[];
  /** Dashed thin line for walking, solid for riding. */
  walk?: boolean;
  /** Line colour; ink when not set. */
  color?: string;
}

export interface MapMarker {
  key: string;
  at: LatLon;
  /** Drawn centred on the point, or standing on it (`pin`). */
  anchor?: 'center' | 'bottom';
  node: ReactNode;
  /** Makes the marker tappable. */
  onPress?: () => void;
}

export interface MapCanvasHandle {
  /** Glide to a point (and zoom). */
  flyTo: (p: LatLon, zoom?: number) => void;
  /** Glide to frame these points. */
  fit: (points: LatLon[]) => void;
}

export type MapStart = { center: LatLon; zoom: number } | { fit: LatLon[] };

interface Props {
  start: MapStart;
  routes?: MapRoute[];
  markers?: MapMarker[];
  /** Fixed pin at the middle of the free area; the map moves under it. */
  pin?: boolean;
  /** Space covered by overlays; the view's middle (and `fit`) sit in the rest. */
  inset?: { top?: number; bottom?: number };
  interactive?: boolean;
  /** Called when the map comes to rest, with the point under the focus. */
  onIdle?: (center: LatLon, zoom: number) => void;
  /** Called while the map moves, with the point under the focus (for feedback as the pin passes things). */
  onMove?: (center: LatLon, zoom: number) => void;
  onMoveStart?: () => void;
  style?: StyleProp<ViewStyle>;
}

const PIN_H = 44;
/** Points across the world at Google zoom 0. */
const WORLD = 256;
const MIN_G = 8;
const MAX_G = 20;

const worldAt = (g: number) => WORLD * 2 ** g;
const toG = (zoom: number) => clamp(zoom + 1, MIN_G, MAX_G);
const fromG = (g: number) => g - 1;
const ll = (p: LatLon) => ({ latitude: p.lat, longitude: p.lon });
/** Move a point `dy` screen points down (up when negative) at Google zoom `g`. */
const shiftDown = (p: LatLon, g: number, dy: number): LatLon => ({ lat: latOf(normY(p.lat) + dy / worldAt(g)), lon: p.lon });

/** The region that has `c` in the middle of a w × h view at Google zoom `g` (for Apple Maps, which has no camera zoom). */
const regionOf = (c: LatLon, g: number, w: number, h: number): Region => {
  const lonDelta = (360 * w) / worldAt(g);
  return { latitude: c.lat, longitude: c.lon, longitudeDelta: lonDelta, latitudeDelta: lonDelta * (h / w) * Math.cos((c.lat * Math.PI) / 180) };
};

// Google's own style, minus the shop and restaurant pins that crowd the route. Transit stops stay.
const STYLE: MapStyleElement[] = [{ featureType: 'poi.business', stylers: [{ visibility: 'off' }] }];

/** The point and Google zoom that frame `points` in the part of a w × h view that overlays leave free. */
function frame(points: LatLon[], w: number, h: number, top: number, bottom: number) {
  const v = fitView(points, w, Math.max(40, h - top - bottom), { top: 56, bottom: 40, left: 48, right: 48 });
  return { at: { lat: latOf(v.ny), lon: lonOf(v.nx) }, g: clamp(v.zoom - 1, MIN_G, MAX_G) };
}

export const MapCanvas = forwardRef<MapCanvasHandle, Props>(function MapCanvas(
  { start, routes = [], markers = [], pin, inset, interactive = true, onIdle, onMove, onMoveStart, style },
  ref,
) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [initial, setInitial] = useState<{ camera: { center: LatLon; g: number } } | null>(null);
  const insetTop = inset?.top ?? 0;
  const insetBottom = inset?.bottom ?? 0;
  const map = useRef<MapView>(null);

  // Where on screen the pin / focus sits: the middle of the area not covered by overlays.
  const focusY = useSharedValue(0);
  const moving = useSharedValue(0);
  const focus = size.h ? (insetTop + (size.h - insetBottom)) / 2 : 0;
  // How far below the map's own middle the focus is, in points.
  const dy = focus - size.h / 2;

  // Latest values for callbacks that outlive a render.
  const live = useRef({ w: 0, h: 0, dy: 0, g: 15, at: null as LatLon | null, focus: 0 });
  live.current.w = size.w;
  live.current.h = size.h;
  live.current.dy = dy;
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const onMoveStartRef = useRef(onMoveStart);
  onMoveStartRef.current = onMoveStart;

  const onLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    if (w === size.w && h === size.h) return;
    setSize({ w, h });
    if (initial) return;
    const fy = (insetTop + (h - insetBottom)) / 2;
    focusY.value = fy;
    live.current.focus = fy;
    const first = 'fit' in start ? frame(start.fit, w, h, insetTop, insetBottom) : { at: start.center, g: toG(start.zoom) };
    live.current.g = first.g;
    live.current.at = first.at;
    setInitial({ camera: { center: shiftDown(first.at, first.g, -(fy - h / 2)), g: first.g } });
  };

  /** Glide so that `at` sits under the focus. */
  const go = useCallback((at: LatLon, g: number, duration: number) => {
    const { w, h, dy: off } = live.current;
    const c = shiftDown(at, g, -off);
    if (Platform.OS === 'android') map.current?.animateCamera({ center: ll(c), zoom: g }, { duration });
    else map.current?.animateToRegion(regionOf(c, g, w, h), duration);
  }, []);

  // A sheet growing or shrinking moves the middle of the free area: keep the same point under it.
  useEffect(() => {
    if (!initial) return;
    focusY.value = withTiming(focus, { duration: 260, easing: Easing.out(Easing.cubic) });
    if (Math.abs(focus - live.current.focus) < 2) return;
    live.current.focus = focus;
    if (live.current.at) go(live.current.at, live.current.g, 260);
  }, [focus, initial, focusY, go]);

  const regionStart = useCallback(
    (_: Region, d: { isGesture?: boolean }) => {
      if (!d.isGesture) return;
      moving.value = withSpring(1, spring.snappy);
      onMoveStartRef.current?.();
    },
    [moving],
  );

  const regionMoving = useCallback((r: Region) => {
    const { w, dy: off } = live.current;
    if (!onMoveRef.current || !w || !r.longitudeDelta) return;
    const g = Math.log2((360 * w) / (WORLD * r.longitudeDelta));
    onMoveRef.current(shiftDown({ lat: r.latitude, lon: r.longitude }, g, off), fromG(g));
  }, []);

  const regionDone = useCallback(
    (r: Region) => {
      moving.value = withSpring(0, spring.snappy);
      const { w, dy: off } = live.current;
      if (!w || !r.longitudeDelta) return;
      const g = Math.log2((360 * w) / (WORLD * r.longitudeDelta));
      const at = shiftDown({ lat: r.latitude, lon: r.longitude }, g, off);
      live.current.g = g;
      live.current.at = at;
      onIdleRef.current?.(at, fromG(g));
    },
    [moving],
  );

  useImperativeHandle(
    ref,
    () => ({
      flyTo: (p, z) => go(p, toG(z ?? Math.max(fromG(live.current.g), 15.5)), 420),
      fit: (points) => {
        const { w, h } = live.current;
        if (!w || !points.length) return;
        const f = frame(points, w, h, insetTop, insetBottom);
        go(f.at, f.g, 420);
      },
    }),
    [go, insetTop, insetBottom],
  );

  const lines = useMemo(() => routes.filter((r) => r.points.length > 1).map((r) => ({ walk: r.walk, color: r.color, coords: r.points.map(ll) })), [routes]);

  return (
    <View style={[styles.map, style]} onLayout={onLayout}>
      {Platform.OS !== 'web' && initial && (
        <MapView
          ref={map}
          style={StyleSheet.absoluteFill}
          provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
          {...(Platform.OS === 'android'
            ? { initialCamera: { center: ll(initial.camera.center), zoom: initial.camera.g, heading: 0, pitch: 0 } }
            : { initialRegion: regionOf(initial.camera.center, initial.camera.g, size.w, size.h) })}
          customMapStyle={STYLE}
          userInterfaceStyle="light"
          minZoomLevel={MIN_G}
          maxZoomLevel={MAX_G}
          scrollEnabled={interactive}
          zoomEnabled={interactive}
          rotateEnabled={false}
          pitchEnabled={false}
          showsCompass={false}
          showsMyLocationButton={false}
          showsBuildings={false}
          showsTraffic={false}
          showsIndoors={false}
          toolbarEnabled={false}
          zoomControlEnabled={false}
          moveOnMarkerPress={false}
          onRegionChangeStart={regionStart}
          onRegionChange={regionMoving}
          onRegionChangeComplete={regionDone}
        >
          {lines.map((l, i) => (
            <Polyline key={i} coordinates={l.coords} strokeColor={l.color ?? color.ink} strokeWidth={l.walk ? 3 : 5} lineDashPattern={l.walk ? [1, 7] : undefined} lineCap="round" lineJoin="round" />
          ))}
          {markers.map((m) => (
            <MapMark key={m.key} m={m} />
          ))}
        </MapView>
      )}
      {pin && <CenterPin focusY={focusY} moving={moving} />}
    </View>
  );
});

type Shared = ReturnType<typeof useSharedValue<number>>;

/** A marker made of our own views. The native map draws them into a bitmap, so it watches the view briefly (icons settle) and then stops, which is far cheaper. */
function MapMark({ m }: { m: MapMarker }) {
  const [track, setTrack] = useState(true);
  useEffect(() => {
    setTrack(true);
    const t = setTimeout(() => setTrack(false), 600);
    return () => clearTimeout(t);
  }, [m.node]);
  return (
    <Marker coordinate={ll(m.at)} anchor={{ x: 0.5, y: m.anchor === 'bottom' ? 1 : 0.5 }} tracksViewChanges={track} tappable={!!m.onPress} onPress={m.onPress}>
      {m.node}
    </Marker>
  );
}

/** The taxi-style pin: its tip is the chosen point, and it lifts while the map moves. */
function CenterPin({ focusY, moving }: { focusY: Shared; moving: Shared }) {
  const wrap = useAnimatedStyle(() => ({ transform: [{ translateY: focusY.value - PIN_H }] }));
  const lift = useAnimatedStyle(() => ({ transform: [{ translateY: -10 * moving.value }] }));
  const shadow = useAnimatedStyle(() => ({ opacity: 0.25 - 0.12 * moving.value, transform: [{ scale: 1 - 0.3 * moving.value }] }));
  return (
    <Animated.View style={[styles.pinWrap, wrap]} pointerEvents="none">
      <Animated.View style={[styles.pinShadow, shadow]} />
      <Animated.View style={[styles.pin, lift]}>
        <View style={styles.pinHead}>
          <View style={styles.pinDot} />
        </View>
        <View style={styles.pinStem} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  map: { overflow: 'hidden', backgroundColor: '#E8E8E8' },
  pinWrap: { position: 'absolute', left: 0, right: 0, top: 0, height: PIN_H, alignItems: 'center' },
  pin: { alignItems: 'center' },
  pinHead: { width: 32, height: 32, borderRadius: 16, backgroundColor: color.ink, borderWidth: 3, borderColor: color.surface, alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(0,0,0,0.25)' },
  pinDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.surface },
  pinStem: { width: 3, height: 12, backgroundColor: color.ink, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
  pinShadow: { position: 'absolute', bottom: -2, width: 14, height: 5, borderRadius: 3, backgroundColor: '#000' },
});

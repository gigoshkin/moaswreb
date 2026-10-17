import type { LatLon } from '@transit/shared';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import { Image, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { GestureDetector, usePanGesture, usePinchGesture, useSimultaneousGestures } from 'react-native-gesture-handler';
import Animated, { Easing, cancelAnimation, runOnJS, useAnimatedStyle, useSharedValue, withDecay, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Polyline } from 'react-native-svg';
import { MAX_ZOOM, MIN_ZOOM, TILE, clamp, fitView, latOf, lonOf, normX, normY, scaleAt, tileUrl, viewOf } from '../lib/mapMath';
import { color, spring } from './theme';

// An interactive map: drag, pinch, optional centre pin. Esri's muted tiles
// with the route drawn on top (no API key, works in Expo Go).
//
// How it stays smooth: the view is three shared values (nx, ny, zoom) that the
// gestures change on the UI thread. The tiles and route live in one layer laid
// out at a whole "anchor" zoom, relative to an anchor point, so the numbers
// stay small. Every frame the layer is moved and scaled from the view; React
// only re-lays-out the tiles when the view drifts far from the anchor, and the
// layer's transform and its contents change in the same render.

export interface MapRoute {
  points: LatLon[];
  /** Dashed thin line for walking, solid for riding. */
  walk?: boolean;
}

export interface MapMarker {
  key: string;
  at: LatLon;
  /** Drawn centred on the point, or standing on it (`pin`). */
  anchor?: 'center' | 'bottom';
  node: ReactNode;
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
  onMoveStart?: () => void;
  style?: StyleProp<ViewStyle>;
}

interface Anchor {
  nx: number;
  ny: number;
  zi: number;
  /** Scale at the moment of anchoring, so line widths come out right. */
  k: number;
}

const PIN_H = 44;
// Tiles are laid out this far beyond the screen on every side (× the screen size).
const OVERSCAN = 0.6;

const anchorOf = (nx: number, ny: number, zoom: number): Anchor => {
  const zi = clamp(Math.round(zoom), 3, 16);
  return { nx, ny, zi, k: 2 ** (zoom - zi) };
};

export const MapCanvas = forwardRef<MapCanvasHandle, Props>(function MapCanvas(
  { start, routes = [], markers = [], pin, inset, interactive = true, onIdle, onMoveStart, style },
  ref,
) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const insetTop = inset?.top ?? 0;
  const insetBottom = inset?.bottom ?? 0;
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const nx = useSharedValue(0);
  const ny = useSharedValue(0);
  const zoom = useSharedValue(14);
  const moving = useSharedValue(0);
  // Where on screen the view's centre sits: the middle of the area not covered by overlays.
  const focusY = useSharedValue(0);
  const width = useSharedValue(0);
  const lastFocal = useSharedValue({ x: 0, y: 0, active: false });
  // The anchor as the gestures see it, and whether a re-anchor is already on its way.
  const anchorSV = useSharedValue<Anchor>({ nx: 0, ny: 0, zi: 14, k: 1 });
  const anchoring = useSharedValue(false);

  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;
  const onMoveStartRef = useRef(onMoveStart);
  onMoveStartRef.current = onMoveStart;
  const started = useRef(false);

  const commitAnchor = useCallback(
    (a: Anchor) => {
      anchorSV.set(a);
      anchoring.set(false);
      setAnchor(a);
    },
    [anchorSV, anchoring],
  );

  const targetFocusY = size.h ? (insetTop + (size.h - insetBottom)) / 2 : 0;

  // First layout: place the view.
  const onLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    if (w === size.w && h === size.h) return;
    setSize({ w, h });
    width.value = w;
    if (started.current) return;
    started.current = true;
    const fy = (insetTop + (h - insetBottom)) / 2;
    focusY.value = fy;
    const v = 'fit' in start ? fitView(start.fit, w, h, { top: insetTop + 56, bottom: insetBottom + 40, left: 48, right: 48 }) : viewOf(start.center, start.zoom);
    nx.value = v.nx;
    ny.value = v.ny;
    zoom.value = v.zoom;
    commitAnchor(anchorOf(v.nx, v.ny, v.zoom));
  };

  // A sheet growing or shrinking moves the middle of the free area: glide there.
  useEffect(() => {
    if (!size.h) return;
    focusY.value = withTiming(targetFocusY, { duration: 260, easing: Easing.out(Easing.cubic) });
  }, [targetFocusY, size.h, focusY]);

  const idle = useCallback(() => {
    // Back on the JS thread, at rest: re-anchor so the tiles cover the new area, then report.
    const x = nx.get();
    const y = ny.get();
    const z = zoom.get();
    commitAnchor(anchorOf(x, y, z));
    onIdleRef.current?.({ lat: latOf(y), lon: lonOf(x) }, z);
  }, [nx, ny, zoom, commitAnchor]);

  const reanchor = useCallback(() => commitAnchor(anchorOf(nx.get(), ny.get(), zoom.get())), [nx, ny, zoom, commitAnchor]);

  /** Worklet: ask for a re-anchor once the view has drifted far from where the tiles were laid out. */
  const checkDrift = () => {
    'worklet';
    if (anchoring.value) return;
    const a = anchorSV.value;
    const P = TILE * 2 ** a.zi * a.k;
    const far = Math.max(Math.abs(nx.value - a.nx), Math.abs(ny.value - a.ny)) * P > width.value * OVERSCAN * 0.7;
    if (far || Math.abs(zoom.value - a.zi) > 1.4) {
      anchoring.value = true;
      runOnJS(reanchor)();
    }
  };

  const moveStarted = useCallback(() => onMoveStartRef.current?.(), []);

  const pan = usePanGesture({
    enabled: interactive,
    maxPointers: 1,
    onBegin: () => {
      'worklet';
      cancelAnimation(nx);
      cancelAnimation(ny);
    },
    onActivate: () => {
      'worklet';
      moving.value = withSpring(1, spring.snappy);
      runOnJS(moveStarted)();
    },
    onUpdate: (e) => {
      'worklet';
      const s = TILE * 2 ** zoom.value;
      nx.value -= e.changeX / s;
      ny.value = clamp(ny.value - e.changeY / s, 0.01, 0.99);
      checkDrift();
    },
    onDeactivate: (e) => {
      'worklet';
      const s = TILE * 2 ** zoom.value;
      moving.value = withSpring(0, spring.snappy);
      // Let go with some speed: coast to a stop, then report.
      nx.value = withDecay({ velocity: -e.velocityX / s, deceleration: 0.994 });
      ny.value = withDecay({ velocity: -e.velocityY / s, deceleration: 0.994, clamp: [0.01, 0.99] }, (finished) => {
        'worklet';
        if (finished) runOnJS(idle)();
      });
      if (Math.abs(e.velocityX) + Math.abs(e.velocityY) < 40) runOnJS(idle)();
    },
  });

  const pinch = usePinchGesture({
    enabled: interactive,
    onBegin: () => {
      'worklet';
      cancelAnimation(nx);
      cancelAnimation(ny);
      lastFocal.value = { x: 0, y: 0, active: false };
    },
    onActivate: () => {
      'worklet';
      moving.value = withSpring(1, spring.snappy);
      runOnJS(moveStarted)();
    },
    onUpdate: (e) => {
      'worklet';
      const last = lastFocal.value;
      lastFocal.value = { x: e.focalX, y: e.focalY, active: true };
      if (!last.active) return;
      const fx = width.value / 2;
      const sOld = TILE * 2 ** zoom.value;
      const zNew = clamp(zoom.value + Math.log2(e.scaleChange), MIN_ZOOM, MAX_ZOOM);
      const sNew = TILE * 2 ** zNew;
      // Keep the point under the fingers where it is, and follow the fingers' own drift.
      nx.value += (e.focalX - fx) * (1 / sOld - 1 / sNew) - (e.focalX - last.x) / sNew;
      ny.value = clamp(ny.value + (e.focalY - focusY.value) * (1 / sOld - 1 / sNew) - (e.focalY - last.y) / sNew, 0.01, 0.99);
      zoom.value = zNew;
      checkDrift();
    },
    onFinalize: () => {
      'worklet';
      lastFocal.value = { x: 0, y: 0, active: false };
      moving.value = withSpring(0, spring.snappy);
      runOnJS(idle)();
    },
  });

  const gesture = useSimultaneousGestures(pan, pinch);

  const fly = useCallback(
    (v: { nx: number; ny: number; zoom: number }) => {
      cancelAnimation(nx);
      cancelAnimation(ny);
      cancelAnimation(zoom);
      const cfg = { duration: 420, easing: Easing.out(Easing.cubic) };
      // A long glide: lay the tiles out around the target first. A short one keeps the current ones.
      const a = anchorSV.get();
      if (Math.max(Math.abs(v.nx - a.nx), Math.abs(v.ny - a.ny)) * TILE * 2 ** a.zi * a.k > size.w * OVERSCAN * 0.5 || Math.abs(v.zoom - a.zi) > 1) commitAnchor(anchorOf(v.nx, v.ny, v.zoom));
      nx.value = withTiming(v.nx, cfg);
      zoom.value = withTiming(v.zoom, cfg);
      ny.value = withTiming(v.ny, cfg, (finished) => {
        'worklet';
        if (finished) runOnJS(idle)();
      });
    },
    [nx, ny, zoom, idle, anchorSV, commitAnchor, size.w],
  );

  useImperativeHandle(
    ref,
    () => ({
      flyTo: (p, z) => fly({ nx: normX(p.lon), ny: normY(p.lat), zoom: clamp(z ?? Math.max(zoom.get(), 15.5), MIN_ZOOM, MAX_ZOOM) }),
      fit: (points) => {
        if (!size.w || !points.length) return;
        const v = fitView(points, size.w, size.h, { top: insetTop + 56, bottom: insetBottom + 40, left: 48, right: 48 });
        fly(v);
      },
    }),
    [fly, size.w, size.h, insetTop, insetBottom, zoom],
  );

  // --- layer contents, in pixels at the anchor zoom, relative to the anchor point ---

  const layer = useMemo(() => {
    if (!anchor || !size.w) return null;
    const P = scaleAt(anchor.zi);
    const ax = anchor.nx * P;
    const ay = anchor.ny * P;
    const k0 = anchor.k;
    const reachX = (size.w * (0.5 + OVERSCAN)) / k0;
    const reachY = (size.h * (0.5 + OVERSCAN)) / k0;
    const n = 2 ** anchor.zi;
    const tiles: { key: string; uri: string; left: number; top: number }[] = [];
    const x0 = Math.floor((ax - reachX) / TILE);
    const x1 = Math.floor((ax + reachX) / TILE);
    const y0 = Math.floor((ay - reachY) / TILE);
    const y1 = Math.floor((ay + reachY) / TILE);
    for (let tx = x0; tx <= x1; tx++) {
      for (let ty = y0; ty <= y1; ty++) {
        if (tx < 0 || ty < 0 || tx >= n || ty >= n) continue;
        tiles.push({ key: `${anchor.zi}/${tx}/${ty}`, uri: tileUrl(anchor.zi, tx, ty), left: tx * TILE - ax, top: ty * TILE - ay });
      }
    }
    const toLayer = (p: LatLon) => ({ x: normX(p.lon) * P - ax, y: normY(p.lat) * P - ay });
    return { tiles, P, ax, ay, toLayer };
  }, [anchor, size.w, size.h]);

  // Layer transform: layer point L → screen = focus + k·(L − (view − anchor)).
  const layerStyle = useAnimatedStyle(() => {
    if (!anchor) return { opacity: 0 };
    const P = scaleAt(anchor.zi);
    const k = 2 ** (zoom.value - anchor.zi);
    const dx = (nx.value - anchor.nx) * P;
    const dy = (ny.value - anchor.ny) * P;
    // `opacity` stays in every return: a style key that disappears is not reset.
    return { opacity: 1, transform: [{ translateX: width.value / 2 - k * dx }, { translateY: focusY.value - k * dy }, { scale: k }] };
  }, [anchor]);

  const lines = useMemo(() => {
    if (!layer || !anchor) return null;
    const groups = routes.filter((r) => r.points.length > 1).map((r) => ({ walk: r.walk, pts: r.points.map(layer.toLayer) }));
    if (!groups.length) return null;
    const all = groups.flatMap((g) => g.pts);
    const pad = 12;
    const minX = Math.min(...all.map((p) => p.x)) - pad;
    const minY = Math.min(...all.map((p) => p.y)) - pad;
    const maxX = Math.max(...all.map((p) => p.x)) + pad;
    const maxY = Math.max(...all.map((p) => p.y)) + pad;
    return { minX, minY, w: maxX - minX, h: maxY - minY, groups };
  }, [layer, anchor, routes]);

  const k0 = anchor?.k ?? 1;

  return (
    <View style={[styles.map, style]} onLayout={onLayout}>
      <GestureDetector gesture={gesture}>
        <View style={StyleSheet.absoluteFill} collapsable={false}>
          {layer && (
            <Animated.View style={[styles.layer, { width: size.w, height: size.h }, layerStyle]} pointerEvents="none">
              {layer.tiles.map((t) => (
                <Image key={t.key} source={{ uri: t.uri }} style={[styles.tile, { left: t.left, top: t.top }]} fadeDuration={0} />
              ))}
              {lines && (
                <Svg width={lines.w} height={lines.h} style={{ position: 'absolute', left: lines.minX, top: lines.minY }}>
                  {lines.groups.map((g, i) => (
                    <Polyline
                      key={i}
                      points={g.pts.map((p) => `${p.x - lines.minX},${p.y - lines.minY}`).join(' ')}
                      fill="none"
                      stroke={color.ink}
                      strokeWidth={(g.walk ? 3 : 5) / k0}
                      strokeDasharray={g.walk ? `${1 / k0} ${7 / k0}` : undefined}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ))}
                </Svg>
              )}
            </Animated.View>
          )}
          {layer &&
            markers.map((m) => (
              <MarkerView key={m.key} at={layer.toLayer(m.at)} anchor={anchor!} nx={nx} ny={ny} zoom={zoom} width={width} focusY={focusY} bottom={m.anchor === 'bottom'}>
                {m.node}
              </MarkerView>
            ))}
        </View>
      </GestureDetector>
      {pin && <CenterPin focusY={focusY} moving={moving} />}
    </View>
  );
});

type Shared = ReturnType<typeof useSharedValue<number>>;

/** Keeps a marker on its point: same transform as the layer, but not scaled, so it stays crisp. */
function MarkerView({ at, anchor, nx, ny, zoom, width, focusY, bottom, children }: { at: { x: number; y: number }; anchor: Anchor; nx: Shared; ny: Shared; zoom: Shared; width: Shared; focusY: Shared; bottom: boolean; children: ReactNode }) {
  const style = useAnimatedStyle(() => {
    const P = scaleAt(anchor.zi);
    const k = 2 ** (zoom.value - anchor.zi);
    const dx = (nx.value - anchor.nx) * P;
    const dy = (ny.value - anchor.ny) * P;
    return { transform: [{ translateX: width.value / 2 + k * (at.x - dx) }, { translateY: focusY.value + k * (at.y - dy) }] };
  }, [anchor, at.x, at.y]);
  return (
    <Animated.View style={[styles.marker, style]} pointerEvents="none">
      <View style={bottom ? styles.markerBottom : styles.markerCenter}>{children}</View>
    </Animated.View>
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
  layer: { position: 'absolute', left: 0, top: 0, transformOrigin: '0% 0%' },
  tile: { position: 'absolute', width: TILE, height: TILE },
  marker: { position: 'absolute', left: 0, top: 0 },
  markerCenter: { transform: [{ translateX: '-50%' }, { translateY: '-50%' }] },
  markerBottom: { transform: [{ translateX: '-50%' }, { translateY: '-100%' }] },
  pinWrap: { position: 'absolute', left: 0, right: 0, top: 0, height: PIN_H, alignItems: 'center' },
  pin: { alignItems: 'center' },
  pinHead: { width: 32, height: 32, borderRadius: 16, backgroundColor: color.ink, borderWidth: 3, borderColor: color.surface, alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(0,0,0,0.25)' },
  pinDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.surface },
  pinStem: { width: 3, height: 12, backgroundColor: color.ink, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
  pinShadow: { position: 'absolute', bottom: -2, width: 14, height: 5, borderRadius: 3, backgroundColor: '#000' },
});

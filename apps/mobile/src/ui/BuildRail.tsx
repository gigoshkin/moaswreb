import { useEffect, useRef, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type LayoutChangeEvent, type ScrollViewInstance } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { FAR_WALK_M } from '../lib/chain';
import type { Row } from '../lib/buildFlow';
import { distanceLabel } from '../lib/stops';
import { Button } from './Button';
import { Icon } from './Icon';
import { Stack } from './LineChain';
import { RoutePlate, kindColor } from './RoutePlate';
import { Tap } from './Tap';
import { Text } from './Text';
import { color, radius } from './theme';

interface Props {
  rows: Row[];
  /** The row to keep in view (scrolled to when it changes or grows): the ride being built, an open ride, else the newest. */
  keep: number;
  /** Shown under the rows, scrolling with them (loading, shortcuts, the leave-time preview). */
  children?: ReactNode;
  /** The ride whose edit bar is open. */
  open: number | null;
  /** The stop under the pin while a ride waits for its get-off stop. */
  hotName: string | null;
  /** Rides can be inserted / replaced now (the pin is free). */
  editable: boolean;
  onOpen: (i: number) => void;
  onToggle: (i: number, label: string) => void;
  onReplace: (i: number) => void;
  onRemove: (i: number) => void;
  onInsert: (i: number) => void;
}

/**
 * The route as a rail of rows: [Walk Start | End] [Ride stop -> stop, its lines] [Walk] [Ride] ...
 * Tap a ride to switch its lines, replace or remove it; + on a walk between two rides inserts one there.
 */
export function BuildRail({ rows, keep, children, open, hotName, editable, onOpen, onToggle, onReplace, onRemove, onInsert }: Props) {
  const scroll = useRef<ScrollViewInstance>(null);
  const view = useRef({ y: 0, h: 0 });
  const at = useRef(new Map<number, { y: number; h: number }>());
  // Scroll just enough to show the kept row whole (its top first when it is taller than the rail).
  const show = (k: number) => {
    const r = at.current.get(k);
    const v = view.current;
    if (!r || !v.h) return;
    if (r.y + r.h > v.y + v.h) scroll.current?.scrollTo({ y: Math.min(r.y, r.y + r.h - v.h + 4), animated: true });
    else if (r.y < v.y) scroll.current?.scrollTo({ y: Math.max(0, r.y - 4), animated: true });
  };
  useEffect(() => {
    const t = setTimeout(() => show(keep), 60); // after the new rows are laid out
    return () => clearTimeout(t);
  }, [keep, rows.length, open]); // eslint-disable-line react-hooks/exhaustive-deps
  const measure = (k: number) => (e: LayoutChangeEvent) => {
    const { y, height } = e.nativeEvent.layout;
    at.current.set(k, { y, h: height });
    if (k === keep) show(k);
  };
  return (
    <ScrollView
      ref={scroll}
      style={[styles.scroll, rows.length > 0 && styles.someRows]}
      contentContainerStyle={styles.rail}
      showsVerticalScrollIndicator
      keyboardShouldPersistTaps="handled"
      scrollEventThrottle={32}
      onScroll={(e) => (view.current = { y: e.nativeEvent.contentOffset.y, h: e.nativeEvent.layoutMeasurement.height })}
      onLayout={(e) => (view.current = { ...view.current, h: e.nativeEvent.layout.height })}
    >
      {rows.map((row, k) => (
        <View key={rowKey(row, k)} onLayout={measure(k)}>
          {rowView(row)}
        </View>
      ))}
      {children}
    </ScrollView>
  );

  function rowView(row: Row) {
    if (row.kind === 'walk') {
      const far = (row.metres ?? 0) > FAR_WALK_M;
      const onSpot = row.metres === 0;
      return (
        <View style={styles.walk}>
          <View style={styles.pair}>
            <End caption="Start" label={row.from.label} />
            <Icon name="chevron-right" size={16} color={color.textTertiary} />
            <End caption="End" label={row.to?.label ?? null} />
          </View>
          <View style={styles.walkLine}>
            <Icon name="walk" size={14} color={far ? color.metro : color.textSecondary} />
            <Text variant="caption" color={far ? color.metro : color.textSecondary} style={styles.flex}>
              {row.metres === null ? 'Walk: move the pin to where it ends' : onSpot ? 'Change here' : `Walk ${distanceLabel(row.metres)} · about ${row.minutes} min${far ? ' (far)' : ''}`}
            </Text>
            {editable && row.insertAt !== undefined && (
              <Tap onPress={() => onInsert(row.insertAt!)} hitSlop={8} style={styles.junction} accessibilityRole="button" accessibilityLabel={`Add a ride before ride ${row.insertAt + 1}`}>
                <Icon name="plus" size={14} />
              </Tap>
            )}
          </View>
        </View>
      );
    }
    if (row.kind === 'boarding') {
      return (
        <Animated.View entering={FadeIn.duration(160)} style={[styles.ride, styles.rideOpen]}>
          <View style={styles.track}>
            <View style={[styles.bar, { backgroundColor: color.ink }]} />
          </View>
          <Text variant="label14" numberOfLines={2} style={styles.flex}>
            {row.board.name} → <Text variant="label14" color={hotName ? color.text : color.textTertiary}>{hotName ?? 'get off where?'}</Text>
          </Text>
        </Animated.View>
      );
    }
    const r = row.ride;
    const i = row.index;
    const expanded = open === i && editable;
    return (
      <View>
        <Tap
          onPress={() => onOpen(i)}
          disabled={!editable}
          feedback="tint"
          style={[styles.ride, expanded && styles.rideOpen, row.replacing && styles.replacing]}
          accessibilityRole="button"
          accessibilityLabel={`Ride ${i + 1}: ${r.board.name} to ${r.off.name}. Edit`}
        >
          <View style={styles.track}>
            <View style={[styles.bar, { backgroundColor: kindColor[r.lines[0]?.kind ?? 'bus'] }]} />
          </View>
          <View style={styles.flex}>
            <Text variant="label14" numberOfLines={1}>
              {r.board.name} → {r.off.name}
            </Text>
            {r.lines.length > 0 && (
              <View style={styles.plates}>
                <Stack slot={r.lines.filter((l) => !r.skipped.includes(l.label))} size="sm" />
              </View>
            )}
          </View>
          {editable && <Icon name="chevron-right" size={18} color={color.textTertiary} />}
        </Tap>
        {expanded && (
          <Animated.View entering={FadeIn.duration(160)} style={styles.editBar}>
            {r.lines.length > 1 && (
              <View style={styles.chips}>
                <Text variant="caption" color={color.textSecondary}>
                  Lines on this ride (tap to switch off)
                </Text>
                <View style={styles.chipRow}>
                  {r.lines.map((l) => {
                    const off = r.skipped.includes(l.label);
                    return (
                      <Tap key={l.label} onPress={() => onToggle(i, l.label)} scaleTo={0.92} style={[styles.chip, off && styles.chipOff]} accessibilityRole="switch" accessibilityState={{ checked: !off }} accessibilityLabel={`Line ${l.label}`}>
                        <RoutePlate label={l.label} kind={l.kind} size="sm" />
                        <Icon name={off ? 'plus' : 'close'} size={12} color={color.textSecondary} />
                      </Tap>
                    );
                  })}
                </View>
              </View>
            )}
            <View style={styles.editActions}>
              <Button label="Replace" kind="secondary" onPress={() => onReplace(i)} haptic="none" style={styles.editBtn} />
              <Button label="Remove" kind="secondary" onPress={() => onRemove(i)} haptic="none" style={styles.editBtn} />
            </View>
          </Animated.View>
        )}
      </View>
    );
  }
}

const rowKey = (row: Row, k: number) => (row.kind === 'ride' ? `r${k}-${row.ride.board.id}-${row.ride.off.id}` : `${row.kind[0]}${k}`);

/** One end of a walk: its caption and place, or a hint while the pin is placing it. */
function End({ caption, label }: { caption: string; label: string | null }) {
  return (
    <View style={styles.half}>
      <Text variant="caption" color={color.textSecondary}>
        {caption}
      </Text>
      <Text variant="label14" numberOfLines={1} color={label ? color.text : color.textTertiary}>
        {label ?? 'Move the pin'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Takes the room the sheet has left (it is bounded above) and no more; scrolls beyond that.
  scroll: { flexGrow: 0, flexShrink: 1 },
  someRows: { minHeight: 56 },
  rail: { gap: 6, paddingBottom: 4 },
  walk: { gap: 4 },
  pair: { flexDirection: 'row', alignItems: 'center', backgroundColor: color.surfaceMuted, borderRadius: radius.md, minHeight: 48, paddingHorizontal: 6 },
  half: { flex: 1, paddingHorizontal: 8, paddingVertical: 4 },
  walkLine: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 26, paddingLeft: 8 },
  junction: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: color.border, backgroundColor: color.surface },
  ride: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, borderRadius: radius.sm, paddingVertical: 4, paddingRight: 6 },
  rideOpen: { backgroundColor: color.surfaceMuted },
  replacing: { opacity: 0.4 },
  track: { width: 14, alignItems: 'center', alignSelf: 'stretch', justifyContent: 'center' },
  bar: { width: 5, flex: 1, borderRadius: 3, marginVertical: 2 },
  plates: { flexDirection: 'row', marginTop: 2 },
  editBar: { gap: 10, paddingLeft: 24, paddingTop: 8, paddingBottom: 6 },
  chips: { gap: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5, paddingLeft: 6, paddingRight: 8, borderRadius: 14, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface },
  chipOff: { opacity: 0.4 },
  editActions: { flexDirection: 'row', gap: 8 },
  editBtn: { flex: 1, height: 44 },
  flex: { flex: 1 },
});

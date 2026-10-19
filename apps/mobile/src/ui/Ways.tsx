import type { Itinerary, PlanAvoid } from '@transit/shared';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { kindOf, leaveAt, transitLegs } from '../lib/plans';
import { chainOf, groupWays, isOwn, isOwnRow, isTicked, stepSlots, toggleWay, unplannedKept, type RideStep, type Way } from '../lib/ways';
import { hhmm } from '../lib/time';
import { Icon } from './Icon';
import { LineChain } from './LineChain';
import { RoutePlate } from './RoutePlate';
import { Busy } from './Spinner';
import { Tap, haptic } from './Tap';
import { Text } from './Text';
import { Card } from './kit';
import { color, radius } from './theme';

// Every way the planner found for a trip, grouped like Google Maps: numbers
// stacked on each other are alternatives for the same ride (any of them gets
// you there), an arrow means you change. Tap a way to open it, see each option
// and show it on the map. Excluding a line is done once, for the route on top
// of the list; the avoid list belongs to this trip only.
// With `onKeep` the list is a checklist: every ticked row is a way the trip
// keeps (with all its variations), and the trip uses those and nothing else.
// Only the box ticks or unticks (at least one stays ticked); the rest of the
// row shows the way on the map and opens its options, so looking never
// changes the trip. The rider's own routes say so, and stay listed when
// nothing can be planned for them right now.

interface Props {
  itineraries: Itinerary[];
  /** The one the app will use (best on time). */
  chosenId?: string;
  /** The one shown on the map, when the person tapped another. */
  selectedId?: string;
  now: number;
  bufferMin: number;
  avoid?: PlanAvoid;
  /** The planner is working (first answer, or a new one after a change). */
  loading?: boolean;
  onSelect?: (it: Itinerary) => void;
  onAvoid: (avoid: PlanAvoid | undefined) => void;
  /** The ways the trip keeps (ticked rows); empty when the app picks. */
  kept?: RideStep[][];
  /** Turns on the checkboxes: called with the new set of kept ways. */
  onKeep?: (ways: RideStep[][]) => void;
}

const tidy = (names: string[]): PlanAvoid | undefined => {
  const routes = [...new Set(names)].sort();
  return routes.length ? { routes } : undefined;
};

/** Lines of an itinerary that can be avoided (metro can't). */
const avoidable = (it: Itinerary) => transitLegs(it).filter((l) => l.mode !== 'SUBWAY');

export function Ways({ itineraries, chosenId, selectedId, now, bufferMin, avoid, loading, onSelect, onAvoid, kept = [], onKeep }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const skipped = avoid?.routes ?? [];
  const ways = groupWays(itineraries, bufferMin);
  const activeId = selectedId ?? chosenId;
  const chosen = itineraries.find((it) => it.id === chosenId);
  const toggleRoute = (name: string) => {
    haptic('selection');
    onAvoid(tidy(skipped.includes(name) ? skipped.filter((r) => r !== name) : [...skipped, name]));
  };

  return (
    <View style={styles.wrap}>
      {loading && <Busy label="Looking at every line…" />}
      {skipped.length > 0 && (
        <View style={styles.chips}>
          <Text variant="caption" color={color.textSecondary}>
            Not using
          </Text>
          {skipped.map((r) => (
            <Tap key={r} onPress={() => toggleRoute(r)} hitSlop={6} style={styles.chip} accessibilityRole="button" accessibilityLabel={`Use ${r} again`}>
              <Text variant="label13" color={color.onInk}>
                {r}
              </Text>
              <Icon name="close" size={14} color={color.onInk} />
            </Tap>
          ))}
        </View>
      )}
      {ways.length === 0 ? (
        !loading && !unplannedKept(kept, itineraries).length && (
          <Card>
            <Text variant="body14" color={color.textSecondary}>
              {skipped.length ? 'Nothing is left once those lines are skipped.' : 'No options found.'}
            </Text>
          </Card>
        )
      ) : (
        ways.map((w) => (
          <WayCard
            key={w.key}
            way={w}
            open={open === w.key}
            activeId={activeId}
            chosenId={chosenId}
            now={now}
            bufferMin={bufferMin}
            onToggle={() => setOpen(open === w.key ? null : w.key)}
            onSelect={onSelect}
            ticked={onKeep ? isTicked(w, kept) : undefined}
            onTick={onKeep ? () => onKeep(toggleWay(kept, w, itineraries)) : undefined}
            own={isOwnRow(w, kept)}
          />
        ))
      )}
      {!loading &&
        unplannedKept(kept, itineraries).map((k, i) => (
          <MissingWay key={`missing-${i}`} steps={k} onUntick={onKeep && kept.length > 1 ? () => onKeep(kept.filter((x) => x !== k)) : undefined} />
        ))}
      {chosen && avoidable(chosen).length > 0 && (
        <View style={styles.exclude}>
          <Text variant="caption" color={color.textSecondary}>
            Never use on this trip
          </Text>
          {avoidable(chosen).map((l) => (
            <Tap key={l.route?.shortName} onPress={() => toggleRoute(l.route?.shortName ?? '')} hitSlop={6} style={styles.neverBtn} accessibilityRole="button" accessibilityLabel={`Never use ${l.route?.shortName}`}>
              <RoutePlate label={l.route?.shortName ?? l.mode} kind={kindOf(l)} size="sm" />
              <Icon name="close" size={14} color={color.textSecondary} />
            </Tap>
          ))}
        </View>
      )}
    </View>
  );
}

interface CardProps {
  way: Way;
  open: boolean;
  activeId?: string;
  chosenId?: string;
  now: number;
  bufferMin: number;
  onToggle: () => void;
  onSelect?: (it: Itinerary) => void;
  /** Checklist mode: whether the trip keeps this way, and the tap that ticks or unticks it. */
  ticked?: boolean;
  onTick?: () => void;
  /** One of the rider's own routes. */
  own?: boolean;
}

function WayCard({ way, open, activeId, chosenId, now, bufferMin, onToggle, onSelect, ticked, onTick, own }: CardProps) {
  const best = way.its[0];
  const leave = leaveAt(best, bufferMin);
  const gone = leave < now - 60_000;
  const current = way.its.some((it) => it.id === activeId);
  const min = Math.max(1, Math.round(best.durationSec / 60));
  const many = way.its.length > 1;
  const chevron = (
    <View style={{ transform: [{ rotate: open ? '-90deg' : '90deg' }] }}>
      <Icon name="chevron-right" size={18} color={color.textTertiary} />
    </View>
  );
  return (
    <Card style={[styles.card, current && styles.current, gone && styles.gone]}>
      <Tap
        onPress={() => {
          haptic('selection');
          // Looking at a way: on the map, and its options open. Keeping it is the box's job.
          if (many) onToggle();
          onSelect?.(best);
        }}
        scaleTo={0.99}
        style={styles.head}
        accessibilityRole="button"
        accessibilityLabel={`${own ? 'Your route. ' : ''}Show on the map`}
        accessibilityState={{ expanded: open }}
      >
        {onTick && (
          <Tap
            onPress={() => {
              haptic('selection');
              onTick();
            }}
            hitSlop={12}
            scaleTo={0.9}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: !!ticked }}
            accessibilityLabel={ticked ? 'Kept for this trip. Tap to stop using it' : 'Keep this way for the trip'}
          >
            <TickBox on={!!ticked} />
          </Tap>
        )}
        <View style={styles.headMain}>
          {own && <OwnBadge />}
          <LineChain slots={way.slots} />
          <Text variant="caption" color={color.textSecondary}>
            Arrive {hhmm(best.arriveAt)} · {min} min · {Math.round(best.walkSec / 60)} min walk{best.transfers > 0 ? ` · ${best.transfers} change${best.transfers > 1 ? 's' : ''}` : ''}
            {best.id === chosenId ? ' · best' : ''}
          </Text>
        </View>
        <View style={styles.headSide}>
          <Text variant="label16">{gone ? 'Gone' : hhmm(leave)}</Text>
          {many && chevron}
        </View>
      </Tap>
      {open && many && (
        <Animated.View entering={FadeIn.duration(160)} style={styles.detail}>
          {way.its.map((it) => (
            <Tap key={it.id} onPress={() => onSelect?.(it)} feedback="tint" style={[styles.opt, it.id === activeId && styles.optOn]} accessibilityRole="button">
              <LineChain slots={chainOf(it)} size="sm" />
              <Text variant="caption" color={color.textSecondary} style={styles.flex} numberOfLines={1}>
                {leaveAt(it, bufferMin) < now - 60_000 ? 'Gone' : hhmm(leaveAt(it, bufferMin))} → {hhmm(it.arriveAt)} · {transitLegs(it).some((l) => l.realtime) ? 'live' : 'timetable'}
              </Text>
            </Tap>
          ))}
        </Animated.View>
      )}
    </Card>
  );
}

/** A kept way of the rider's own that no plan rides right now: still listed, ticked, with why it has no times. */
function MissingWay({ steps, onUntick }: { steps: RideStep[]; onUntick?: () => void }) {
  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Tap onPress={() => onUntick?.()} disabled={!onUntick} hitSlop={12} scaleTo={0.9} accessibilityRole="checkbox" accessibilityState={{ checked: true }} accessibilityLabel="Kept for this trip">
          <TickBox on />
        </Tap>
        <View style={styles.headMain}>
          {isOwn(steps) && <OwnBadge />}
          <LineChain slots={stepSlots(steps)} />
          <Text variant="caption" color={color.textSecondary}>
            No departures found for this time right now. The trip keeps it and tries again.
          </Text>
        </View>
      </View>
    </Card>
  );
}

/** "Your route": a way the rider built by hand or described in chat. */
export function OwnBadge() {
  return (
    <View style={styles.own}>
      <Icon name="map" size={12} color={color.textSecondary} />
      <Text variant="captionStrong" color={color.textSecondary}>
        Your route
      </Text>
    </View>
  );
}

/** The tick of a way row; the same box on every list of ways (trip screens, route builder, chat cards). */
export function TickBox({ on }: { on: boolean }) {
  return <View style={[styles.box, on && styles.boxOn]}>{on && <Icon name="check" size={14} color={color.onInk} />}</View>;
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  flex: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 28, paddingHorizontal: 10, borderRadius: radius.md, backgroundColor: color.ink },
  card: { padding: 0, overflow: 'hidden' },
  current: { borderWidth: 2, borderColor: color.ink },
  gone: { opacity: 0.5 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  headMain: { flex: 1, gap: 6 },
  headSide: { alignItems: 'flex-end', gap: 4 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: color.border, alignItems: 'center', justifyContent: 'center' },
  boxOn: { borderColor: color.ink, backgroundColor: color.ink },
  detail: { gap: 4, paddingHorizontal: 8, paddingBottom: 12 },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 6, borderRadius: radius.sm },
  optOn: { backgroundColor: color.surfaceMuted },
  exclude: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, paddingTop: 6 },
  own: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  neverBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});

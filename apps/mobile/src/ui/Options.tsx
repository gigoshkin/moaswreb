import type { Itinerary, PlanAvoid } from '@transit/shared';
import { StyleSheet, View } from 'react-native';
import { isMetro, leaveAt, transitLegs } from '../lib/plans';
import { hhmm } from '../lib/time';
import { RoutePlate } from './RoutePlate';
import { Tap, haptic } from './Tap';
import { Text } from './Text';
import { Card, Chip, Switch } from './kit';
import { color, radius } from './theme';

// Every way the planner found for a trip, side by side, and what the trip
// never uses ("not 518", "no microbuses"). The avoid list belongs to this trip only.

interface Props {
  itineraries: Itinerary[];
  /** The one the app will use (best on time). */
  chosenId?: string;
  now: number;
  bufferMin: number;
  avoid?: PlanAvoid;
  loading?: boolean;
  onAvoid: (avoid: PlanAvoid | undefined) => void;
}

/** Lines of an itinerary that can be avoided, with whether they are minibuses. */
const linesOf = (it: Itinerary) => transitLegs(it).map((l) => ({ name: l.route?.shortName ?? l.mode, minibus: l.route?.minibus === true, metro: isMetro(l) }));

const tidy = (a: PlanAvoid): PlanAvoid | undefined => {
  const routes = [...new Set(a.routes ?? [])].sort();
  return routes.length || a.minibus ? { ...(routes.length ? { routes } : {}), ...(a.minibus ? { minibus: true } : {}) } : undefined;
};

export function Options({ itineraries, chosenId, now, bufferMin, avoid, loading, onAvoid }: Props) {
  const rows = itineraries
    .map((it) => ({ it, leave: leaveAt(it, bufferMin) }))
    .sort((a, b) => Date.parse(a.it.arriveAt) - Date.parse(b.it.arriveAt) || b.leave - a.leave);
  const skipped = avoid?.routes ?? [];
  const hasMinibus = itineraries.some((it) => linesOf(it).some((l) => l.minibus)) || avoid?.minibus;
  const toggleRoute = (name: string) => {
    haptic('selection');
    onAvoid(tidy({ ...avoid, routes: skipped.includes(name) ? skipped.filter((r) => r !== name) : [...skipped, name] }));
  };

  return (
    <View style={styles.wrap}>
      {skipped.length > 0 && (
        <View style={styles.chips}>
          <Text variant="caption" color={color.textSecondary}>
            This trip never uses
          </Text>
          {skipped.map((r) => (
            <Chip key={r} label={`${r}  ✕`} on onPress={() => toggleRoute(r)} />
          ))}
        </View>
      )}
      {hasMinibus && (
        <Card style={styles.switchCard}>
          <Text variant="body15" style={styles.flex}>
            Skip minibuses on this trip
          </Text>
          <Switch label="Skip minibuses on this trip" value={Boolean(avoid?.minibus)} onChange={(v) => onAvoid(tidy({ ...avoid, minibus: v }))} />
        </Card>
      )}
      {rows.length === 0 ? (
        <Card>
          <Text variant="body14" color={color.textSecondary}>
            {loading ? 'Looking at every line…' : skipped.length || avoid?.minibus ? 'Nothing is left once those lines are skipped.' : 'No options found.'}
          </Text>
        </Card>
      ) : (
        rows.map(({ it, leave }) => {
          const lines = linesOf(it);
          const missed = leave < now - 60_000;
          const chosen = it.id === chosenId;
          return (
            <Card key={it.id} style={[styles.row, chosen && styles.chosen, missed && styles.missed]}>
              <View style={styles.top}>
                <View style={styles.plates}>
                  {lines.map((l, i) => (
                    <RoutePlate key={i} label={l.name} metro={l.metro} size="md" />
                  ))}
                </View>
                <Text variant="label16">{missed ? 'Gone' : `Leave ${hhmm(leave)}`}</Text>
              </View>
              <Text variant="caption" color={color.textSecondary}>
                Arrive {hhmm(it.arriveAt)} · {Math.max(1, Math.round(it.durationSec / 60))} min
                {it.transfers > 0 ? ` · ${it.transfers} change${it.transfers > 1 ? 's' : ''}` : ''}
                {lines.some((l) => l.minibus) ? ' · minibus' : ''}
                {transitLegs(it).some((l) => l.realtime) ? ' · live' : ' · timetable'}
                {chosen ? ' · best' : ''}
              </Text>
              <View style={styles.skips}>
                {lines
                  .filter((l) => !l.metro)
                  .map((l, i) => (
                    <Tap key={i} onPress={() => toggleRoute(l.name)} style={styles.skip} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Never use ${l.name} on this trip`}>
                      <Text variant="caption" color={color.textSecondary}>
                        Never use {l.name}
                      </Text>
                    </Tap>
                  ))}
              </View>
            </Card>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  switchCard: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  flex: { flex: 1 },
  row: { padding: 14, gap: 6 },
  chosen: { borderWidth: 2, borderColor: color.ink },
  missed: { opacity: 0.5 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  plates: { flexDirection: 'row', gap: 6, flexShrink: 1, flexWrap: 'wrap' },
  skips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 2 },
  skip: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: radius.md, backgroundColor: color.surfaceMuted },
});

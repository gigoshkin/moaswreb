import type { Itinerary, PlanLeg } from '@transit/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { Fragment, useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getPreview, openNewTrip } from '../../lib/handoff';
import { firstWalkMin, isMetro, kindOf, lastWalkMin, leaveAt, mergeItineraries, placeName } from '../../lib/plans';
import { settings } from '../../lib/settings';
import { hhmm, nextArriveBy } from '../../lib/time';
import { getTrip, saveTrip, tripDays, useTrips, withStops } from '../../lib/trips';
import { useNow } from '../../lib/useNow';
import { everyLine, useTripPlan } from '../../lib/useTripPlan';
import { slotsFor, tripWays, variantSteps, waysFields, type RideStep } from '../../lib/ways';
import { Button } from '../../ui/Button';
import { Busy } from '../../ui/Spinner';
import { Icon, type IconName } from '../../ui/Icon';
import { LeaveByBar } from '../../ui/LeaveByBar';
import { Ways } from '../../ui/Ways';
import { RoutePlate } from '../../ui/RoutePlate';
import { StaticMap } from '../../ui/StaticMap';
import { SuggestionCard } from '../../ui/Suggestion';
import { Text } from '../../ui/Text';
import { Card, RouteSummary, SectionLabel, TopBar } from '../../ui/kit';
import { color, gutter } from '../../ui/theme';

const MAP_H = 220;

export default function TripDetail() {
  const { id, date: dateParam, preview } = useLocalSearchParams<{ id: string; date?: string; preview?: string }>();
  const now = useNow();
  const trips = useTrips();
  const trip = preview ? null : (trips.find((t) => t.id === id) ?? null);
  const date = dateParam ?? (trip ? nextArriveBy(trip.arriveBy, tripDays(trip), now).slice(0, 10) : '');
  // Follows the kept ways only; another way is suggested apart from them, and only when they all missed.
  const live = useTripPlan(trip, date, now, { refreshMs: 60_000, suggest: true });
  // A hook, so it lives here and not inside the conditional JSX below: the number of hooks must not change between renders.
  const bufferMin = settings.use().bufferMin;
  const p = preview ? getPreview(id) : undefined;
  // A trip that keeps ways lists every way for its ends, ticked or not: a second plan over every line.
  const kept = trip ? tripWays(trip) : [];
  const anyLine = useMemo(() => (trip && kept.length ? everyLine(trip) : null), [trip, kept.length]);
  const every = useTripPlan(anyLine, date, now);
  const listed = useMemo(() => (kept.length ? mergeItineraries([every.itineraries, live.itineraries]) : live.itineraries), [kept.length, every.itineraries, live.itineraries]);

  const it: Itinerary | null = useMemo(() => {
    if (p) return p.plan.itineraries.find((x) => x.id === p.itineraryId) ?? null;
    if (live.choice.kind !== 'none') return live.choice.it;
    return live.itineraries[0] ?? null;
  }, [p, live.choice, live.itineraries]);

  const name = p?.name ?? trip?.name ?? '';
  const arriveBy = p ? p.plan.query.arriveBy.slice(11, 16) : (trip?.arriveBy ?? '');

  if (!p && !trip) {
    return (
      <View style={styles.screen}>
        <TopBar title="Trip" />
        <View style={styles.center}>
          <Text variant="body15" color={color.textSecondary}>
            This trip was deleted.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <TopBar title={`${name} · ${arriveBy}`} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {it ? <StaticMap itinerary={it} height={MAP_H} /> : <View style={{ height: MAP_H, backgroundColor: '#E8E8E8' }} />}
        <View style={styles.content}>
          {it ? (
            <Animated.View entering={FadeIn.duration(200)} style={styles.gap}>
              <Departure it={it} all={live.itineraries} now={now} />
              {trip && live.suggestion ? <SuggestionCard trip={trip} date={date} s={live.suggestion} /> : null}
              <SectionLabel style={styles.sectionLabel}>Route details</SectionLabel>
              <Timeline it={it} destination={p?.to.label ?? trip?.to.label ?? ''} />
            </Animated.View>
          ) : trip && live.suggestion ? (
            <SuggestionCard trip={trip} date={date} s={live.suggestion} />
          ) : null}
          {trip && (listed.length > 0 || trip.avoid) ? (
            <Animated.View entering={FadeIn.duration(200)} style={styles.gap}>
              <SectionLabel style={styles.sectionLabel}>All ways to get there</SectionLabel>
              <Ways
                itineraries={listed}
                chosenId={live.choice.kind === 'none' ? undefined : live.choice.it.id}
                now={now}
                bufferMin={bufferMin}
                avoid={trip.avoid}
                loading={!live.error && (!live.loaded || live.refreshing || (kept.length > 0 && !every.loaded))}
                // A trip with kept ways ticks them here: the trip uses the ticked ways and nothing else.
                kept={kept}
                onKeep={
                  kept.length
                    ? (ways: RideStep[][]) => {
                        const next = { ...trip, ...waysFields(ways) };
                        saveTrip(next);
                        // The first stop can change with the ways; a slower answer must not undo a newer tick.
                        withStops(next).then((t) => JSON.stringify(tripWays(getTrip(t.id) ?? {})) === JSON.stringify(ways) && saveTrip(t));
                      }
                    : undefined
                }
                onAvoid={(avoid) => {
                  // The first stop and the walk can change with the avoid list: save now, refresh the server's copy after.
                  const next = { ...trip, avoid };
                  saveTrip(next);
                  withStops(next).then(saveTrip);
                }}
              />
            </Animated.View>
          ) : null}
          {it ? null : (
            <Card>
              {live.error || live.loaded ? (
                <Text variant="body15" color={color.textSecondary}>
                  {live.error ? "Can't reach the planner right now." : 'No route found for this trip.'}
                </Text>
              ) : (
                <Busy label="Planning…" />
              )}
            </Card>
          )}
          {p ? (
            <Button
              label="Save this route"
              onPress={() => {
                const { avoid } = p.plan.query;
                // The way on screen is the one the trip keeps (with every variation of each ride), not whatever the planner prefers next time.
                const steps = p.plan.query.steps?.length ? p.plan.query.steps : it ? variantSteps(it, p.plan.itineraries) : undefined;
                openNewTrip({ name: p.name, from: p.from, to: p.to, arriveBy: p.plan.query.arriveBy.slice(11, 16), ...(p.days?.length ? { days: p.days } : {}), ...(avoid ? { avoid } : {}), ...waysFields(steps?.length ? [steps] : []) });
              }}
            />
          ) : (
            <Button label="Edit trip" kind="secondary" haptic="none" onPress={() => router.push({ pathname: '/trip/edit', params: { id } })} />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function Departure({ it, all, now }: { it: Itinerary; all: Itinerary[]; now: number }) {
  const bufferMin = settings.use().bufferMin;
  const leave = leaveAt(it, bufferMin);
  return (
    <Card style={styles.departure}>
      <Text variant="body14" color={color.textSecondary}>
        Leave at
      </Text>
      <Text variant="display" style={styles.bigTime}>
        {hhmm(leave)}
      </Text>
      <View style={styles.barWrap}>
        <LeaveByBar leaveAt={leave} arriveAt={Date.parse(it.arriveAt)} now={now} tone="card" />
      </View>
      <RouteSummary
        walkMin={firstWalkMin(it)}
        slots={slotsFor(it, all)}
        arrive={`Arrive ${hhmm(it.arriveAt)}`}
      />
    </Card>
  );
}

/** Journey timeline (Figma "Timeline leg"): one row per walk or ride, then the destination. */
function Timeline({ it, destination }: { it: Itinerary; destination: string }) {
  const legs = it.legs;
  const endsWithWalk = legs.at(-1)?.mode === 'WALK';
  const rows = endsWithWalk ? legs.slice(0, -1) : legs;
  const endWalk = lastWalkMin(it);
  return (
    <Card style={styles.timeline}>
      {rows.map((leg, i) => (
        <Fragment key={i}>
          {leg.mode === 'WALK' ? (
            <Leg time={hhmm(leg.departAt)} icon="walk-node" title={`Walk ${Math.max(1, Math.round(leg.durationSec / 60))} min`} sub={`To ${placeName(leg.to.name, 'the stop')}`} right={`${Math.max(1, Math.round(leg.durationSec / 60))} min`} />
          ) : (
            <Ride leg={leg} />
          )}
        </Fragment>
      ))}
      <Leg
        time={hhmm(it.arriveAt)}
        icon="pin-node"
        title={placeName(legs.at(-1)?.to.name, destination) || destination}
        sub={endWalk > 0 ? `Walk ${endWalk} min` : undefined}
        right={endWalk > 0 ? `${endWalk} min` : undefined}
        last
      />
    </Card>
  );
}

function Ride({ leg }: { leg: PlanLeg }) {
  const stops = leg.intermediateStops + 1;
  const min = Math.max(1, Math.round(leg.durationSec / 60));
  const toward = leg.headsign ?? placeName(leg.to.name, '');
  return (
    <Leg time={hhmm(leg.departAt)} icon={isMetro(leg) ? 'metro' : 'bus-node'} title={`${stops} ${stops === 1 ? 'stop' : 'stops'}`} right={`${min} min`}>
      <View style={styles.rideRow}>
        <RoutePlate label={leg.route?.shortName ?? leg.mode} kind={kindOf(leg)} size="lg" />
        {toward ? (
          <Text variant="caption" color={color.textSecondary} style={styles.flex} numberOfLines={2}>
            Toward {toward}
          </Text>
        ) : null}
      </View>
      <Text variant="caption" color={color.textSecondary} numberOfLines={1}>
        From {placeName(leg.from.name, 'the stop')}
      </Text>
    </Leg>
  );
}

function Leg({ time, icon, title, sub, right, last, children }: { time: string; icon: IconName; title: string; sub?: string; right?: string; last?: boolean; children?: React.ReactNode }) {
  return (
    <View style={styles.leg}>
      <Text variant="body15" color={color.textSecondary} style={styles.legTime}>
        {time}
      </Text>
      <View style={styles.rail}>
        {!last && <View style={styles.railLine} />}
        <View style={styles.node}>
          <Icon name={icon} size={18} color={color.onInk} />
        </View>
      </View>
      <View style={[styles.legText, !last && styles.legTextGap]}>
        <Text variant="label16" numberOfLines={2}>
          {title}
        </Text>
        {sub ? (
          <Text variant="caption" color={color.textSecondary} numberOfLines={2}>
            {sub}
          </Text>
        ) : null}
        {children}
      </View>
      {right ? (
        <Text variant="caption" color={color.textSecondary} style={styles.legRight}>
          {right}
        </Text>
      ) : null}
    </View>
  );
}

const NODE = 32;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  scroll: { paddingBottom: 32 },
  content: { paddingHorizontal: gutter, paddingTop: 16, gap: 12 },
  gap: { gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  departure: { padding: 16, gap: 8 },
  bigTime: { lineHeight: 72 },
  barWrap: { paddingTop: 10, paddingBottom: 10 },
  sectionLabel: { paddingHorizontal: 0, paddingTop: 4, paddingBottom: 0 },
  timeline: { padding: 16, paddingBottom: 0 },
  leg: { flexDirection: 'row', gap: 12 },
  legTime: { width: 48, height: NODE, lineHeight: NODE },
  rail: { width: NODE, alignItems: 'center' },
  railLine: { position: 'absolute', top: NODE / 2, bottom: 0, width: 2, backgroundColor: '#EBEBEC' },
  node: { width: NODE, height: NODE, borderRadius: NODE / 2, backgroundColor: color.ink, alignItems: 'center', justifyContent: 'center' },
  legText: { flex: 1, gap: 2, paddingTop: 5, paddingBottom: 16 },
  legTextGap: { paddingBottom: 24 },
  legRight: { paddingTop: 8 },
  rideRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  flex: { flex: 1 },
});

import type { ActionCard, Itinerary, LatLon, PlanAvoid, PlanResponse, PlanTripMeta, ProposedEvent, ProposedRoute, ProposedTrip } from '@transit/shared';
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useEffect, useState, type ReactNode } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { fetchPlan, hasApi, searchPlaces } from '../lib/api';
import { askAgain, markCard, replaceCard, say } from '../lib/chat';
import { locateMe } from '../lib/locate';
import { openNewTrip, openPreview, pickPlace } from '../lib/handoff';
import { choose, placeName } from '../lib/plans';
import { bestWay, cardKept, groupWays, isTicked, toggleWay, wayLabel, waysFields, type RideStep, type Way } from '../lib/ways';
import { settings, updateSettings } from '../lib/settings';
import { daysText, hhmm, nextArriveBy, relativeDay } from '../lib/time';
import { DEFAULT_DAYS, newTripId, saveTrip, withStops, type Place } from '../lib/trips';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { LineChain } from './LineChain';
import { RoutePlate } from './RoutePlate';
import { Sheet } from './Sheet';
import { StaticMap } from './StaticMap';
import { Tap, haptic } from './Tap';
import { Busy } from './Spinner';
import { Text } from './Text';
import { TickBox } from './Ways';
import { color, font, radius, shadow } from './theme';

// Action cards under an assistant reply (Figma "Chat / plan", "Chat /
// timetable"). Numbers come from TTC via the server, never from the model.

interface CardProps {
  card: ActionCard;
  itemId: string;
  index: number;
  done?: string;
  /** Puts text in the chat input (the "Edit" action). */
  onEdit: (prefill: string) => void;
}

export function ChatCard(props: CardProps) {
  const { card } = props;
  switch (card.type) {
    case 'plan':
      return <PlanCard {...props} plan={card.plan} meta={card.trip} />;
    case 'confirm_events':
      return <EventsCard {...props} events={card.events} />;
    case 'confirm_trip':
      return <TripCard {...props} trip={card.trip} />;
    case 'confirm_route':
      return <RouteCard {...props} route={card.route} />;
    case 'request_location':
      return <LocationCard {...props} />;
    case 'arrivals':
      return (
        <Shell title={card.stop.name} icon="bus">
          {card.arrivals.slice(0, 6).map((a, i) => (
            <View key={i} style={[styles.row, i > 0 && styles.rowBorder]}>
              <RoutePlate label={a.route} size="md" />
              <Text variant="body15" style={styles.flex} numberOfLines={1}>
                {a.headsign}
              </Text>
              <Text variant="label16">{a.minutes <= 0 ? 'Now' : `${a.minutes} min`}</Text>
            </View>
          ))}
          {!card.arrivals.length && (
            <Text variant="body15" color={color.textSecondary}>
              Nothing due soon.
            </Text>
          )}
        </Shell>
      );
    case 'stops':
      return (
        <Shell title="Stops" icon="pin">
          {card.stops.map((s, i) => (
            <View key={s.id} style={[styles.row, i > 0 && styles.rowBorder]}>
              <Icon name={s.mode === 'SUBWAY' ? 'metro' : 'bus'} size={16} />
              <Text variant="body15" style={styles.flex} numberOfLines={1}>
                {s.name}
              </Text>
            </View>
          ))}
        </Shell>
      );
  }
}

function Shell({ title, icon, tint, children, actions }: { title: string; icon: IconName; tint?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <View style={[styles.card, tint ? { backgroundColor: tint } : null]}>
      <View style={styles.title}>
        <Icon name={icon} size={24} />
        <Text variant="label16" style={[styles.flex, styles.bold]} numberOfLines={2}>
          {title}
        </Text>
      </View>
      <View style={styles.body}>{children}</View>
      {actions}
    </View>
  );
}

function Actions({ done, children }: { done?: string; children: ReactNode }) {
  if (done)
    return (
      <Animated.View entering={FadeIn.duration(200)} style={styles.done}>
        <Icon name="check" size={20} />
        <Text variant="label14">{done}</Text>
      </Animated.View>
    );
  return <View style={styles.actions}>{children}</View>;
}

/** Points near home are called "Home"; otherwise the stop or place name from TTC. */
function labelFor(p: LatLon, name: string | undefined, fallback: string): Place {
  const home = settings.get().home;
  if (home && Math.hypot((home.lat - p.lat) * 111_000, (home.lon - p.lon) * 83_000) < 150) return { ...p, label: 'Home' };
  return { ...p, label: placeName(name, fallback) };
}

function PlanCard({ plan, meta, itemId, index, done }: CardProps & { plan: PlanResponse; meta?: PlanTripMeta }) {
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Date | null>(null);
  const arriveBy = plan.query.arriveBy;
  const date = arriveBy.slice(0, 10);
  const bufferMin = settings.use().bufferMin;
  // The ways the trip will keep, ticked on the rows. Nothing ticked yet: the best way is ticked (defaultKept),
  // so Save always keeps a way and never saves a bare From/To that could later show any route.
  // A hand-built plan keeps its own rides (cardKept).
  const [kept, setKept] = useState<RideStep[][]>(() => cardKept({ plan }, Date.now(), bufferMin));
  // A plan for another time may find rows the first one didn't: tick the best of them when none is ticked.
  useEffect(() => {
    if (!kept.length) setKept(cardKept({ plan }, Date.now(), bufferMin));
  }, [plan]); // eslint-disable-line react-hooks/exhaustive-deps
  const first = plan.itineraries[0];
  const from = labelFor(plan.query.from, meta?.from ?? first?.legs[0]?.from.name, 'Start');
  const to = labelFor(plan.query.to, meta?.to ?? first?.legs.at(-1)?.to.name, 'Destination');
  const tripName = meta?.name ?? to.label;

  const replan = async (d: Date) => {
    setBusy(true);
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    try {
      // The quick part shows as soon as it is in; the full plan then replaces it (rows are keyed by way, so ticks stay).
      const show = (p: PlanResponse) => replaceCard(itemId, index, { type: 'plan', plan: p, ...(meta ? { trip: meta } : {}) });
      show(await fetchPlan({ ...plan.query, arriveBy: `${date}T${time}` }, { onPartial: show }));
    } catch {
      say("Couldn't plan for that time. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const otherTime = () => {
    const [h, m] = arriveBy.slice(11, 16).split(':').map(Number);
    const value = new Date();
    value.setHours(h, m, 0, 0);
    // Android: native dialog. iOS: spinner in a sheet (picked below).
    if (Platform.OS === 'android')
      DateTimePickerAndroid.open({ value, mode: 'time', is24Hour: true, onChange: (e: DateTimePickerEvent, d?: Date) => e.type === 'set' && d && replan(d) });
    else setPicked(value);
  };

  return (
    <Shell
      title={`${relativeDay(date)}, arrive by ${arriveBy.slice(11, 16)}${meta?.days?.length ? ` · ${daysText(meta.days)}` : ''}`}
      icon="clock"
      tint={color.sky}
      actions={
        <Actions done={done}>
          <Button label={busy ? 'Planning…' : 'Other time'} kind="secondary" onPress={otherTime} disabled={busy} style={styles.flex} haptic="none" />
          <Button
            label="Save"
            style={styles.flex}
            disabled={!kept.length}
            onPress={() => {
              markCard(itemId, index, 'Opened in New trip');
              const { avoid } = plan.query;
              // Exactly the ticked ways, as every other screen saves them (waysFields).
              openNewTrip({ name: tripName, from, to, arriveBy: arriveBy.slice(11, 16), ...(meta?.days?.length ? { days: meta.days } : {}), ...(avoid ? { avoid } : {}), ...waysFields(kept) });
            }}
          />
        </Actions>
      }
    >
      <KeptMap plan={plan} kept={kept} fadeTo={color.sky} />
      <WayRows
        its={plan.itineraries}
        arriveBy={arriveBy}
        kept={kept}
        onKeep={setKept}
        onOpen={(it) => openPreview({ plan, itineraryId: it.id, name: tripName, from, to, ...(meta?.days?.length ? { days: meta.days } : {}) })}
      />
      {!plan.itineraries.length && (
        <Text variant="body15" color={color.textSecondary}>
          No route found for that time.
        </Text>
      )}
      {Platform.OS === 'ios' && (
        <Sheet visible={picked !== null} onClose={() => setPicked(null)}>
          {picked && (
            <DateTimePicker
              value={picked}
              mode="time"
              display="spinner"
              is24Hour
              themeVariant="light"
              onChange={(_e: DateTimePickerEvent, d?: Date) => d && setPicked(d)}
            />
          )}
          <Button
            label="Plan for this time"
            onPress={() => {
              const d = picked;
              setPicked(null);
              if (d) replan(d);
            }}
          />
        </Sheet>
      )}
    </Shell>
  );
}

/** Rows shown on a chat card; the assistant numbers the ways in the same order ("way 1", "way 2"). */
const MAX_WAY_ROWS = 6;

/**
 * The ways of a plan as tick rows: the same grouping, ticks and labels as the
 * trip screens and the assistant (groupWays, isTicked, toggleWay, wayLabel). The
 * box ticks a way; the rest of the row opens its best option, or ticks when
 * there is nothing to open.
 */
function WayRows({ its, arriveBy, kept, onKeep, onOpen }: { its: Itinerary[]; arriveBy: string; kept: RideStep[][]; onKeep: (ways: RideStep[][]) => void; onOpen?: (it: Itinerary) => void }) {
  const bufferMin = settings.use().bufferMin;
  const now = Date.now();
  // Grouped without the buffer, as the server does, so the rows are in the order the assistant numbered them.
  const ways = groupWays(its).slice(0, MAX_WAY_ROWS);
  const best = bestWay(ways, arriveBy, now, bufferMin);
  return (
    <>
      {ways.map((w, i) => {
        const c = choose(w.its, arriveBy, now, bufferMin);
        const it = c.kind === 'none' ? w.its[0] : c.it;
        const tick = () => {
          haptic('selection');
          onKeep(toggleWay(kept, w, its));
        };
        return <PlanRow key={w.key} way={w} it={it} best={w === best} ticked={isTicked(w, kept)} border={i < ways.length - 1} onTick={tick} onPress={onOpen ? () => onOpen(it) : tick} />;
      })}
    </>
  );
}

function PlanRow({ way, it, best, ticked, border, onTick, onPress }: { way: Way; it: Itinerary; best: boolean; ticked: boolean; border: boolean; onTick: () => void; onPress: () => void }) {
  return (
    <View style={[styles.planRow, border && styles.rowBorder]}>
      <Tap onPress={onTick} hitSlop={10} scaleTo={0.9} accessibilityRole="checkbox" accessibilityState={{ checked: ticked }} accessibilityLabel={`Keep ${wayLabel(way.slots)}`}>
        <TickBox on={ticked} />
      </Tap>
      <Tap onPress={onPress} scaleTo={0.98} style={styles.planRowMain} accessibilityRole="button">
        <View style={styles.planTime}>
          <Text variant="title26" color={best ? color.text : color.textSecondary}>
            {hhmm(it.departAt)}
          </Text>
          <Text variant="caption" color={color.textSecondary}>
            {Math.round(it.durationSec / 60)} min
          </Text>
        </View>
        <View style={styles.plates}>
          <LineChain slots={way.slots} size="xs" />
        </View>
      </Tap>
    </View>
  );
}

/**
 * The ways of a proposed trip and the ones ticked: from the card (the server
 * planned it and ticked the named or the best way), or, from an older server,
 * planned here with the best way ticked. A hand-built route keeps its rides.
 */
function useProposalWays(trip: ProposedTrip & { avoid?: PlanAvoid; steps?: RideStep[] }) {
  const days = trip.days?.length ? trip.days : DEFAULT_DAYS;
  const bufferMin = settings.use().bufferMin;
  const [plan, setPlan] = useState<PlanResponse | null>(trip.plan ?? null);
  const [kept, setKept] = useState<RideStep[][]>(() => cardKept(trip, Date.now(), bufferMin));
  // True while only the quick part is listed and the full plan is still coming.
  const [more, setMore] = useState(false);
  useEffect(() => {
    if (plan || !hasApi) return;
    let live = true;
    // The quick part lists the ways at once, unticked; the best way is ticked when the full plan is in.
    fetchPlan({ from: trip.from, to: trip.to, arriveBy: nextArriveBy(trip.arriveBy, days), ...(trip.avoid ? { avoid: trip.avoid } : {}), ...(trip.steps?.length ? { steps: trip.steps } : {}) }, {
      onPartial: (p) => {
        if (!live) return;
        setPlan(p);
        setMore(true);
      },
    })
      .then((p) => {
        if (!live) return;
        setPlan(p);
        setMore(false);
        setKept((k) => (k.length ? k : cardKept({ plan: p }, Date.now(), bufferMin)));
      })
      .catch(() => live && setMore(false));
    return () => {
      live = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { plan, more, kept, setKept, days };
}

/** The ticked ways on a small map (their soonest option each), so the rider sees where the route goes before saving it. */
function KeptMap({ plan, kept, fadeTo }: { plan: PlanResponse; kept: RideStep[][]; fadeTo: string }) {
  const drawn = groupWays(plan.itineraries)
    .filter((w) => isTicked(w, kept))
    .map((w) => w.its[0]);
  if (!drawn.length) return null;
  return (
    <View style={styles.map}>
      <StaticMap itinerary={drawn[0]} also={drawn.slice(1)} endpoints={{ from: plan.query.from, to: plan.query.to }} height={140} fadeTo={fadeTo} />
    </View>
  );
}

/** The ways of a proposal with their ticks, or a line while they are planned. */
function ProposedWays({ plan, more, kept, onKeep }: { plan: PlanResponse | null; more: boolean; kept: RideStep[][]; onKeep: (ways: RideStep[][]) => void }) {
  if (!plan) return hasApi ? <Busy label="Finding the ways…" /> : null;
  if (!plan.itineraries.length) return null;
  return (
    <View style={styles.rowBorderTop}>
      <Text variant="caption" color={color.textSecondary} style={styles.waysHint}>
        Tick the ways you take
      </Text>
      <KeptMap plan={plan} kept={kept} fadeTo={color.surface} />
      <WayRows its={plan.itineraries} arriveBy={plan.query.arriveBy} kept={kept} onKeep={onKeep} />
      {more && <Busy label="Checking every line…" />}
    </View>
  );
}

function EventsCard({ events, itemId, index, done, onEdit }: CardProps & { events: ProposedEvent[] }) {
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      let home = settings.get().home;
      if (!home) {
        say('Where do you start from? Set your home first.');
        home = await pickPlace('home');
        if (!home) return;
        updateSettings({ home });
      }
      const start = { ...home, label: 'Home' };
      const unresolved: ProposedEvent[] = [];
      let saved = 0;
      for (const e of events) {
        const hit = e.place ? (await searchPlaces(e.place, 'en', 1).catch(() => []))[0] : undefined;
        if (!hit) {
          unresolved.push(e);
          continue;
        }
        // Keeps the best way of its plan, like every trip saved from chat.
        const trip = await withStops({ id: newTripId(), name: e.title, from: start, to: { lat: hit.lat, lon: hit.lon, label: hit.name }, arriveBy: e.start, days: e.days.length ? e.days : DEFAULT_DAYS }, { keepBest: true });
        saveTrip(trip);
        saved++;
      }
      haptic('success');
      markCard(itemId, index, saved ? `${saved} ${saved === 1 ? 'trip' : 'trips'} added to your week` : 'Nothing added yet');
      if (unresolved.length) {
        say(`Where is ${unresolved.map((e) => e.title).join(', ')}? Pick the place to add ${unresolved.length === 1 ? 'it' : 'them'}.`);
        const e = unresolved[0];
        openNewTrip({ name: e.title, from: start, arriveBy: e.start, days: e.days.length ? e.days : DEFAULT_DAYS });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      title={`${events.length} ${events.length === 1 ? 'event' : 'events'} from your schedule`}
      icon="clock"
      actions={
        <Actions done={done}>
          <Button label="Edit" kind="secondary" style={styles.flex} haptic="none" onPress={() => onEdit('Change ')} />
          <Button label={busy ? 'Adding…' : 'Confirm'} style={styles.flex} disabled={busy} onPress={confirm} />
        </Actions>
      }
    >
      {events.map((e, i) => (
        <View key={i} style={[styles.eventRow, i < events.length - 1 && styles.rowBorder]}>
          <View style={styles.when}>
            <Text variant="captionStrong">{e.start}</Text>
            <Text variant="caption" color={color.textSecondary}>
              {daysText(e.days)}
            </Text>
          </View>
          <View style={styles.flex}>
            <Text variant="body15" numberOfLines={1}>
              {e.title}
            </Text>
            <View style={styles.placeRow}>
              <Icon name="pin" size={20} color={e.place ? color.textSecondary : color.ink} />
              <Text variant="caption" color={e.place ? color.textSecondary : color.text} numberOfLines={1} style={styles.flex}>
                {e.place ?? 'Location to be confirmed'}
              </Text>
            </View>
          </View>
        </View>
      ))}
    </Shell>
  );
}

/** The assistant needs to know where you are: one tap asks the phone, then the question is asked again with the position. */
function LocationCard({ itemId, index, done }: CardProps) {
  const [busy, setBusy] = useState(false);
  const [off, setOff] = useState(false);
  return (
    <Shell
      title="Where are you?"
      icon="pin"
      actions={
        <Actions done={done}>
          {off && <Button label="Open settings" kind="secondary" style={styles.flex} haptic="none" onPress={() => Linking.openSettings().catch(() => {})} />}
          <Button
            label={busy ? 'Finding you…' : off ? 'Try again' : 'Share my location'}
            style={styles.flex}
            disabled={busy}
            onPress={async () => {
              setBusy(true);
              const here = await locateMe();
              setBusy(false);
              if (typeof here === 'object') {
                haptic('success');
                markCard(itemId, index, 'Location shared');
                askAgain();
              } else if (here === 'denied') setOff(true);
            }}
          />
        </Actions>
      }
    >
      <Text variant="body15" color={color.textSecondary}>
        Used once to answer this question. Nothing is tracked.
      </Text>
      {off && (
        <Text variant="body15" color={color.textSecondary}>
          Location is off for the app. Allow it in the phone's settings.
        </Text>
      )}
    </Shell>
  );
}

function TripCard({ trip, itemId, index, done }: CardProps & { trip: ProposedTrip }) {
  const [busy, setBusy] = useState(false);
  const { plan, more, kept, setKept, days } = useProposalWays(trip);
  const draft = { name: trip.name, from: trip.from, to: trip.to, arriveBy: trip.arriveBy, days };
  return (
    <Shell
      title={trip.name}
      icon="pin"
      actions={
        <Actions done={done}>
          <Button label="Edit" kind="secondary" style={styles.flex} haptic="none" onPress={() => openNewTrip({ ...draft, ...waysFields(kept) })} />
          <Button
            label={busy ? 'Saving…' : 'Save'}
            style={styles.flex}
            disabled={busy}
            onPress={async () => {
              setBusy(true);
              // The ticked ways; when none could be planned yet, the best way of the plan made while saving.
              saveTrip(await withStops({ id: newTripId(), ...draft, ...(kept.length ? waysFields(kept) : {}) }, { keepBest: true }));
              setBusy(false);
              haptic('success');
              markCard(itemId, index, 'Added to your week');
            }}
          />
        </Actions>
      }
    >
      <View style={styles.row}>
        <Text variant="caption" color={color.textSecondary} style={styles.tripLabel}>
          From
        </Text>
        <Text variant="body15" style={styles.flex} numberOfLines={1}>
          {trip.from.label}
        </Text>
      </View>
      <View style={[styles.row, styles.rowBorderTop]}>
        <Text variant="caption" color={color.textSecondary} style={styles.tripLabel}>
          To
        </Text>
        <Text variant="body15" style={styles.flex} numberOfLines={1}>
          {trip.to.label}
        </Text>
      </View>
      <View style={[styles.row, styles.rowBorderTop]}>
        <Text variant="caption" color={color.textSecondary} style={styles.tripLabel}>
          Arrive by
        </Text>
        <Text variant="label16">{trip.arriveBy}</Text>
        <Text variant="caption" color={color.textSecondary}>
          {daysText(draft.days)}
        </Text>
      </View>
      <ProposedWays plan={plan} more={more} kept={kept} onKeep={setKept} />
    </Shell>
  );
}

const avoidText = (a: PlanAvoid) => [...(a.routes ?? []), ...(a.minibus ? ['minibuses'] : [])].join(', ');

/** A trip with an avoid list or a hand-built route. Opens New trip prefilled; the user checks it there and saves. */
function RouteCard({ route, itemId, index, done, onEdit }: CardProps & { route: ProposedRoute }) {
  const { plan, more, kept, setKept, days } = useProposalWays(route);
  const open = () => {
    markCard(itemId, index, 'Opened in New trip');
    openNewTrip({
      name: route.name,
      from: route.from,
      to: route.to,
      arriveBy: route.arriveBy,
      days,
      ...(route.avoid ? { avoid: route.avoid } : {}),
      // The ticked ways (a hand-built route is its own way); the New trip form keeps them.
      ...waysFields(kept),
    });
  };
  const rows: Array<[string, ReactNode]> = [
    ['From', route.from.label],
    ['To', route.to.label],
    ['Arrive by', `${route.arriveBy}  ${daysText(days)}`],
    ...(route.avoid ? [['Never', avoidText(route.avoid)] as [string, ReactNode]] : []),
  ];
  return (
    <Shell
      title={route.name}
      icon="pin"
      actions={
        <Actions done={done}>
          <Button label="Edit" kind="secondary" style={styles.flex} haptic="none" onPress={() => onEdit('Change ')} />
          <Button label="Review" style={styles.flex} onPress={open} />
        </Actions>
      }
    >
      {rows.map(([label, value], i) => (
        <View key={label} style={[styles.row, i > 0 && styles.rowBorderTop]}>
          <Text variant="caption" color={color.textSecondary} style={styles.tripLabel}>
            {label}
          </Text>
          <Text variant="body15" style={styles.flex} numberOfLines={2}>
            {value}
          </Text>
        </View>
      ))}
      {route.rides?.map((r, i) => (
        <View key={`ride${i}`} style={[styles.row, styles.rowBorderTop]}>
          <View style={styles.ridePlates}>
            {r.routes.length ? r.routes.slice(0, 2).map((n) => <RoutePlate key={n} label={n} size="md" />) : <Icon name="bus" size={16} />}
          </View>
          <Text variant="body15" style={styles.flex} numberOfLines={2}>
            {`${r.from} → ${r.to}${r.routes.length > 2 ? ` (also ${r.routes.slice(2).join(', ')})` : ''}`}
          </Text>
        </View>
      ))}
      {/* A hand-built route is the way itself; with an avoid list only, the ways to tick. */}
      {!route.steps?.length && <ProposedWays plan={plan} more={more} kept={kept} onKeep={setKept} />}
    </Shell>
  );
}

const styles = StyleSheet.create({
  map: { borderRadius: radius.md, overflow: 'hidden', marginBottom: 12 },
  card: { backgroundColor: color.surface, borderRadius: radius.lg, paddingVertical: 18, paddingHorizontal: 14, ...shadow.card },
  title: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bold: { fontFamily: font.bold },
  body: { marginTop: 8 },
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth * 2, borderBottomColor: 'rgba(28,26,26,0.08)' },
  rowBorderTop: { borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: 'rgba(28,26,26,0.08)' },
  planRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  planRowMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
  waysHint: { paddingTop: 12 },
  planTime: { width: 88 },
  // minWidth 0 lets the plates shrink instead of running over the minutes.
  plates: { flex: 1, minWidth: 0, flexDirection: 'row', gap: 4 },
  eventRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 12 },
  when: { width: 76, paddingTop: 3 },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: -2 },
  tripLabel: { width: 64 },
  ridePlates: { width: 64, flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 16 },
  done: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16, height: 52, justifyContent: 'center', borderRadius: radius.md, backgroundColor: 'rgba(28,26,26,0.05)' },
});

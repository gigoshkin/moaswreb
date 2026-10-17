import { FlashList } from '@shopify/flash-list';
import type { Itinerary } from '@transit/shared';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ItineraryCard } from '../components/ItineraryCard';
import { LeaveByBar } from '../components/LeaveByBar';
import { RoutePlate } from '../components/RoutePlate';
import { Text } from '../components/Text';
import { t } from '../lib/strings';
import { useColors } from '../theme/theme';
import { space } from '../theme/tokens';
import { samplePlan } from './samplePlan';

/** Clock that runs 30x fast so the kit shows the bar and card states moving. */
const useDemoClock = (speed = 30) => {
  const [start] = useState(Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    const id = setInterval(() => setNow(start + (Date.now() - start) * speed), 500);
    return () => clearInterval(id);
  }, [start, speed]);
  return { start, now };
};

/**
 * Component kit preview (design direction §8 step 2): every token and core
 * component on one screen, light theme. Not a product
 * screen; andro designs those.
 */
export function KitScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { start, now } = useDemoClock();
  const plan = useMemo(() => samplePlan(start), [start]);
  const best = plan.itineraries[0];

  // Placeholder window: ±2.5 min around the planned departure. The real
  // window comes from the learning model (05-build-plan §8).
  const depart = Date.parse(best.departAt);
  const windowStart = depart - 150_000;
  const windowEnd = depart + 150_000;
  const leaveIn = Math.max(0, Math.round((windowStart - now) / 60_000));

  const header = (
    <View style={{ gap: space.xxl, paddingBottom: space.xxl }}>
      <View style={{ gap: space.md }}>
        <Text variant="caption" color="textMuted">
          კომპონენტები · სანიმუშო მონაცემები
        </Text>
        <Text variant="hero" tabular style={{ fontSize: 48, lineHeight: 60 }}>
          {leaveIn > 0 ? t.leaveIn(leaveIn) : t.leaveNow}
        </Text>
        <LeaveByBar windowStart={windowStart} windowEnd={windowEnd} now={now} />
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center', flexWrap: 'wrap' }}>
        <RoutePlate route={{ shortName: '306', longName: null, color: '#E02B2B' }} mode="BUS" size="lg" />
        <RoutePlate route={{ shortName: 'M1', longName: null, color: null }} mode="SUBWAY" size="lg" />
        <RoutePlate route={{ shortName: '558', longName: null, color: '#FBC02D' }} mode="BUS" />
        <RoutePlate route={{ shortName: '61', longName: null, color: '#43A047' }} mode="BUS" size="sm" />
      </View>
      <Text variant="title">{t.options}</Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <FlashList<Itinerary>
        data={plan.itineraries}
        keyExtractor={(it) => it.id}
        ListHeaderComponent={header}
        ItemSeparatorComponent={() => <View style={{ height: space.md }} />}
        contentContainerStyle={{ paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.xl, paddingHorizontal: space.lg }}
        renderItem={({ item }) => {
          const minsToGo = (Date.parse(item.departAt) - now) / 60_000;
          return <ItineraryCard itinerary={item} urgent={minsToGo > 0 && minsToGo <= 5} onPress={() => {}} />;
        }}
        extraData={now}
      />
    </View>
  );
}

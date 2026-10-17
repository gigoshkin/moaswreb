import { FlashList } from '@shopify/flash-list';
import type { Itinerary, PlanQuery } from '@transit/shared';
import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ItineraryCard } from '../../components/ItineraryCard';
import { Text } from '../../components/Text';
import { t } from '../../lib/strings';
import { nextArriveBy } from '../../lib/time';
import { getTrip } from '../../lib/trips';
import { usePlan } from '../../lib/usePlan';
import { space } from '../../theme/tokens';

/**
 * PLACEHOLDER screen: trip options from /plan as a plain list, cache first.
 * The real Today / Trip detail design comes from andro's Figma.
 */
export default function TripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const trip = getTrip(id);
  const insets = useSafeAreaInsets();

  const query = useMemo<PlanQuery | null>(
    () => (trip ? { from: trip.from, to: trip.to, arriveBy: nextArriveBy(trip.arriveBy), locale: 'ka' } : null),
    [trip?.id],
  );
  if (!trip || !query) return null;
  return <Options title={trip.name} query={query} topInset={insets.top} />;
}

function Options({ title, query, topInset }: { title: string; query: PlanQuery; topInset: number }) {
  const { plan, refreshing, error, sample, refresh } = usePlan(query);
  const notice = sample ? t.sample : error ? t.offline : null;

  return (
    <FlashList<Itinerary>
      data={plan?.itineraries ?? []}
      keyExtractor={(it) => it.id}
      onRefresh={refresh}
      refreshing={refreshing}
      contentContainerStyle={{ paddingTop: topInset + space.xl, paddingHorizontal: space.lg, paddingBottom: space.xl }}
      ItemSeparatorComponent={() => <View style={{ height: space.md }} />}
      ListHeaderComponent={
        <View style={{ gap: space.xs, paddingBottom: space.xl }}>
          <Text variant="title">{title}</Text>
          <Text variant="caption" color="textMuted" tabular>
            {t.arriveBy(query.arriveBy.slice(11))}
          </Text>
          {notice && (
            <Text variant="caption" color="late">
              {notice}
            </Text>
          )}
        </View>
      }
      ListEmptyComponent={
        plan && !refreshing ? (
          <Text variant="body" color="textMuted">
            {t.noOptions}
          </Text>
        ) : null
      }
      renderItem={({ item }) => <ItineraryCard itinerary={item} />}
    />
  );
}

import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card } from '../components/Card';
import { Text } from '../components/Text';
import { t } from '../lib/strings';
import { listTrips } from '../lib/trips';
import { space } from '../theme/tokens';

/**
 * PLACEHOLDER screen: saved trips as a plain list. Layout and flow come from
 * andro's Figma; this only proves the data path (trips → /plan).
 */
export default function TripsScreen() {
  const insets = useSafeAreaInsets();
  const [trips] = useState(listTrips);
  return (
    <ScrollView contentContainerStyle={{ paddingTop: insets.top + space.xl, paddingHorizontal: space.lg, gap: space.md }}>
      <Text variant="title">{t.myTrips}</Text>
      {trips.map((trip) => (
        <Card key={trip.id} onPress={() => router.push({ pathname: '/trip/[id]', params: { id: trip.id } })}>
          <View style={{ gap: space.xs }}>
            <Text variant="label" weight="semibold">
              {trip.name}
            </Text>
            <Text variant="caption" color="textMuted" tabular>
              {t.arriveBy(trip.arriveBy)}
            </Text>
          </View>
        </Card>
      ))}
      {__DEV__ && (
        <Card onPress={() => router.push('/kit')}>
          <Text variant="caption" color="textMuted">
            Component kit (dev)
          </Text>
        </Card>
      )}
    </ScrollView>
  );
}

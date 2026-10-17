import type { Itinerary } from '@transit/shared';
import { Fragment } from 'react';
import { View } from 'react-native';
import { t } from '../lib/strings';
import { hhmm, minutes } from '../lib/time';
import { useColors } from '../theme/theme';
import { space } from '../theme/tokens';
import { Card } from './Card';
import { RoutePlate } from './RoutePlate';
import { Text } from './Text';

interface Props {
  itinerary: Itinerary;
  urgent?: boolean;
  onPress?: () => void;
}

/** One option: plates in ride order, then leave/arrive times. */
export function ItineraryCard({ itinerary, urgent = false, onPress }: Props) {
  const c = useColors();
  const ink = urgent ? c.onAccent : undefined;
  const rides = itinerary.legs.filter((l) => l.route);
  return (
    <Card urgent={urgent} onPress={onPress}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
        {rides.map((leg, i) => (
          <Fragment key={`${leg.departAt}-${i}`}>
            {i > 0 && (
              <Text variant="label" color={ink ?? 'textFaint'}>
                ›
              </Text>
            )}
            <RoutePlate route={leg.route!} mode={leg.mode} />
          </Fragment>
        ))}
        <View style={{ flex: 1 }} />
        <Text variant="title" color={ink ?? 'text'} tabular>
          {t.min(minutes(itinerary.durationSec))}
        </Text>
      </View>
      <Text variant="label" color={ink ?? 'textMuted'} tabular style={{ marginTop: space.md }}>
        {`${hhmm(itinerary.departAt)} → ${hhmm(itinerary.arriveAt)} · ${t.walk(minutes(itinerary.walkSec))}`}
      </Text>
    </Card>
  );
}

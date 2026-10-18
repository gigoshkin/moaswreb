import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Countdown } from './Countdown';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { color, radius, shadow } from './theme';

export interface Slide {
  title: string;
  body: string;
  art: ReactNode;
}

const styles = StyleSheet.create({
  card: { padding: 24, gap: 20 },
  bar: { height: 8, borderRadius: 4, backgroundColor: color.track, overflow: 'hidden' },
  barFill: { width: '60%', height: 8, borderRadius: 4, backgroundColor: color.ink },
  modes: { flexDirection: 'row', gap: 8 },
  mode: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  chat: { gap: 10 },
  userBubble: { alignSelf: 'flex-end', maxWidth: 272, backgroundColor: color.ink, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, borderBottomRightRadius: 6 },
  replyBubble: { alignSelf: 'flex-start', maxWidth: 272 },
  chip: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: color.surface, borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 8, ...shadow.card },
  notif: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: color.surface, borderRadius: radius.md, padding: 14, ...shadow.card },
  notifIcon: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: color.ink, alignItems: 'center', justifyContent: 'center' },
});

function Dot({ icon, bg }: { icon: IconName; bg: string }) {
  return (
    <View style={[styles.mode, { backgroundColor: bg }]}>
      <Icon name={icon} size={16} color={color.onInk} />
    </View>
  );
}

// The Today hero, shrunk: sky card, countdown, progress bar, line types.
const leaveArt = (
  <View style={[styles.card, { backgroundColor: color.hero }, shadow.soft]} accessible accessibilityLabel="Example: leave in 12 minutes">
    <Countdown prefix="Leave in" value="12" suffix="min" />
    <View style={styles.bar}>
      <View style={styles.barFill} />
    </View>
    <View style={styles.modes}>
      <Dot icon="bus" bg={color.bus} />
      <Dot icon="bus" bg={color.minibus} />
      <Dot icon="metro" bg={color.metro} />
    </View>
  </View>
);

const liveArt = (
  <View style={styles.chat} accessible accessibilityLabel="Example chat: When should I leave for work tomorrow? Leave at 08:12. The 337 is 2 minutes late today.">
    <View style={styles.userBubble}>
      <Text variant="body15" color={color.onInk}>
        When should I leave for work tomorrow?
      </Text>
    </View>
    <View style={styles.replyBubble}>
      <Text variant="body15">Leave at 08:12. The 337 is 2 min late today.</Text>
    </View>
    <View style={styles.chip}>
      <Icon name="notice" size={16} color={color.ink} />
      <Text variant="label13">Delay on line 337</Text>
    </View>
  </View>
);

const alertArt = (
  <View style={styles.notif} accessible accessibilityLabel="Example notification: Leave now. Work, 08:12">
    <View style={styles.notifIcon}>
      <Icon name="bus-deco" size={22} color={color.onInk} />
    </View>
    <View style={{ flex: 1 }}>
      <Text variant="label14">Leave now</Text>
      <Text variant="caption" color={color.textSecondary}>
        Work · 08:12
      </Text>
    </View>
  </View>
);

export const SLIDES: Slide[] = [
  {
    title: 'Know exactly when to leave.',
    body: 'Tell us where you go and when you need to be there. We count down to the minute you should walk out the door.',
    art: leaveArt,
  },
  {
    title: 'Built on live Tbilisi data.',
    body: 'We check every bus, minibus and metro line, watch real arrival times, and tell you when a delay or a faster option appears. Or just ask the assistant, in text, a photo or a PDF.',
    art: liveArt,
  },
  {
    title: "A nudge when it's time.",
    body: 'Get a notification when it’s time to leave, and if your bus runs late. Your location and photos are only asked for when you use them, and your data stays on your phone.',
    art: alertArt,
  },
];

import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../ui/Text';
import { Card, TopBar } from '../ui/kit';
import { color, gutter } from '../ui/theme';

// Plain-language summary of knowledge-base/data-and-privacy.md. Update both together.
const SECTIONS: [string, string][] = [
  ['No account', 'There is no sign-up. The app makes a random id on your phone; our server keeps only a hash of it.'],
  ['On your phone', 'Trip names, addresses, your home and the chat stay on your phone. Your location is used on the phone only and never sent.'],
  [
    'On our server',
    'For alerts, each trip is stored as its first and last stop, the arrive-by time, the days and the walk minutes, plus the push token. All of it is encrypted, and it is deleted after 30 days without use.',
  ],
  ['Chat', 'Messages, photos and PDFs you send in Chat go to Anthropic’s Claude API to be read, with your saved trips as context. We don’t store them.'],
  ['Alerts', 'Pushes go through Expo and Google Firebase, which see the push token and the alert text.'],
  ['Delete', 'Settings → Delete my data removes everything from your phone and our server at once.'],
];

export default function Privacy() {
  return (
    <View style={styles.screen}>
      <TopBar title="Privacy" />
      <ScrollView contentContainerStyle={styles.content}>
        {SECTIONS.map(([title, body]) => (
          <Card key={title} style={styles.card}>
            <Text variant="label16">{title}</Text>
            <Text variant="body15" color={color.textSecondary}>
              {body}
            </Text>
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { padding: gutter, gap: 12 },
  card: { gap: 6 },
});

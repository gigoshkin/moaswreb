import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { BUFFER_OPTIONS, bufferText, settings, updateSettings } from '../lib/settings';
import { syncNow } from '../lib/trips';
import { Icon } from '../ui/Icon';
import { Text } from '../ui/Text';
import { Group, GroupRow, TopBar } from '../ui/kit';
import { color, gutter } from '../ui/theme';

/** Buffer time: extra minutes before the leave time, on top of the walk. */
export default function Buffer() {
  const current = settings.use().bufferMin;
  return (
    <View style={styles.screen}>
      <TopBar title="Buffer time" close />
      <View style={styles.content}>
        <Text variant="body14" color={color.textSecondary} style={styles.intro}>
          Extra minutes to leave earlier than you need to.
        </Text>
        <Group>
          {BUFFER_OPTIONS.map((m, i) => (
            <GroupRow
              key={m}
              label={bufferText(m)}
              last={i === BUFFER_OPTIONS.length - 1}
              right={m === current ? <Icon name="check" size={22} /> : <View />}
              onPress={() => {
                updateSettings({ bufferMin: m });
                syncNow();
                router.back();
              }}
            />
          ))}
        </Group>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { padding: gutter, gap: 12 },
  intro: { paddingHorizontal: 4 },
});

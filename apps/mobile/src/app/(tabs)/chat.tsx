import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { useRef, useState } from 'react';
import { Alert, FlatList, Image, StyleSheet, TextInput, View, type TextInputInstance } from 'react-native';
import Animated, { FadeIn, FadeInDown, LayoutAnimationConfig, LinearTransition, useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { chatBusy, chatStore, send, type Attachment, type ChatItem } from '../../lib/chat';
import { ChatCard } from '../../ui/ChatCards';
import { Icon } from '../../ui/Icon';
import { TAB_BAR_HEIGHT } from '../../ui/TabBar';
import { Tap } from '../../ui/Tap';
import { Text } from '../../ui/Text';
import { ScreenTitle } from '../../ui/kit';
import { color, font, gutter, radius, shadow, spring } from '../../ui/theme';

const SUGGESTIONS = ['When should I leave for university tomorrow?', 'What comes next at my stop?', 'Paste a TTC notice to check my trips'];

const enter = FadeInDown.springify().damping(spring.smooth.damping).stiffness(spring.smooth.stiffness);

export default function Chat() {
  const insets = useSafeAreaInsets();
  const items = chatStore.use();
  const busy = chatBusy.use();
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const input = useRef<TextInputInstance>(null);

  // The input rides on top of the keyboard, frame by frame. The tab bar sits
  // under the keyboard, so only the part above it is added.
  const keyboard = useAnimatedKeyboard();
  const tabBar = TAB_BAR_HEIGHT + insets.bottom;
  const lift = useAnimatedStyle(() => ({ paddingBottom: Math.max(keyboard.height.value - tabBar, 0) }));

  const canSend = !busy && (text.trim().length > 0 || attachment !== null);
  const submit = () => {
    if (!canSend) return;
    send(text.trim(), attachment ?? undefined);
    setText('');
    setAttachment(null);
  };

  const attach = () =>
    Alert.alert('Add your schedule', undefined, [
      { text: 'Take a photo', onPress: () => photo(true) },
      { text: 'Choose a photo', onPress: () => photo(false) },
      { text: 'PDF', onPress: pdf },
    ]);

  const photo = async (camera: boolean) => {
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : { granted: true };
    if (!perm.granted) return;
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6, base64: true };
    const res = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    const a = res.assets?.[0];
    if (res.canceled || !a?.base64) return;
    setAttachment({ kind: 'image', mediaType: a.mimeType ?? 'image/jpeg', data: a.base64, uri: a.uri });
  };

  const pdf = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
    const a = res.assets?.[0];
    if (res.canceled || !a) return;
    const data = await new File(a.uri).base64();
    setAttachment({ kind: 'pdf', mediaType: 'application/pdf', data, name: a.name });
  };

  const data = [...items].reverse();

  return (
    <View style={styles.screen}>
      <ScreenTitle title="Chat" bar />
      <Animated.View style={[styles.flex, lift]}>
        {data.length === 0 ? (
          <View style={styles.empty}>
            <Text variant="body16" color={color.textSecondary} style={styles.emptyText}>
              Ask about a trip, send a photo of your timetable, or paste a notice.
            </Text>
            {SUGGESTIONS.map((s) => (
              <Tap key={s} onPress={() => (s.startsWith('Paste') ? input.current?.focus() : send(s))} style={styles.suggestion} scaleTo={0.97}>
                <Text variant="body15">{s}</Text>
              </Tap>
            ))}
          </View>
        ) : (
          <LayoutAnimationConfig skipEntering>
            <FlatList
              data={data}
              inverted
              keyExtractor={(m) => m.id}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              contentContainerStyle={styles.list}
              showsVerticalScrollIndicator={false}
              ListHeaderComponent={busy ? <Thinking /> : undefined}
              renderItem={({ item }) => <Message item={item} onEdit={(t) => (setText(t), input.current?.focus())} />}
            />
          </LayoutAnimationConfig>
        )}

        <View style={styles.inputArea}>
          {attachment && (
            <Animated.View entering={FadeIn.duration(150)} style={styles.attachment}>
              {attachment.uri ? <Image source={{ uri: attachment.uri }} style={styles.thumb} /> : <Icon name="file" size={24} />}
              <Text variant="body13" numberOfLines={1} style={styles.flex}>
                {attachment.kind === 'pdf' ? (attachment.name ?? 'PDF') : 'Photo'}
              </Text>
              <Tap onPress={() => setAttachment(null)} hitSlop={10} scaleTo={0.9} accessibilityLabel="Remove attachment">
                <Icon name="close" size={20} color={color.textSecondary} />
              </Tap>
            </Animated.View>
          )}
          <View style={styles.inputRow}>
            <Tap onPress={attach} style={styles.round} scaleTo={0.92} accessibilityLabel="Add a photo or PDF">
              <Icon name="camera" size={24} />
            </Tap>
            <View style={styles.field}>
              <TextInput
                ref={input}
                value={text}
                onChangeText={setText}
                placeholder="Message or upload a timetable"
                placeholderTextColor={color.textSecondary}
                style={styles.input}
                multiline
                maxFontSizeMultiplier={1.15}
              />
            </View>
            <Tap onPress={submit} disabled={!canSend} style={[styles.round, styles.send, !canSend && styles.sendOff]} scaleTo={0.9} haptic="light" accessibilityLabel="Send">
              <Icon name="send" size={24} color={color.onInk} />
            </Tap>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

function Message({ item, onEdit }: { item: ChatItem; onEdit: (prefill: string) => void }) {
  if (item.role === 'user') {
    return (
      <Animated.View entering={enter} layout={LinearTransition.springify()} style={styles.userWrap}>
        {item.image && <Image source={{ uri: item.image }} style={styles.sentImage} />}
        {item.file && (
          <View style={styles.sentFile}>
            <Icon name="file" size={20} />
            <Text variant="body13" numberOfLines={1}>
              {item.file}
            </Text>
          </View>
        )}
        {item.text ? (
          <View style={styles.bubble}>
            <Text variant="body15" color={color.onInk}>
              {item.text}
            </Text>
          </View>
        ) : null}
      </Animated.View>
    );
  }
  return (
    <Animated.View entering={enter} style={styles.assistant}>
      <Text variant="body16" color={item.error ? color.textSecondary : color.text}>
        {item.text}
      </Text>
      {item.cards?.map((card, i) => (
        <ChatCard key={i} card={card} itemId={item.id} index={i} done={item.done?.[i]} onEdit={onEdit} />
      ))}
    </Animated.View>
  );
}

/** While the server works: a quiet line, no spinner. */
function Thinking() {
  return (
    <Animated.View entering={FadeIn.delay(300).duration(300)} style={styles.thinking}>
      <Text variant="body15" color={color.textSecondary}>
        Working on it…
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  flex: { flex: 1 },
  list: { flexGrow: 1, paddingHorizontal: gutter, paddingVertical: 12, gap: 16 },
  // Not a ListEmptyComponent: inside an inverted list Android renders it mirrored.
  empty: { flex: 1, justifyContent: 'flex-end', gap: 8, paddingHorizontal: gutter, paddingVertical: 12 },
  emptyText: { marginBottom: 8 },
  suggestion: { alignSelf: 'flex-start', backgroundColor: color.surface, borderRadius: radius.full, borderWidth: 1, borderColor: color.border, paddingHorizontal: 16, paddingVertical: 10 },
  userWrap: { alignItems: 'flex-end', gap: 8 },
  bubble: { maxWidth: 272, backgroundColor: color.ink, paddingHorizontal: 16, paddingVertical: 12, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderBottomLeftRadius: 20, borderBottomRightRadius: 6 },
  sentImage: { width: 132, height: 96, borderRadius: radius.md, backgroundColor: color.surfaceMuted },
  sentFile: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 240, backgroundColor: color.surface, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, ...shadow.soft },
  assistant: { gap: 12 },
  thinking: { paddingVertical: 4 },
  inputArea: { backgroundColor: color.surface, paddingHorizontal: 16, paddingVertical: 12, gap: 8, ...shadow.bar },
  attachment: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: color.surfaceMuted, borderRadius: radius.md, padding: 8 },
  thumb: { width: 40, height: 40, borderRadius: 8 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  round: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surfaceMuted, borderWidth: 1, borderColor: color.border },
  send: { backgroundColor: color.ink, borderColor: color.ink },
  sendOff: { opacity: 0.35 },
  field: { flex: 1, minHeight: 52, maxHeight: 120, borderRadius: 26, backgroundColor: color.surfaceMuted, borderWidth: 1, borderColor: color.border, paddingHorizontal: 20, justifyContent: 'center' },
  input: { fontFamily: font.regular, fontSize: 15, lineHeight: 20, color: color.text, paddingTop: 15, paddingBottom: 15, includeFontPadding: false, textAlignVertical: 'center' },
});

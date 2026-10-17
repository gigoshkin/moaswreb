import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library/legacy';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, StyleSheet, View } from 'react-native';
import type { Attachment } from '../lib/chat';
import { Icon, type IconName } from './Icon';
import { Sheet } from './Sheet';
import { Tap, haptic } from './Tap';
import { Text } from './Text';
import { notify } from './Dialog';
import { color, radius } from './theme';

const THUMB = 92;
const RECENT = 40;
/** Longest side sent to the server; the model doesn't need more and phone photos are huge. */
const MAX_SIDE = 1600;

interface Props {
  visible: boolean;
  onClose: () => void;
  onPick: (a: Attachment) => void;
}

/** "Add to chat" sheet: camera, photo library and PDF buttons, then a strip of the latest photos. */
export function AttachSheet({ visible, onClose, onPick }: Props) {
  const [permission, requestPermission] = MediaLibrary.usePermissions({ granularPermissions: ['photo'] });
  const [recent, setRecent] = useState<MediaLibrary.Asset[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const granted = permission?.granted ?? false;
  useEffect(() => {
    if (!visible || !granted) return;
    let live = true;
    MediaLibrary.getAssetsAsync({ first: RECENT, mediaType: 'photo', sortBy: [['creationTime', false]] })
      .then((page) => live && setRecent(page.assets))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [visible, granted]);

  const finish = (a: Attachment) => {
    onPick(a);
    onClose();
  };

  const camera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return void notify('Camera is off', 'Allow camera access for this app in your phone settings to take a photo.');
    onClose();
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6, base64: true });
    const a = res.assets?.[0];
    if (!res.canceled && a?.base64) onPick({ kind: 'image', mediaType: a.mimeType ?? 'image/jpeg', data: a.base64, uri: a.uri });
  };

  const library = async () => {
    onClose();
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6, base64: true });
    const a = res.assets?.[0];
    if (!res.canceled && a?.base64) onPick({ kind: 'image', mediaType: a.mimeType ?? 'image/jpeg', data: a.base64, uri: a.uri });
  };

  const pdf = async () => {
    onClose();
    const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
    const a = res.assets?.[0];
    if (res.canceled || !a) return;
    onPick({ kind: 'pdf', mediaType: 'application/pdf', data: await new File(a.uri).base64(), name: a.name });
  };

  const pickRecent = async (asset: MediaLibrary.Asset) => {
    if (busyId) return;
    setBusyId(asset.id);
    haptic('selection');
    try {
      const info = await MediaLibrary.getAssetInfoAsync(asset);
      const src = info.localUri ?? asset.uri;
      const big = Math.max(asset.width, asset.height) > MAX_SIDE;
      const out = await ImageManipulator.manipulateAsync(src, big ? [{ resize: asset.width >= asset.height ? { width: MAX_SIDE } : { height: MAX_SIDE } }] : [], {
        compress: 0.6,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
      });
      if (out.base64) finish({ kind: 'image', mediaType: 'image/jpeg', data: out.base64, uri: out.uri });
    } catch {
      haptic('error');
      notify("Couldn't open that photo", 'Try another one, or use Photos above.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.header}>
        <Tap onPress={onClose} hitSlop={12} scaleTo={0.9} accessibilityLabel="Close" style={styles.close}>
          <Icon name="close" size={22} />
        </Tap>
        <Text variant="title18" style={styles.title}>
          Add to chat
        </Text>
        <View style={styles.close} />
      </View>

      <View style={styles.tiles}>
        <TileButton icon="camera" label="Camera" onPress={camera} />
        <TileButton icon="image" label="Photos" onPress={library} />
        <TileButton icon="file" label="PDF" onPress={pdf} />
      </View>

      {granted ? (
        recent.length > 0 && (
          <FlatList
            data={recent}
            horizontal
            keyExtractor={(a) => a.id}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.strip}
            style={styles.stripWrap}
            renderItem={({ item }) => (
              <Tap onPress={() => pickRecent(item)} scaleTo={0.94} accessibilityLabel="Attach this photo">
                <Image source={{ uri: item.uri }} style={styles.thumb} />
                {busyId === item.id && (
                  <View style={styles.thumbBusy}>
                    <ActivityIndicator color={color.onInk} />
                  </View>
                )}
              </Tap>
            )}
          />
        )
      ) : (
        <Tap onPress={() => requestPermission()} feedback="tint" style={styles.allow} accessibilityRole="button">
          <Icon name="image" size={22} color={color.textSecondary} />
          <View style={styles.allowText}>
            <Text variant="label16">Show my recent photos</Text>
            <Text variant="body13" color={color.textSecondary}>
              Allow photo access to pick from here.
            </Text>
          </View>
          <Icon name="chevron-right" size={20} color={color.textTertiary} />
        </Tap>
      )}
    </Sheet>
  );
}

function TileButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Tap onPress={onPress} haptic="selection" scaleTo={0.95} style={styles.tile} accessibilityRole="button" accessibilityLabel={label}>
      <Icon name={icon} size={26} />
      <Text variant="label16">{label}</Text>
    </Tap>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  close: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  title: { textAlign: 'center' },
  tiles: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1, height: 88, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: color.surfaceMuted, borderRadius: radius.md },
  stripWrap: { marginTop: 14, marginHorizontal: -16, flexGrow: 0 },
  strip: { paddingHorizontal: 16, gap: 8 },
  thumb: { width: THUMB, height: THUMB, borderRadius: 12, backgroundColor: color.surfaceMuted },
  thumbBusy: { ...StyleSheet.absoluteFill, borderRadius: 12, backgroundColor: 'rgba(28,26,26,0.45)', alignItems: 'center', justifyContent: 'center' },
  allow: { marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: color.surfaceMuted, borderRadius: radius.md, padding: 14 },
  allowText: { flex: 1 },
});

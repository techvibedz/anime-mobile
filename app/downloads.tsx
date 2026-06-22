// Downloads — episodes saved for offline viewing. Lists every download with live
// progress (subscribed to lib/downloads), plays completed ones from the local
// file (offline, no scraping), and lets the user retry a failed one or delete.

import { useCallback, useEffect, useState } from "react";
import {
  View, Text, FlatList, Pressable, StyleSheet, Alert, ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  getDownloads, subscribeDownloads, deleteDownload, retryDownload, formatBytes,
  type DownloadItem,
} from "../lib/downloads";
import { C, S, R, ELEVATION_CARD } from "../lib/theme";
import { t } from "../lib/i18n";
import { Aurora, ScreenHeader } from "../components/ScreenChrome";

const PAD = S.paddingContent;

function playOffline(item: DownloadItem) {
  if (item.status !== "completed" || !item.fileUri) return;
  router.push({
    pathname: `/watch/${encodeURIComponent(item.episodeHref)}`,
    params: {
      local: encodeURIComponent(item.fileUri),
      img: item.image ? encodeURIComponent(item.image) : "",
      animeTitle: item.animeTitle || "",
      epNum: item.epNum != null ? String(item.epNum) : "",
      anime: item.animeHref || "",
    },
  });
}

export default function DownloadsScreen() {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<DownloadItem[] | null>(null);

  const refresh = useCallback(() => { getDownloads().then(setItems); }, []);

  useEffect(() => {
    refresh();
    const unsub = subscribeDownloads(refresh);
    return unsub;
  }, [refresh]);

  const onDelete = useCallback((item: DownloadItem) => {
    Alert.alert(t.removeDownload, t.confirmRemoveDownload, [
      { text: t.cancel, style: "cancel" },
      { text: t.remove, style: "destructive", onPress: () => deleteDownload(item.id) },
    ]);
  }, []);

  const totalBytes = (items ?? [])
    .filter((d) => d.status === "completed")
    .reduce((sum, d) => sum + (d.totalBytes || d.bytes || 0), 0);

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <Aurora />
      <ScreenHeader title={t.downloadsTitle} />

      {items === null ? (
        <View style={s.center}><ActivityIndicator size="large" color={C.accent} /></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: PAD, paddingBottom: insets.bottom + 24 }}
          ListHeaderComponent={
            items.length > 0 && totalBytes > 0 ? (
              <Text style={s.storage}>{t.storageUsed(formatBytes(totalBytes))}</Text>
            ) : null
          }
          ListEmptyComponent={
            <View style={s.empty}>
              <View style={s.emptyIcon}><Ionicons name="download-outline" size={32} color={C.accent} /></View>
              <Text style={s.emptyTitle}>{t.downloadsEmpty}</Text>
              <Text style={s.emptySub}>{t.downloadsEmptySub}</Text>
            </View>
          }
          renderItem={({ item }) => (
            <DownloadRow item={item} onPlay={() => playOffline(item)} onDelete={() => onDelete(item)} onRetry={() => retryDownload(item.id)} />
          )}
        />
      )}
    </View>
  );
}

function DownloadRow({
  item, onPlay, onDelete, onRetry,
}: {
  item: DownloadItem;
  onPlay: () => void;
  onDelete: () => void;
  onRetry: () => void;
}) {
  const pct = Math.round((item.progress || 0) * 100);
  const done = item.status === "completed";
  const failed = item.status === "failed";
  const busy = item.status === "downloading" || item.status === "resolving";

  const statusText = done
    ? `${t.downloaded}${item.totalBytes ? " · " + formatBytes(item.totalBytes) : ""}`
    : failed
      ? t.downloadFailed
      : item.status === "resolving"
        ? t.downloadResolving
        : `${t.downloading} ${pct}%`;

  return (
    <Pressable
      onPress={done ? onPlay : failed ? onRetry : undefined}
      style={({ pressed }) => [s.row, pressed && done && { opacity: 0.85 }]}
    >
      <View style={s.thumb}>
        {item.image ? (
          <Image source={{ uri: item.image }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={150} />
        ) : (
          <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
            <Ionicons name="film-outline" size={20} color={C.textMuted} />
          </View>
        )}
        <View style={s.thumbOverlay}>
          {done ? (
            <Ionicons name="play" size={18} color="#fff" />
          ) : failed ? (
            <Ionicons name="refresh" size={16} color="#fff" />
          ) : (
            <ActivityIndicator size="small" color="#fff" />
          )}
        </View>
      </View>

      <View style={s.meta}>
        <Text style={s.title} numberOfLines={1}>{item.animeTitle || item.episodeTitle}</Text>
        <Text style={s.sub} numberOfLines={1}>
          {item.epNum != null ? `${t.episode} ${item.epNum}` : item.episodeTitle}
        </Text>
        <View style={s.statusRow}>
          <Text style={[s.status, failed && { color: C.accent }, done && { color: C.success }]}>{statusText}</Text>
        </View>
        {busy && (
          <View style={s.barBg}>
            <View style={[s.barFill, { width: `${Math.max(3, pct)}%` }]} />
          </View>
        )}
      </View>

      <Pressable onPress={onDelete} hitSlop={8} style={s.deleteBtn}>
        <Ionicons name="trash-outline" size={18} color={C.textMuted} />
      </Pressable>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  storage: { color: C.textMuted, fontSize: 12, fontFamily: "Cairo_500Medium", textAlign: "right", marginBottom: 12, marginTop: 2 },

  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 10, marginBottom: 10, borderRadius: R.lg,
    backgroundColor: C.surfaceCard, borderWidth: 1, borderColor: C.border,
    ...ELEVATION_CARD,
  },
  thumb: {
    width: 92, height: 56, borderRadius: R.md, overflow: "hidden",
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  thumbOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.32)",
  },
  meta: { flex: 1, alignItems: "flex-end" },
  title: { color: C.text, fontSize: 14, fontFamily: "Cairo_600SemiBold", textAlign: "right" },
  sub: { color: C.textSecondary, fontSize: 11, fontFamily: "Cairo_500Medium", marginTop: 2, textAlign: "right" },
  statusRow: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  status: { color: C.textMuted, fontSize: 11, fontFamily: "Cairo_500Medium" },
  barBg: { width: "100%", height: 4, borderRadius: 2, backgroundColor: C.surfaceLight, marginTop: 6, overflow: "hidden" },
  barFill: { height: 4, borderRadius: 2, backgroundColor: C.accent },
  deleteBtn: { padding: 6 },

  empty: { alignItems: "center", justifyContent: "center", paddingTop: 90, gap: 10 },
  emptyIcon: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: C.glass,
    borderWidth: 1, borderColor: C.glassBorder, alignItems: "center", justifyContent: "center", marginBottom: 4,
  },
  emptyTitle: { color: C.text, fontSize: 16, fontFamily: "Cairo_700Bold", textAlign: "center" },
  emptySub: { color: C.textSecondary, fontSize: 13, lineHeight: 20, textAlign: "center", maxWidth: 260, fontFamily: "Cairo_500Medium" },
});

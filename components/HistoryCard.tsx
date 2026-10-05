// One anime in the watch history — the last episode reached, completion,
// progress and episode count, with a per-anime delete. Shared by the profile
// section and the full history screen.

import { memo } from "react";
import { View, Text, Pressable, StyleSheet, Alert } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import {
  isCompleted,
  progressPercent,
  type AnimeHistoryGroup,
} from "../lib/history";
import { toAnimeUrl } from "../lib/favorites";
import { C, R } from "../lib/theme";
import { t } from "../lib/i18n";

function openLastEpisode(group: AnimeHistoryGroup) {
  const e = group.last;
  const params: Record<string, string> = {};
  if (e.image) params.img = encodeURIComponent(e.image);
  if (e.url4up) params.url4up = encodeURIComponent(e.url4up);
  if (group.animeTitle) params.animeTitle = group.animeTitle;
  if (group.lastEpNum != null) params.epNum = String(group.lastEpNum);
  const rawAnime = group.animeHref || e.episodeHref;
  const animeUrl = rawAnime?.includes("/anime/") ? rawAnime : toAnimeUrl(rawAnime) ?? "";
  if (animeUrl) params.anime = animeUrl;
  router.push({ pathname: `/watch/${encodeURIComponent(e.episodeHref)}`, params });
}

export const HistoryCard = memo(function HistoryCard({
  group,
  onDelete,
}: {
  group: AnimeHistoryGroup;
  onDelete: (group: AnimeHistoryGroup) => void;
}) {
  const pct = progressPercent(group.last);
  const done = isCompleted(group.last);
  const showBar = done || pct > 0;
  // Old rows stored the anime name as the episode title — never print it twice.
  const rawEpTitle = (group.last.episodeTitle || "").trim();
  const epTitle = rawEpTitle.toLowerCase() === group.animeTitle.trim().toLowerCase() ? "" : rawEpTitle;
  const reached =
    group.lastEpNum != null
      ? t.historyReached(t.historyEpisode(group.lastEpNum))
      : epTitle || (done ? t.historyCompleted : "");
  const time = group.updatedAt > 0 ? t.newsTimeAgo(new Date(group.updatedAt).toISOString()) : "";

  const confirmDelete = () => {
    Alert.alert(t.deleteFromHistory, t.deleteFromHistoryConfirm(group.animeTitle), [
      { text: t.cancel, style: "cancel" },
      { text: t.confirm, style: "destructive", onPress: () => onDelete(group) },
    ]);
  };

  return (
    <Pressable
      onPress={() => openLastEpisode(group)}
      accessibilityRole="button"
      accessibilityLabel={group.animeTitle}
      style={({ pressed }) => [s.card, pressed && s.cardPressed]}
    >
      {group.image ? (
        <Image
          source={{ uri: group.image }}
          style={s.thumb}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={group.key}
          transition={150}
        />
      ) : (
        <View style={[s.thumb, s.thumbFallback]}>
          <Ionicons name="film-outline" size={20} color={C.textMuted} />
        </View>
      )}

      <View style={s.body}>
        <Text style={s.title} numberOfLines={2}>{group.animeTitle}</Text>
        {reached ? (
          <View style={s.reachedRow}>
            {done ? <Ionicons name="checkmark-circle" size={13} color={C.success} style={s.reachedIcon} /> : null}
            <Text style={[s.reached, done && { color: C.success }]} numberOfLines={1}>{reached}</Text>
          </View>
        ) : null}
        <View style={s.metaRow}>
          <Text style={s.metaTime} numberOfLines={1}>{time}</Text>
          <Text style={s.meta} numberOfLines={1}>{t.historyMeta(group.episodes, group.watched, "")}</Text>
        </View>
        {showBar ? (
          <View style={s.track}>
            <View
              style={[
                s.fill,
                {
                  width: `${Math.round((done ? 1 : pct) * 100)}%`,
                  backgroundColor: done ? C.success : C.accent,
                },
              ]}
            />
          </View>
        ) : null}
      </View>

      <Pressable
        onPress={(e) => {
          e.stopPropagation?.();
          confirmDelete();
        }}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t.deleteFromHistory}
        style={({ pressed }) => [s.deleteBtn, pressed && s.deleteBtnPressed]}
      >
        <Ionicons name="trash-outline" size={18} color={C.textMuted} />
      </Pressable>
    </Pressable>
  );
});

const s = StyleSheet.create({
  card: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: C.surface, borderRadius: R.xl,
    borderWidth: 1, borderColor: C.border,
    padding: 10, marginBottom: 10,
  },
  cardPressed: { backgroundColor: C.surfaceLight, transform: [{ scale: 0.99 }] },

  thumb: { width: 104, height: 68, borderRadius: R.sm, backgroundColor: C.surfaceLight },
  thumbFallback: { alignItems: "center", justifyContent: "center" },

  body: { flex: 1, alignItems: "flex-end" },
  title: {
    color: C.text, fontSize: 14, lineHeight: 21,
    fontFamily: "Cairo_600SemiBold", textAlign: "right",
  },
  reachedRow: { flexDirection: "row", alignItems: "center", marginTop: 3 },
  reachedIcon: { marginRight: 4 },
  reached: { flexShrink: 1, color: C.textSecondary, fontSize: 12, fontFamily: "Cairo_500Medium", textAlign: "right" },
  metaRow: {
    alignSelf: "stretch", flexDirection: "row", flexWrap: "wrap", columnGap: 6, justifyContent: "space-between",
    alignItems: "center", marginTop: 4,
  },
  meta: { color: C.textMuted, fontSize: 11, fontFamily: "Cairo_500Medium" },
  metaTime: { color: C.textMuted, fontSize: 10, fontFamily: "Cairo_500Medium" },
  track: {
    alignSelf: "stretch", height: 4, borderRadius: R.pill,
    backgroundColor: C.surfaceLight, marginTop: 6, overflow: "hidden",
  },
  fill: { height: "100%", borderRadius: R.pill },

  deleteBtn: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  deleteBtnPressed: { opacity: 0.5 },
});

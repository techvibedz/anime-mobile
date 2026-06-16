import { useCallback, useState } from "react";
import {
  View,
  Text,
  Pressable,
  FlatList,
  StyleSheet,
  I18nManager,
} from "react-native";
import { Image } from "expo-image";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import {
  getNotifications,
  markAllRead,
  markRead,
  clearNotifications,
  type AppNotification,
} from "../lib/notifications";
import { toAnimeUrl } from "../lib/favorites";
import { C, S, R, ELEVATION_CARD } from "../lib/theme";
import { t } from "../lib/i18n";

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t.justNow;
  if (mins < 60) return t.minutesAgo(mins);
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t.hoursAgo(hrs);
  return t.daysAgo(Math.floor(hrs / 24));
}

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<AppNotification[]>([]);

  const load = useCallback(() => {
    getNotifications().then(setItems);
  }, []);

  // Load on focus, then mark everything read once the user has seen the list.
  useFocusEffect(
    useCallback(() => {
      load();
      const timer = setTimeout(() => {
        markAllRead().then(load);
      }, 600);
      return () => clearTimeout(timer);
    }, [load]),
  );

  const openNotification = useCallback(
    (n: AppNotification) => {
      markRead(n.id);
      const params: Record<string, string> = {};
      if (n.image) params.img = encodeURIComponent(n.image);
      const animeUrl = n.animeHref?.includes("/anime/")
        ? n.animeHref
        : toAnimeUrl(n.episodeHref) ?? n.animeHref;
      if (animeUrl) params.anime = animeUrl;
      router.push({
        pathname: `/watch/${encodeURIComponent(n.episodeHref)}`,
        params,
      });
    },
    [],
  );

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
          <Ionicons name={I18nManager.isRTL ? "chevron-forward" : "chevron-back"} size={22} color={C.white} />
        </Pressable>
        <Text style={s.heading} numberOfLines={1}>{t.notifications}</Text>
        {items.length > 0 ? (
          <Pressable
            onPress={() => clearNotifications().then(load)}
            style={s.clearBtn}
            hitSlop={8}
          >
            <Ionicons name="trash-outline" size={16} color={C.textSecondary} />
          </Pressable>
        ) : (
          <View style={s.clearBtn} />
        )}
      </View>

      {items.length === 0 ? (
        <View style={s.empty}>
          <View style={s.emptyIcon}>
            <Ionicons name="notifications-off-outline" size={34} color={C.textMuted} />
          </View>
          <Text style={s.emptyTitle}>{t.notifEmpty}</Text>
          <Text style={s.emptySub}>{t.notifEmptySub}</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => n.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: S.paddingContent, paddingBottom: insets.bottom + 30, gap: 10 }}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => openNotification(item)}
              style={({ pressed }) => [s.card, !item.read && s.cardUnread, { opacity: pressed ? 0.85 : 1 }]}
            >
              <View style={s.thumbWrap}>
                {item.image ? (
                  <Image source={{ uri: item.image }} style={s.thumb} contentFit="cover" cachePolicy="memory-disk" transition={150} />
                ) : (
                  <View style={[s.thumb, { backgroundColor: C.surface, alignItems: "center", justifyContent: "center" }]}>
                    <Ionicons name="film-outline" size={22} color={C.textMuted} />
                  </View>
                )}
                <View style={s.thumbBadge}>
                  <LinearGradient colors={[C.accent, C.violet]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
                  <Ionicons name="play" size={12} color="#fff" />
                </View>
              </View>

              <View style={s.body}>
                <View style={s.titleRow}>
                  <Text style={s.cardTitle} numberOfLines={1}>{t.notifNewEpisodeTitle}</Text>
                  {!item.read && <View style={s.dot} />}
                </View>
                <Text style={s.cardMsg} numberOfLines={2}>
                  {item.episodeNumber != null
                    ? t.notifNewEpisode(item.animeTitle, item.episodeNumber)
                    : t.notifNewEpisodeNoNum(item.animeTitle)}
                </Text>
                <Text style={s.cardTime}>{timeAgo(item.createdAt)}</Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: S.paddingContent,
    paddingVertical: 12,
    gap: 12,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: R.circle,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    alignItems: "center", justifyContent: "center",
  },
  clearBtn: {
    width: 40, height: 40, borderRadius: R.circle,
    alignItems: "center", justifyContent: "center",
  },
  heading: {
    flex: 1, textAlign: "center",
    color: C.text, fontSize: 18, fontWeight: "700", fontFamily: "Outfit_700Bold",
  },

  // Card
  card: {
    flexDirection: "row",
    gap: 12,
    padding: 10,
    borderRadius: R.lg,
    backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.border,
    ...ELEVATION_CARD,
  },
  cardUnread: {
    backgroundColor: C.surfaceLight,
    borderColor: C.borderAccent,
  },
  thumbWrap: { width: 92, height: 56, borderRadius: R.md, overflow: "hidden" },
  thumb: { width: "100%", height: "100%" },
  thumbBadge: {
    position: "absolute", top: "50%", left: "50%",
    marginTop: -14, marginLeft: -14,
    width: 28, height: 28, borderRadius: R.circle, overflow: "hidden",
    alignItems: "center", justifyContent: "center",
  },
  body: { flex: 1, justifyContent: "center", gap: 3 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: {
    color: C.accent, fontSize: 12, fontWeight: "700", fontFamily: "Outfit_700Bold",
    textAlign: "left",
  },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.accent },
  cardMsg: {
    color: C.text, fontSize: 13, lineHeight: 18, fontFamily: "DMSans_600SemiBold",
    textAlign: "left", writingDirection: "rtl",
  },
  cardTime: {
    color: C.textMuted, fontSize: 11, fontFamily: "DMSans_500Medium",
    textAlign: "left", marginTop: 1,
  },

  // Empty
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40, gap: 12 },
  emptyIcon: {
    width: 80, height: 80, borderRadius: R.circle,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    alignItems: "center", justifyContent: "center", marginBottom: 4,
  },
  emptyTitle: { color: C.text, fontSize: 17, fontWeight: "700", fontFamily: "Outfit_700Bold" },
  emptySub: {
    color: C.textSecondary, fontSize: 13, lineHeight: 20, textAlign: "center", maxWidth: 260,
    fontFamily: "DMSans_400Regular", writingDirection: "rtl",
  },
});

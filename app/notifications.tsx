import { useCallback, useState } from "react";
import {
  View,
  Text,
  Pressable,
  FlatList,
  StyleSheet,
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
import { Aurora, ScreenHeader, GlassIconButton } from "../components/ScreenChrome";

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
      <Aurora />
      <ScreenHeader
        title={t.notifications}
        right={
          items.length > 0 ? (
            <GlassIconButton icon="trash-outline" size={18} tint={C.textSecondary} onPress={() => clearNotifications().then(load)} />
          ) : undefined
        }
      />

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
              style={({ pressed }) => [s.card, !item.read && s.cardUnread, pressed && s.cardPressed]}
            >
              {!item.read ? <View style={s.unreadBar} /> : null}

              <View style={s.body}>
                <View style={s.titleRow}>
                  {!item.read && <View style={s.dot} />}
                  <Text style={s.cardTitle} numberOfLines={1}>{t.notifNewEpisodeTitle}</Text>
                </View>
                <Text style={s.cardMsg} numberOfLines={2}>
                  {item.episodeNumber != null
                    ? t.notifNewEpisode(item.animeTitle, item.episodeNumber)
                    : t.notifNewEpisodeNoNum(item.animeTitle)}
                </Text>
                <Text style={s.cardTime}>{timeAgo(item.createdAt)}</Text>
              </View>

              <View style={s.thumbWrap}>
                {item.image ? (
                  <Image source={{ uri: item.image }} style={s.thumb} contentFit="cover" cachePolicy="memory-disk" transition={150} />
                ) : (
                  <View style={[s.thumb, s.thumbFallback]}>
                    <Ionicons name="film-outline" size={22} color={C.textMuted} />
                  </View>
                )}
                <View style={s.thumbBadge}>
                  <LinearGradient colors={[C.accent, C.violet]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
                  <Ionicons name="play" size={12} color="#fff" />
                </View>
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

  // Card — thumbnail hugs the right edge (Arabic), text body flows left of it.
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    borderRadius: R.xl,
    backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.border,
    overflow: "hidden",
    ...ELEVATION_CARD,
  },
  cardUnread: { backgroundColor: C.surfaceLight, borderColor: C.borderAccent },
  cardPressed: { backgroundColor: C.surfaceLight, transform: [{ scale: 0.99 }] },
  unreadBar: { position: "absolute", right: 0, top: 10, bottom: 10, width: 3, borderRadius: 2, backgroundColor: C.accent },

  thumbWrap: { width: 96, height: 58, borderRadius: R.md, overflow: "hidden", marginLeft: 12 },
  thumb: { width: "100%", height: "100%" },
  thumbFallback: { backgroundColor: C.surface, alignItems: "center", justifyContent: "center" },
  thumbBadge: {
    position: "absolute", top: "50%", left: "50%",
    marginTop: -14, marginLeft: -14,
    width: 28, height: 28, borderRadius: R.circle, overflow: "hidden",
    alignItems: "center", justifyContent: "center",
  },

  body: { flex: 1, justifyContent: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end" },
  cardTitle: { color: C.accent, fontSize: 12, fontWeight: "700", fontFamily: "Outfit_700Bold", textAlign: "right" },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.accent, marginRight: 8 },
  cardMsg: {
    color: C.text, fontSize: 13.5, lineHeight: 19, fontFamily: "DMSans_600SemiBold",
    textAlign: "right", writingDirection: "rtl", marginTop: 3,
  },
  cardTime: { color: C.textMuted, fontSize: 11, fontFamily: "DMSans_500Medium", textAlign: "right", marginTop: 4 },

  // Empty
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40, gap: 12 },
  emptyIcon: {
    width: 84, height: 84, borderRadius: R.circle,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    alignItems: "center", justifyContent: "center", marginBottom: 4,
  },
  emptyTitle: { color: C.text, fontSize: 17, fontWeight: "700", fontFamily: "Outfit_700Bold" },
  emptySub: {
    color: C.textSecondary, fontSize: 13, lineHeight: 20, textAlign: "center", maxWidth: 260,
    fontFamily: "DMSans_400Regular", writingDirection: "rtl",
  },
});

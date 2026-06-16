import { useCallback, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  I18nManager,
} from "react-native";
import { Image } from "expo-image";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useAuth } from "../lib/auth";
import { getHistory, isCompleted, type WatchEntry } from "../lib/history";
import { getFavorites } from "../lib/favorites";
import { toAnimeUrl } from "../lib/favorites";
import { C, S, R, ELEVATION_CARD } from "../lib/theme";
import { t } from "../lib/i18n";

interface Stats {
  episodesWatched: number;
  watchHours: number;
  watchMins: number;
  animeInList: number;
  watching: number;
  planned: number;
  distinctAnime: number;
  recent: WatchEntry[];
}

const EMPTY: Stats = {
  episodesWatched: 0, watchHours: 0, watchMins: 0, animeInList: 0,
  watching: 0, planned: 0, distinctAnime: 0, recent: [],
};

function arMonthYear(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  try {
    return d.toLocaleDateString("ar", { month: "long", year: "numeric" });
  } catch {
    return `${d.getMonth() + 1}/${d.getFullYear()}`;
  }
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats>(EMPTY);

  useFocusEffect(
    useCallback(() => {
      Promise.all([getHistory(), getFavorites()])
        .then(([history, favs]) => {
          const completed = history.filter(isCompleted);
          const totalMs = history.reduce((sum, e) => sum + (e.positionMs || 0), 0);
          const totalMin = Math.floor(totalMs / 60000);
          const distinct = new Set(history.map((e) => e.animeHref || e.animeTitle)).size;
          setStats({
            episodesWatched: completed.length,
            watchHours: Math.floor(totalMin / 60),
            watchMins: totalMin % 60,
            animeInList: favs.length,
            watching: favs.filter((f) => f.list === "watching").length,
            planned: favs.filter((f) => f.list === "planned").length,
            distinctAnime: distinct,
            recent: history.slice(0, 6),
          });
        })
        .catch(() => {});
    }, []),
  );

  const displayName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    (user?.email ? user.email.split("@")[0] : t.guest);
  const avatarUrl = user?.user_metadata?.avatar_url || user?.user_metadata?.picture || null;
  const initial = (displayName || "?").trim().charAt(0).toUpperCase();
  const since = arMonthYear(user?.created_at);

  const bigStats = [
    { icon: "play-circle", value: String(stats.episodesWatched), label: t.statsEpisodesWatched },
    { icon: "time", value: t.watchTimeValue(stats.watchHours, stats.watchMins), label: t.statsWatchTime },
    { icon: "albums", value: String(stats.animeInList), label: t.statsAnimeInList },
  ];

  const miniStats = [
    { icon: "play", value: stats.watching, label: t.statsWatching, color: C.success },
    { icon: "bookmark", value: stats.planned, label: t.statsPlanned, color: C.violet },
    { icon: "tv", value: stats.distinctAnime, label: t.statsCompleted, color: C.gold },
  ];

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
          <Ionicons name={I18nManager.isRTL ? "chevron-forward" : "chevron-back"} size={22} color={C.white} />
        </Pressable>
        <Text style={s.heading}>{t.profileTitle}</Text>
        <Pressable onPress={() => router.push("/settings")} style={s.backBtn} hitSlop={8}>
          <Ionicons name="settings-outline" size={20} color={C.textSecondary} />
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
        {/* Hero card */}
        <View style={s.hero}>
          <LinearGradient
            colors={[C.violetSoft, "transparent"]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={s.avatar} contentFit="cover" transition={150} />
          ) : (
            <LinearGradient colors={[C.accent, C.violet]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.avatar}>
              <Text style={s.avatarInitial}>{initial}</Text>
            </LinearGradient>
          )}
          <Text style={s.name} numberOfLines={1}>{displayName}</Text>
          {user?.email ? <Text style={s.email} numberOfLines={1}>{user.email}</Text> : null}
          {since ? <Text style={s.since}>{t.memberSince(since)}</Text> : null}
        </View>

        {/* Big stats */}
        <View style={s.bigStatsRow}>
          {bigStats.map((st2) => (
            <View key={st2.label} style={s.bigStatCard}>
              <Ionicons name={st2.icon as any} size={18} color={C.accent} />
              <Text style={s.bigStatValue} numberOfLines={1} adjustsFontSizeToFit>{st2.value}</Text>
              <Text style={s.bigStatLabel}>{st2.label}</Text>
            </View>
          ))}
        </View>

        {/* Mini stats */}
        <View style={s.miniRow}>
          {miniStats.map((m) => (
            <View key={m.label} style={s.miniCard}>
              <View style={[s.miniIcon, { backgroundColor: m.color + "22" }]}>
                <Ionicons name={m.icon as any} size={14} color={m.color} />
              </View>
              <Text style={s.miniValue}>{m.value}</Text>
              <Text style={s.miniLabel}>{m.label}</Text>
            </View>
          ))}
        </View>

        {/* Recent activity */}
        <Text style={s.sectionTitle}>{t.recentActivity}</Text>
        {stats.recent.length === 0 ? (
          <View style={s.emptyActivity}>
            <Ionicons name="film-outline" size={26} color={C.textMuted} />
            <Text style={s.emptyText}>{t.noActivity}</Text>
          </View>
        ) : (
          <View style={s.recentList}>
            {stats.recent.map((e) => (
              <Pressable
                key={e.episodeHref}
                style={({ pressed }) => [s.recentItem, { opacity: pressed ? 0.85 : 1 }]}
                onPress={() => {
                  const params: Record<string, string> = {};
                  if (e.image) params.img = encodeURIComponent(e.image);
                  if (e.url4up) params.url4up = encodeURIComponent(e.url4up);
                  const rawAnime = e.animeHref || e.episodeHref;
                  const animeUrl = rawAnime?.includes("/anime/") ? rawAnime : toAnimeUrl(rawAnime) ?? "";
                  if (animeUrl) params.anime = animeUrl;
                  router.push({ pathname: `/watch/${encodeURIComponent(e.episodeHref)}`, params });
                }}
              >
                {e.image ? (
                  <Image source={{ uri: e.image }} style={s.recentThumb} contentFit="cover" transition={120} />
                ) : (
                  <View style={[s.recentThumb, { backgroundColor: C.surface, alignItems: "center", justifyContent: "center" }]}>
                    <Ionicons name="film-outline" size={18} color={C.textMuted} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={s.recentTitle} numberOfLines={1}>{e.episodeTitle || e.animeTitle}</Text>
                  <Text style={s.recentSub} numberOfLines={1}>{e.animeTitle}</Text>
                </View>
                {isCompleted(e) && <Ionicons name="checkmark-circle" size={18} color={C.success} />}
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: S.paddingContent, paddingVertical: 12,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: R.circle,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    alignItems: "center", justifyContent: "center",
  },
  heading: { color: C.text, fontSize: 18, fontWeight: "700", fontFamily: "Outfit_700Bold" },

  hero: { alignItems: "center", paddingVertical: 24, paddingHorizontal: S.paddingContent },
  avatar: {
    width: 92, height: 92, borderRadius: R.circle,
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: C.glassBorder,
  },
  avatarInitial: { color: "#fff", fontSize: 38, fontWeight: "800", fontFamily: "Outfit_800ExtraBold" },
  name: { color: C.text, fontSize: 22, fontWeight: "800", fontFamily: "Outfit_800ExtraBold", marginTop: 14 },
  email: { color: C.textSecondary, fontSize: 13, marginTop: 4, fontFamily: "DMSans_500Medium" },
  since: { color: C.textMuted, fontSize: 11, marginTop: 6, fontFamily: "DMSans_500Medium" },

  bigStatsRow: { flexDirection: "row", gap: 10, paddingHorizontal: S.paddingContent, marginTop: 4 },
  bigStatCard: {
    flex: 1, alignItems: "center", gap: 6, paddingVertical: 16, borderRadius: R.lg,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    ...ELEVATION_CARD,
  },
  bigStatValue: { color: C.text, fontSize: 18, fontWeight: "800", fontFamily: "Outfit_800ExtraBold" },
  bigStatLabel: { color: C.textSecondary, fontSize: 10, textAlign: "center", fontFamily: "DMSans_500Medium" },

  miniRow: { flexDirection: "row", gap: 10, paddingHorizontal: S.paddingContent, marginTop: 10 },
  miniCard: {
    flex: 1, alignItems: "center", gap: 5, paddingVertical: 12, borderRadius: R.lg,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
  },
  miniIcon: { width: 28, height: 28, borderRadius: R.circle, alignItems: "center", justifyContent: "center" },
  miniValue: { color: C.text, fontSize: 16, fontWeight: "700", fontFamily: "Outfit_700Bold" },
  miniLabel: { color: C.textMuted, fontSize: 9, textAlign: "center", fontFamily: "DMSans_500Medium" },

  sectionTitle: {
    color: C.text, fontSize: 16, fontWeight: "700", fontFamily: "Outfit_700Bold",
    paddingHorizontal: S.paddingContent, marginTop: 28, marginBottom: 12, textAlign: "left",
  },
  recentList: { paddingHorizontal: S.paddingContent, gap: 8 },
  recentItem: {
    flexDirection: "row", alignItems: "center", gap: 12, padding: 8,
    borderRadius: R.lg, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  recentThumb: { width: 64, height: 40, borderRadius: R.sm },
  recentTitle: { color: C.text, fontSize: 13, fontWeight: "600", fontFamily: "DMSans_600SemiBold", textAlign: "left" },
  recentSub: { color: C.textMuted, fontSize: 11, marginTop: 2, fontFamily: "DMSans_500Medium", textAlign: "left" },

  emptyActivity: { alignItems: "center", gap: 10, paddingVertical: 36 },
  emptyText: { color: C.textMuted, fontSize: 13, fontFamily: "DMSans_500Medium" },
});

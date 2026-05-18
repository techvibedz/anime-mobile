import { useState, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  FlatList,
  StyleSheet,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { getFavorites, removeFavorite } from "../../lib/favorites";
import type { FavoriteAnime, FavoriteList } from "../../lib/favorites";
import { useAuth } from "../../lib/auth";
import { C, S, R, ELEVATION_CARD } from "../../lib/theme";
import { t } from "../../lib/i18n";

type ListFilter = "all" | FavoriteList;

export default function MyListScreen() {
  const insets = useSafeAreaInsets();
  const { user, signOut, isConfigured } = useAuth();
  const [favorites, setFavorites] = useState<FavoriteAnime[]>([]);
  const [filter, setFilter] = useState<ListFilter>("all");

  useFocusEffect(
    useCallback(() => {
      getFavorites().then(setFavorites);
    }, []),
  );

  async function handleRemove(href: string) {
    await removeFavorite(href);
    setFavorites((prev) => prev.filter((f) => f.href !== href));
  }

  const watchingCount = favorites.filter((f) => f.list === "watching").length;
  const plannedCount = favorites.filter((f) => f.list === "planned").length;
  const visible = filter === "all" ? favorites : favorites.filter((f) => f.list === filter);

  const filters: { key: ListFilter; label: string; count: number }[] = [
    { key: "all", label: "الكل", count: favorites.length },
    { key: "watching", label: t.currentlyWatching, count: watchingCount },
    { key: "planned", label: t.planToWatch, count: plannedCount },
  ];

  return (
    <View style={[ss.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={ss.header}>
        <View>
          <Text style={ss.heading}>{t.myListTitle}</Text>
          {user?.email && <Text style={ss.userEmail} numberOfLines={1}>{user.email}</Text>}
        </View>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <Text style={ss.countLabel}>{favorites.length}</Text>
          {isConfigured && user && (
            <Pressable onPress={signOut} hitSlop={8} style={ss.signOutBtn}>
              <Ionicons name="log-out-outline" size={18} color={C.textMuted} />
            </Pressable>
          )}
        </View>
      </View>

      {/* Filter pills */}
      <View style={ss.filterRow}>
        {filters.map((f) => (
          <Pressable key={f.key} onPress={() => setFilter(f.key)}>
            <View style={[ss.filterPill, filter === f.key && ss.filterPillActive]}>
              <Text style={[ss.filterText, filter === f.key && ss.filterTextActive]}>{f.label}</Text>
              <View style={[ss.filterCount, filter === f.key && ss.filterCountActive]}>
                <Text style={[ss.filterCountText, filter === f.key && ss.filterCountTextActive]}>
                  {f.count}
                </Text>
              </View>
            </View>
          </Pressable>
        ))}
      </View>

      {visible.length === 0 ? (
        <View style={ss.empty}>
          <View style={ss.emptyCircle}>
            <Ionicons name="heart-outline" size={28} color={C.textMuted} />
          </View>
          <Text style={ss.emptyTitle}>{t.emptyList}</Text>
          <Text style={ss.emptyDesc}>{t.emptyListSub}</Text>
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => item.href}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: S.paddingContent, paddingBottom: insets.bottom + 100 }}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/anime/${encodeURIComponent(item.href)}`)}
              onLongPress={() => handleRemove(item.href)}
              style={({ pressed }) => [ss.listRow, pressed && { opacity: 0.8, transform: [{ scale: 0.98 }] }]}
            >
              {/* Poster thumbnail */}
              <View style={ss.poster}>
                {item.image ? (
                  <Image source={{ uri: item.image }} style={StyleSheet.absoluteFill} contentFit="cover" />
                ) : (
                  <View style={[StyleSheet.absoluteFill, { backgroundColor: C.surface, alignItems: "center", justifyContent: "center" }]}>
                    <Ionicons name="image-outline" size={20} color={C.textMuted} />
                  </View>
                )}
              </View>
              {/* Info */}
              <View style={ss.rowInfo}>
                <Text style={ss.rowTitle} numberOfLines={1}>{item.title}</Text>
                <View style={ss.rowMeta}>
                  <Ionicons
                    name={item.list === "watching" ? "play-circle" : "bookmark"}
                    size={11}
                    color={item.list === "watching" ? C.green : C.accent}
                  />
                  <Text style={[ss.rowMetaText, { color: item.list === "watching" ? C.green : C.accent }]}>
                    {item.list === "watching" ? t.currentlyWatching : t.planToWatch}
                  </Text>
                </View>
              </View>
              {/* Play button */}
              <View style={ss.playCircle}>
                <Ionicons name="play" size={14} color={C.accent} />
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const ss = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  // Header
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: S.paddingContent, paddingTop: 16, paddingBottom: 8,
  },
  heading: {
    color: C.text, fontSize: 26, fontWeight: "700", letterSpacing: -0.4,
    fontFamily: "Outfit_700Bold",
  },
  countLabel: { color: C.textMuted, fontSize: 11, fontWeight: "600", fontFamily: "DMSans_600SemiBold" },
  userEmail: { color: C.textMuted, fontSize: 11, marginTop: 2, fontFamily: "DMSans_500Medium", maxWidth: 200 },
  signOutBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    alignItems: "center", justifyContent: "center",
  },

  // Filters
  filterRow: {
    flexDirection: "row", gap: 6,
    paddingHorizontal: S.paddingContent, paddingVertical: 12,
  },
  filterPill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: R.pill,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
  },
  filterPillActive: { backgroundColor: C.accentSoft, borderColor: C.borderAccent },
  filterText: { color: C.textSecondary, fontSize: 11, fontWeight: "600", fontFamily: "DMSans_600SemiBold" },
  filterTextActive: { color: C.accent },
  filterCount: {
    backgroundColor: C.glass, borderRadius: R.circle,
    paddingHorizontal: 6, paddingVertical: 1,
  },
  filterCountActive: { backgroundColor: "rgba(255,45,85,0.1)" },
  filterCountText: { color: C.textMuted, fontSize: 10, fontWeight: "500" },
  filterCountTextActive: { color: C.accent },

  // Empty
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, paddingBottom: 80 },
  emptyCircle: {
    width: 64, height: 64, borderRadius: R.circle,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    alignItems: "center", justifyContent: "center",
  },
  emptyTitle: { color: C.textSecondary, fontSize: 16, fontWeight: "600", fontFamily: "Outfit_600SemiBold" },
  emptyDesc: {
    color: C.textMuted, fontSize: 13, textAlign: "center", maxWidth: 200,
    fontFamily: "DMSans_500Medium",
  },

  // List rows
  listRow: {
    flexDirection: "row", alignItems: "center", gap: 14, padding: 10,
    borderRadius: R.lg, backgroundColor: "transparent",
  },
  poster: {
    width: 56, height: 80, borderRadius: R.default, overflow: "hidden",
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    ...ELEVATION_CARD,
  },
  rowInfo: { flex: 1, gap: 4 },
  rowTitle: {
    color: C.text, fontSize: 16, fontWeight: "600",
    fontFamily: "Outfit_600SemiBold",
  },
  rowMeta: { flexDirection: "row", alignItems: "center", gap: 4 },
  rowMetaText: { color: C.textMuted, fontSize: 10, fontFamily: "DMSans_500Medium" },
  playCircle: {
    width: 36, height: 36, borderRadius: R.circle,
    backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.borderAccent,
    alignItems: "center", justifyContent: "center",
  },
});

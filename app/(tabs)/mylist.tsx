import { useState, useCallback, memo } from "react";
import {
  View,
  Text,
  Pressable,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Dimensions,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { getFavorites, removeFavorite } from "../../lib/favorites";
import type { FavoriteAnime, FavoriteList } from "../../lib/favorites";
import { MalCardBadge } from "../../components/MalRating";
import { CompletionBadge } from "../../components/CompletionBadge";
import { useAuth } from "../../lib/auth";
import { C, S, R, ELEVATION_CARD } from "../../lib/theme";
import { t } from "../../lib/i18n";

type ListFilter = "all" | FavoriteList;

const { width: SCREEN_W } = Dimensions.get("window");
const PAD = S.paddingContent;
const GAP = S.gapRelaxed;
const NUM_COLS = 2;
const CARD_W = (SCREEN_W - PAD * 2 - GAP * (NUM_COLS - 1)) / NUM_COLS;

export default function MyListScreen() {
  const insets = useSafeAreaInsets();
  const { user, signOut, isConfigured } = useAuth();
  const [favorites, setFavorites] = useState<FavoriteAnime[]>([]);
  const [filter, setFilter] = useState<ListFilter>("all");
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getFavorites().then(setFavorites);
    }, []),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setFavorites(await getFavorites());
    } finally {
      setRefreshing(false);
    }
  }, []);

  const handleRemove = useCallback(async (href: string) => {
    await removeFavorite(href);
    setFavorites((prev) => prev.filter((f) => f.href !== href));
  }, []);

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

      {/* Filter pills — horizontally scrollable so long labels never clip */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={ss.filterScroll}
        contentContainerStyle={ss.filterRow}
      >
        {filters.map((f) => (
          <Pressable key={f.key} onPress={() => setFilter(f.key)}>
            <View style={[ss.filterPill, filter === f.key && ss.filterPillActive]}>
              {/* Label first (leading), count last (trailing). The label uses the
                  Cairo Arabic font so its glyphs are measured correctly and stay
                  inside the Text box — no more spill onto the count badge. */}
              <Text numberOfLines={1} style={[ss.filterText, filter === f.key && ss.filterTextActive]}>{f.label}</Text>
              <View style={[ss.filterCount, filter === f.key && ss.filterCountActive]}>
                <Text style={[ss.filterCountText, filter === f.key && ss.filterCountTextActive]}>
                  {f.count}
                </Text>
              </View>
            </View>
          </Pressable>
        ))}
      </ScrollView>

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
          numColumns={NUM_COLS}
          keyExtractor={(item) => item.href}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
          initialNumToRender={8}
          maxToRenderPerBatch={6}
          windowSize={7}
          updateCellsBatchingPeriod={50}
          contentContainerStyle={{ padding: PAD, paddingBottom: insets.bottom + 100 }}
          columnWrapperStyle={{ gap: GAP, marginBottom: GAP }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={C.accent}
              colors={[C.accent]}
              progressBackgroundColor={C.surface}
            />
          }
          renderItem={({ item }) => <MyListCard item={item} onRemove={handleRemove} />}
        />
      )}
    </View>
  );
}

/* Memoized poster card — keeps the grid from re-rendering every visible row
 * when an unrelated piece of screen state (filter, header count) changes. */
const MyListCard = memo(function MyListCard({
  item,
  onRemove,
}: {
  item: FavoriteAnime;
  onRemove: (href: string) => void;
}) {
  const watching = item.list === "watching";
  return (
    <Pressable
      onPress={() => router.push(`/anime/${encodeURIComponent(item.href)}`)}
      onLongPress={() => onRemove(item.href)}
      style={({ pressed }) => [{ width: CARD_W }, pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] }]}
    >
      {/* Poster */}
      <View style={ss.imageWrap}>
        {item.image ? (
          <Image
            source={{ uri: item.image }}
            style={ss.image}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={item.href}
            transition={200}
          />
        ) : (
          <View style={[ss.image, { alignItems: "center", justifyContent: "center" }]}>
            <Ionicons name="image-outline" size={26} color={C.textMuted} />
          </View>
        )}

        {/* Bottom gradient + play hint */}
        <View style={ss.posterFooter} pointerEvents="none">
          <LinearGradient
            colors={["transparent", "rgba(0,0,0,0.85)"]}
            style={StyleSheet.absoluteFill}
          />
          <View style={ss.playCircle}>
            <Ionicons name="play" size={14} color="#fff" />
          </View>
        </View>

        {/* Status badge (top-left) */}
        <View style={[ss.statusBadge, { backgroundColor: watching ? "rgba(0,230,118,0.92)" : "rgba(255,90,44,0.92)" }]}>
          <Ionicons
            name={watching ? "play-circle" : "bookmark"}
            size={11}
            color="#fff"
          />
          <Text style={ss.statusBadgeText}>
            {watching ? t.currentlyWatching : t.planToWatch}
          </Text>
        </View>

        {/* Remove (top-right) */}
        <Pressable onPress={() => onRemove(item.href)} hitSlop={8} style={ss.removeBtn}>
          <Ionicons name="close" size={15} color="#fff" />
        </Pressable>

        {/* MAL rating (bottom-left, clear of the status/remove/play controls) */}
        <MalCardBadge title={item.title} style={{ top: undefined as any, right: undefined as any, bottom: 8, left: 8 }} />

        {/* Completion badge (bottom-right) */}
        <CompletionBadge hrefs={[item.href]} titles={[item.title]} />
      </View>

      {/* Title */}
      <Text style={ss.cardTitle} numberOfLines={2}>{item.title}</Text>
    </Pressable>
  );
});

const ss = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  // Header
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: S.paddingContent, paddingTop: 16, paddingBottom: 8,
  },
  heading: {
    color: C.bone, fontSize: 30, fontWeight: "900", letterSpacing: -0.8,
    fontFamily: "Cairo_700Bold",
  },
  countLabel: { color: C.textMuted, fontSize: 11, fontWeight: "600", fontFamily: "Cairo_600SemiBold" },
  userEmail: { color: C.textMuted, fontSize: 11, marginTop: 2, fontFamily: "Cairo_500Medium", maxWidth: 200 },
  signOutBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    alignItems: "center", justifyContent: "center",
  },

  // Filters — no `gap`: it breaks layout under RTL row (Yoga bug), use margins
  filterScroll: { flexGrow: 0 },
  filterRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: S.paddingContent, paddingVertical: 12,
  },
  filterPill: {
    flexDirection: "row", alignItems: "center", flexShrink: 0,
    marginHorizontal: 3, height: 36,
    paddingHorizontal: 14, borderRadius: R.pill,
    backgroundColor: "transparent", borderWidth: 1, borderColor: C.borderLight,
  },
  filterPillActive: { backgroundColor: C.accentSoft, borderColor: C.borderAccent },
  filterText: { color: C.textSecondary, fontSize: 12, lineHeight: 18, fontWeight: "600", fontFamily: "Cairo_600SemiBold", flexShrink: 0, includeFontPadding: false, textAlignVertical: "center" },
  filterTextActive: { color: C.ember },
  filterCount: {
    backgroundColor: C.glass, borderRadius: R.circle,
    minWidth: 20, alignItems: "center",
    paddingHorizontal: 6, paddingVertical: 1,
    marginStart: 8,
  },
  filterCountActive: { backgroundColor: "rgba(255,90,44,0.1)" },
  filterCountText: { color: C.textMuted, fontSize: 10, fontWeight: "500" },
  filterCountTextActive: { color: C.accent },

  // Empty
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, paddingBottom: 80 },
  emptyCircle: {
    width: 64, height: 64, borderRadius: R.circle,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    alignItems: "center", justifyContent: "center",
  },
  emptyTitle: { color: C.textSecondary, fontSize: 16, fontWeight: "600", fontFamily: "Cairo_600SemiBold" },
  emptyDesc: {
    color: C.textMuted, fontSize: 13, textAlign: "center", maxWidth: 200,
    fontFamily: "Cairo_500Medium",
  },

  // Grid cards
  imageWrap: {
    width: CARD_W,
    aspectRatio: 2 / 3,
    borderRadius: R.xl,
    overflow: "hidden",
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    ...ELEVATION_CARD,
  },
  image: {
    width: CARD_W,
    aspectRatio: 2 / 3,
    borderRadius: R.xl,
    backgroundColor: C.surface,
  },
  posterFooter: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    height: 64, justifyContent: "flex-end", alignItems: "flex-end", padding: 8,
  },
  playCircle: {
    width: 32, height: 32, borderRadius: R.circle,
    backgroundColor: "rgba(255,90,44,0.95)",
    alignItems: "center", justifyContent: "center",
  },
  statusBadge: {
    position: "absolute", top: 8, left: 8,
    flexDirection: "row", alignItems: "center", gap: 4,
    borderRadius: R.pill, paddingHorizontal: 8, paddingVertical: 4,
  },
  statusBadgeText: { color: "#fff", fontSize: 10, fontWeight: "700", fontFamily: "Cairo_600SemiBold" },
  removeBtn: {
    position: "absolute", top: 8, right: 8,
    width: 28, height: 28, borderRadius: R.circle,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center", justifyContent: "center",
  },
  cardTitle: {
    color: C.text, fontSize: 13, fontWeight: "600", lineHeight: 17,
    marginTop: 8, width: CARD_W,
    fontFamily: "Cairo_600SemiBold",
  },
});

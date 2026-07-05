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
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { getFavorites, removeFavorite } from "../../lib/favorites";
import type { FavoriteAnime, FavoriteList } from "../../lib/favorites";
import { MalCardBadge } from "../../components/MalRating";
import { CompletionBadge } from "../../components/CompletionBadge";
import { PosterCard, PosterPill, PosterCornerBtn } from "../../components/PosterCard";
import { StateView } from "../../components/StateView";
import { Rise } from "../../components/Rise";
import { useAuth } from "../../lib/auth";
import { C, S, R, TAr } from "../../lib/theme";
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
      {/* ── Collection header — one cohesive surface lifted over the grid ── */}
      <View style={ss.headerSurface}>
        <Rise style={ss.header}>
          <View style={ss.headerTitleWrap}>
            <Text style={ss.heading}>{t.myListTitle}</Text>
            {user?.email && <Text style={ss.userEmail} numberOfLines={1}>{user.email}</Text>}
          </View>
          {isConfigured && user && (
            <Pressable onPress={signOut} hitSlop={8} style={ss.signOutBtn}>
              <Ionicons name="log-out-outline" size={18} color={C.textMuted} />
            </Pressable>
          )}
        </Rise>

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

        {/* Surface bottom edge — separates the header from the scrolling grid */}
        <View style={ss.headerEdge} />
      </View>

      {visible.length === 0 ? (
        <StateView
          icon="heart-outline"
          variant="empty"
          title={t.emptyList}
          message={t.emptyListSub}
        />
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

/* Memoized poster card — built on the unified <PosterCard>. */
const MyListCard = memo(function MyListCard({
  item,
  onRemove,
}: {
  item: FavoriteAnime;
  onRemove: (href: string) => void;
}) {
  const watching = item.list === "watching";
  return (
    <PosterCard
      image={item.image}
      title={item.title}
      onPress={() => router.push(`/anime/${encodeURIComponent(item.href)}`)}
      onLongPress={() => onRemove(item.href)}
      width={CARD_W}
      recyclingKey={item.href}
      titleLines={2}
      topLeft={
        <PosterPill tint={watching ? "rgba(74,222,128,0.92)" : "rgba(110,119,230,0.94)"}>
          <Ionicons name={watching ? "play-circle" : "bookmark"} size={11} color="#fff" />
          <Text style={ss.statusBadgeText}>
            {watching ? t.currentlyWatching : t.planToWatch}
          </Text>
        </PosterPill>
      }
      topRight={<PosterCornerBtn icon="close" onPress={() => onRemove(item.href)} />}
      bottomLeft={<MalCardBadge title={item.title} style={{ top: undefined as any, right: undefined as any, bottom: 8, left: 8 }} />}
      bottomRight={<CompletionBadge hrefs={[item.href]} titles={[item.title]} />}
      centerOverlay={
        <View style={ss.playHint}>
          <Ionicons name="play" size={14} color="#fff" />
        </View>
      }
    />
  );
});

const ss = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  // Collection header — cohesive surface on the opaque canvas, softly lifted
  // over the scrolling grid (matches the search console for cross-tab coherence).
  headerSurface: {
    backgroundColor: C.bg, zIndex: 10,
    shadowColor: "#000", shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 6,
  },
  headerEdge: { height: 0.5, backgroundColor: C.line },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: S.paddingContent, paddingTop: 16, paddingBottom: 8,
  },
  headerTitleWrap: { flex: 1, marginRight: 12 },
  heading: {
    ...TAr.h1, color: C.bone,
  },
  userEmail: { color: C.textMuted, fontSize: 11, marginTop: 2, fontFamily: "Cairo_500Medium", maxWidth: 200 },
  // 44px touch target (PRODUCT.md ≥44px floor).
  signOutBtn: {
    width: 44, height: 44, borderRadius: R.circle,
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
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.borderLight,
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
  filterCountActive: { backgroundColor: C.accentSoft },
  filterCountText: { color: C.textMuted, fontSize: 10, fontWeight: "500" },
  filterCountTextActive: { color: C.ember },

  // Play hint (used as centerOverlay on PosterCard)
  playHint: {
    width: 36, height: 36, borderRadius: R.circle,
    backgroundColor: C.ember,
    alignItems: "center", justifyContent: "center",
  },

  // Status badge text (used inside PosterPill)
  statusBadgeText: { color: "#fff", fontSize: 10, fontWeight: "700", fontFamily: "Cairo_600SemiBold" },
});

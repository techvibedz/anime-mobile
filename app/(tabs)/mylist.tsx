import { useState, useCallback, memo } from "react";
import {
  View,
  Text,
  Pressable,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { getFavorites, removeFavorite } from "../../lib/favorites";
import type { FavoriteAnime, FavoriteList } from "../../lib/favorites";
import { MalCardBadge } from "../../components/MalRating";
import { CompletionBadge } from "../../components/CompletionBadge";
import { PosterCard, PosterPill, PosterCornerBtn, INLINE_POSTER_BADGE } from "../../components/PosterCard";
import { CardLayoutControl } from "../../components/CardLayoutControl";
import { useCardLayout, type CardLayout } from "../../lib/cardLayout";
import { StateView } from "../../components/StateView";
import { Rise } from "../../components/Rise";
import { useAuth } from "../../lib/auth";
import { useSidebarActions } from "../../components/Sidebar";
import { C, S, R, TAr } from "../../lib/theme";
import { t } from "../../lib/i18n";

type ListFilter = "all" | FavoriteList;

const PAD = S.paddingContent;
const GAP = S.gapRelaxed;

export default function MyListScreen() {
  const cards = useCardLayout("mylist", GAP);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { openSidebar } = useSidebarActions();
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
          <View style={ss.headerActions}>
          <Pressable accessibilityRole="button" accessibilityLabel={t.menu} onPress={openSidebar} hitSlop={8} style={ss.menuBtn}>
            <Ionicons name="menu" size={20} color={C.text} />
          </Pressable>
          <CardLayoutControl layout={cards.layout} onChange={cards.setLayout} />
          </View>
          <View style={ss.headerTitleWrap}>
            <Text style={ss.heading}>{t.myListTitle}</Text>
            <Text style={ss.userEmail}>{t.currentlyWatching} · {watchingCount}     {t.planToWatch} · {plannedCount}</Text>
          </View>
        </Rise>

        {/* Filter pills — horizontally scrollable so long labels never clip */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={ss.filterScroll}
          contentContainerStyle={ss.filterRow}
        >
          {filters.map((f) => (
            <Pressable key={f.key} accessibilityRole="button" accessibilityState={{ selected: filter === f.key }} onPress={() => setFilter(f.key)}>
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
          primary={{ label: t.discover, icon: "search", onPress: () => router.push("/(tabs)/search") }}
        />
      ) : (
        <FlatList
          key={`${cards.layout}-${cards.columns}`}
          data={visible}
          numColumns={cards.columns}
          keyExtractor={(item) => item.href}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
          initialNumToRender={8}
          maxToRenderPerBatch={6}
          windowSize={7}
          updateCellsBatchingPeriod={50}
          contentContainerStyle={{ padding: PAD, paddingBottom: insets.bottom + 100, rowGap: GAP }}
          columnWrapperStyle={cards.columns > 1 ? { gap: GAP } : undefined}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={C.accent}
              colors={[C.accent]}
              progressBackgroundColor={C.surface}
            />
          }
          renderItem={({ item }) => <MyListCard item={item} onRemove={handleRemove} width={cards.cardWidth} layout={cards.layout} />}
        />
      )}
    </View>
  );
}

/* Memoized poster card — built on the unified <PosterCard>. */
const MyListCard = memo(function MyListCard({
  item,
  onRemove,
  width,
  layout,
}: {
  item: FavoriteAnime;
  onRemove: (href: string) => void;
  width: number;
  layout: CardLayout;
}) {
  const watching = item.list === "watching";
  return (
    <PosterCard
      image={item.image}
      title={item.title}
      onPress={() => router.push(`/anime/${encodeURIComponent(item.href)}`)}
      onLongPress={() => onRemove(item.href)}
      width={width}
      layout={layout}

      recyclingKey={item.href}
      titleLines={2}
      topLeft={(
        <PosterPill>
          <Ionicons name={watching ? "play-circle" : "bookmark"} size={11} color={watching ? C.mint : C.accent} />
          {layout !== "compact" ? <Text style={ss.statusBadgeText}>
            {watching ? t.currentlyWatching : t.planToWatch}
          </Text> : null}
        </PosterPill>
       )}
      topRight={<PosterCornerBtn icon="close" onPress={() => onRemove(item.href)} />}
      bottomLeft={<MalCardBadge title={item.title} style={INLINE_POSTER_BADGE} />}
      bottomRight={<CompletionBadge hrefs={[item.href]} titles={[item.title]} style={INLINE_POSTER_BADGE} />}
      centerOverlay={layout !== "compact" ? (
        <View style={ss.playHint}>
          <Ionicons name="play" size={14} color={C.textOnAccent} />
        </View>
      ) : null}
    />
  );
});

const ss = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  // Collection header — cohesive surface on the opaque canvas, softly lifted
  // over the scrolling grid (matches the search console for cross-tab coherence).
  headerSurface: {
    backgroundColor: C.bg, zIndex: 10,
  },
  headerEdge: { height: 0.5, backgroundColor: C.line },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: S.paddingContent, paddingTop: 16, paddingBottom: 8,
  },
  headerTitleWrap: { flex: 1, marginLeft: 12, alignItems: "flex-end" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  heading: {
    ...TAr.h1, lineHeight: 44, color: C.bone,
  },
  userEmail: { color: C.textMuted, fontSize: 12, lineHeight: 22, marginTop: 4, fontFamily: "Cairo_500Medium", textAlign: "right" },
  // 44px touch target (PRODUCT.md ≥44px floor).
  menuBtn: {
    width: 48, height: 48, borderRadius: R.md,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.borderSoft,
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
    marginHorizontal: 3, height: 48,
    paddingHorizontal: 14, borderRadius: R.sm,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.borderSoft,
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

import { useState, useCallback, memo } from "react";
import {
  View,
  Text,
  Pressable,
  FlatList,
  RefreshControl,
  StyleSheet,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { getFavorites, removeFavorite } from "../../lib/favorites";
import type { FavoriteAnime, FavoriteList } from "../../lib/favorites";
import { MalCardBadge } from "../../components/MalRating";
import { CompletionBadge } from "../../components/CompletionBadge";
import { getCompletedAnime } from "../../lib/completion";
import type { CompletedEntry } from "../../lib/completionMatch";
import { PosterCard, PosterPill, PosterCornerBtn, INLINE_POSTER_BADGE } from "../../components/PosterCard";
import { CardLayoutControl } from "../../components/CardLayoutControl";
import { useCardLayout, type CardLayout } from "../../lib/cardLayout";
import { StateView } from "../../components/StateView";
import { Rise } from "../../components/Rise";
import { RtlRow } from "../../components/RtlRow";
import { useAuth } from "../../lib/auth";
import { useSidebarActions } from "../../components/Sidebar";
import { C, S, R, TAr } from "../../lib/theme";
import { t } from "../../lib/i18n";

// "completed" is automatic — anime whose finale was watched — not a list the
// user files things into, so it lives beside the saved lists, not inside them.
type ListFilter = "all" | FavoriteList | "completed";

const PAD = S.paddingContent;
const GAP = S.gapRelaxed;

export default function MyListScreen() {
  const cards = useCardLayout("mylist", GAP);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { openSidebar } = useSidebarActions();
  const [favorites, setFavorites] = useState<FavoriteAnime[]>([]);
  const [completed, setCompleted] = useState<CompletedEntry[]>([]);
  const [filter, setFilter] = useState<ListFilter>("all");
  const [refreshing, setRefreshing] = useState(false);

  // Favorites first (instant), then the completed shelf, which borrows My List
  // posters for finished anime that fell out of the local watch history.
  const load = useCallback(async () => {
    const favs = await getFavorites();
    setFavorites(favs);
    setCompleted(await getCompletedAnime(favs).catch(() => []));
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const handleRemove = useCallback(async (href: string) => {
    await removeFavorite(href);
    setFavorites((prev) => prev.filter((f) => f.href !== href));
  }, []);

  const watchingCount = favorites.filter((f) => f.list === "watching").length;
  const plannedCount = favorites.filter((f) => f.list === "planned").length;
  const visible = filter === "all" ? favorites : favorites.filter((f) => f.list === filter);
  const showingCompleted = filter === "completed";
  const data: (FavoriteAnime | CompletedEntry)[] = showingCompleted ? completed : visible;
  // The status pill only earns its place when it tells cards apart.
  const showStatus = filter === "all" && watchingCount > 0 && plannedCount > 0;

  const filters: { key: ListFilter; label: string; count: number }[] = [
    { key: "all", label: "الكل", count: favorites.length },
    { key: "watching", label: t.currentlyWatching, count: watchingCount },
    { key: "planned", label: t.planToWatch, count: plannedCount },
    { key: "completed", label: t.completedShelf, count: completed.length },
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
            <Text style={ss.userEmail}>{t.currentlyWatching} · {watchingCount}     {t.planToWatch} · {plannedCount}     {t.completedShelf} · {completed.length}</Text>
          </View>
        </Rise>

        {/* Filter pills — horizontally scrollable so long labels never clip */}
        <RtlRow
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
        </RtlRow>

        {/* Surface bottom edge — separates the header from the scrolling grid */}
        <View style={ss.headerEdge} />
      </View>

      {data.length === 0 ? (
        showingCompleted ? (
          <StateView icon="checkmark-done-outline" variant="empty" title={t.completedEmpty} message={t.completedEmptySub} />
        ) : (
          <StateView
            icon="heart-outline"
            variant="empty"
            title={t.emptyList}
            message={t.emptyListSub}
            primary={{ label: t.discover, icon: "search", onPress: () => router.push("/(tabs)/search") }}
          />
        )
      ) : (
        <FlatList<FavoriteAnime | CompletedEntry>
          key={`${cards.layout}-${cards.columns}-${showingCompleted ? "done" : "list"}`}
          data={data}
          numColumns={cards.columns}
          keyExtractor={(item) => ("key" in item ? `done:${item.key}` : item.href)}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
          initialNumToRender={8}
          maxToRenderPerBatch={6}
          windowSize={7}
          updateCellsBatchingPeriod={50}
          contentContainerStyle={{ padding: PAD, paddingBottom: insets.bottom + 100, rowGap: GAP }}
          columnWrapperStyle={cards.columnWrapperStyle}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={C.accent}
              colors={[C.accent]}
              progressBackgroundColor={C.surface}
            />
          }
          renderItem={({ item }) => ("key" in item
            ? <CompletedCard item={item} width={cards.cardWidth} layout={cards.layout} />
            : <MyListCard item={item} onRemove={handleRemove} width={cards.cardWidth} layout={cards.layout} showStatus={showStatus} />)}
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
  showStatus,
}: {
  item: FavoriteAnime;
  onRemove: (href: string) => void;
  width: number;
  layout: CardLayout;
  showStatus: boolean;
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
      topLeft={showStatus ? (
        <PosterPill>
          <Ionicons name={watching ? "play-circle" : "bookmark"} size={11} color={watching ? C.mint : C.accent} />
          {layout !== "compact" ? <Text style={ss.statusBadgeText}>
            {watching ? t.currentlyWatching : t.planToWatch}
          </Text> : null}
        </PosterPill>
      ) : undefined}
      topRight={<PosterCornerBtn icon="close" size={13} style={ss.removeBtn} label={t.remove} onPress={() => onRemove(item.href)} />}
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

/* Completed shelf card — no remove control (it's derived from what you watched). */
const CompletedCard = memo(function CompletedCard({ item, width, layout }: {
  item: CompletedEntry; width: number; layout: CardLayout;
}) {
  return (
    <PosterCard
      image={item.image}
      title={item.title}
      onPress={() => router.push(`/anime/${encodeURIComponent(item.href)}`)}
      width={width}
      layout={layout}
      recyclingKey={`done:${item.key}`}
      titleLines={2}
      bottomLeft={<MalCardBadge title={item.title} style={INLINE_POSTER_BADGE} />}
      bottomRight={<CompletionBadge hrefs={[item.href]} titles={[item.title]} style={INLINE_POSTER_BADGE} />}
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
    ...TAr.display, fontSize: 30, lineHeight: 44, color: C.bone,
  },
  userEmail: { color: C.textMuted, fontSize: 12, lineHeight: 22, marginTop: 4, fontFamily: "Cairo_500Medium", textAlign: "right" },
  // 44px touch target (PRODUCT.md ≥44px floor).
  menuBtn: {
    width: 48, height: 48, borderRadius: R.circle,
    backgroundColor: "rgba(255,255,255,0.07)", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)",
    alignItems: "center", justifyContent: "center",
  },

  // Filters use margins between horizontally scrolling pills.
  filterScroll: { flexGrow: 0 },
  filterRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: S.paddingContent, paddingVertical: 12,
  },
  filterPill: {
    flexDirection: "row", alignItems: "center", flexShrink: 0,
    marginHorizontal: 3, height: 42,
    paddingHorizontal: 16, borderRadius: R.pill,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.borderSoft,
  },
  filterPillActive: { backgroundColor: C.accent, borderColor: C.accent },
  filterText: { color: C.textSecondary, fontSize: 12, lineHeight: 21, fontWeight: "600", fontFamily: "Cairo_600SemiBold", flexShrink: 0, includeFontPadding: false, textAlignVertical: "center" },
  filterTextActive: { color: C.textOnAccent, fontFamily: "Cairo_700Bold" },
  filterCount: {
    backgroundColor: C.glass, borderRadius: R.circle,
    minWidth: 20, alignItems: "center",
    paddingHorizontal: 6, paddingVertical: 1,
    marginStart: 8,
  },
  filterCountActive: { backgroundColor: "rgba(10,11,18,0.16)" },
  filterCountText: { color: C.textMuted, fontSize: 10, fontWeight: "500" },
  filterCountTextActive: { color: C.textOnAccent },

  // Lighter remove control — hitSlop on PosterCornerBtn keeps a ~44dp target.
  removeBtn: { width: 28, height: 28, borderRadius: R.circle, backgroundColor: "rgba(0,0,0,0.5)" },

  // Play hint (used as centerOverlay on PosterCard)
  playHint: {
    width: 36, height: 36, borderRadius: R.circle,
    backgroundColor: C.ember,
    alignItems: "center", justifyContent: "center",
  },

  // Status badge text (used inside PosterPill)
  statusBadgeText: { color: "#fff", fontSize: 10, fontWeight: "700", fontFamily: "Cairo_600SemiBold" },
});

// Upcoming anime, loaded a page at a time so the full not-yet-released catalogue
// remains scrollable. Cards open the metadata detail page before release.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, FlatList, RefreshControl, ActivityIndicator, Dimensions, StyleSheet } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { fetchUpcomingAnimePage, sortUpcomingAnime, type CatalogAnime } from "../lib/seasons";
import { CatalogCard, type CatalogCardData } from "../components/CatalogCard";
import { C, S, R, ELEVATION_CARD } from "../lib/theme";
import { t } from "../lib/i18n";
import { Aurora, ScreenHeader, OfflineNotice } from "../components/ScreenChrome";
import { useOnlineStatus } from "../lib/net";

type SortMode = "popular" | "soon";

const { width: SCREEN_W } = Dimensions.get("window");
const PAD = S.paddingContent;
const GAP = S.gapRelaxed;
const NUM_COLS = 3;
const CARD_W = (SCREEN_W - PAD * 2 - GAP * (NUM_COLS - 1)) / NUM_COLS;

const DAY = 24 * 60 * 60;

function badgeFor(item: CatalogAnime): string {
  if (!item.startAt) return t.upcomingSoon;
  const days = Math.ceil((item.startAt - Date.now() / 1000) / DAY);
  if (days <= 0) return t.upcomingSoon;
  return t.upcomingInDays(days);
}

function toCard(item: CatalogAnime): CatalogCardData {
  return { id: item.id, title: item.title, image: item.image, score: item.score, badge: badgeFor(item) };
}

// Map a card back to its source item by id so the tap can open the AniList
// detail page with the poster passed through for an instant first paint.
function makeOpener(items: CatalogAnime[]) {
  const byId = new Map(items.map((i) => [i.id, i]));
  return (c: CatalogCardData) => {
    const it = byId.get(c.id);
    router.push({
      pathname: `/title/${c.id}`,
      params: {
        title: encodeURIComponent(it?.title || c.title),
        img: it?.image ? encodeURIComponent(it.image) : "",
        kitsu: it?.kitsuId ? String(it.kitsuId) : "",
      },
    });
  };
}

export default function UpcomingScreen() {
  const insets = useSafeAreaInsets();
  const { online } = useOnlineStatus();
  const [items, setItems] = useState<CatalogAnime[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const loadingMoreRef = useRef(false);
  // Default to "most popular" — the filter the user asked for.
  const [sort, setSort] = useState<SortMode>("popular");

  const load = useCallback(async () => {
    try {
      const result = await fetchUpcomingAnimePage(1);
      setItems(result.items);
      setPage(1);
      setHasMore(result.hasNext);
    } catch {
      setItems([]);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore || items === null) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const nextPage = page + 1;
    try {
      const result = await fetchUpcomingAnimePage(nextPage);
      if (result.items.length === 0) {
        setHasMore(false);
        return;
      }
      setItems((current) => {
        const seen = new Set((current || []).map((item) => item.id));
        return [...(current || []), ...result.items.filter((item) => !seen.has(item.id))];
      });
      setPage(nextPage);
      setHasMore(result.hasNext);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [hasMore, items, page]);

  const sorted = useMemo(() => (items ? sortUpcomingAnime(items, sort) : []), [items, sort]);

  const openItem = useCallback(
    (c: CatalogCardData) => makeOpener(items ?? [])(c),
    [items],
  );

  const FilterBar = (
    <View style={s.filterRow}>
      {([
        { key: "popular" as SortMode, label: t.upcomingFilterPopular, icon: "flame" as const },
        { key: "soon" as SortMode, label: t.upcomingFilterSoon, icon: "time" as const },
      ]).map((f) => {
        const active = sort === f.key;
        return (
          <Pressable key={f.key} onPress={() => setSort(f.key)} style={[s.filterChip, active && s.filterChipActive]}>
            {active && (
              <LinearGradient colors={[C.accent, C.violet]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            )}
            <Ionicons name={f.icon} size={13} color={active ? C.textOnAccent : C.textSecondary} />
            <Text style={[s.filterText, active && s.filterTextActive]}>{f.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <Aurora />
      <ScreenHeader title={t.upcomingTitle} />

      {items === null ? (
        <View style={s.center}><ActivityIndicator size="large" color={C.accent} /></View>
      ) : (
        <FlatList
          data={sorted}
          numColumns={NUM_COLS}
          keyExtractor={(item) => String(item.id)}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
          initialNumToRender={12}
          maxToRenderPerBatch={9}
          windowSize={7}
          updateCellsBatchingPeriod={50}
          onEndReached={loadMore}
          onEndReachedThreshold={0.6}
          contentContainerStyle={{ paddingHorizontal: PAD, paddingBottom: insets.bottom + 24 }}
          columnWrapperStyle={{ gap: GAP, marginBottom: GAP }}
          ListHeaderComponent={
            <View>
              <Text style={s.intro}>{t.upcomingSub}</Text>
              {FilterBar}
            </View>
          }
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} colors={[C.accent]} progressBackgroundColor={C.surface} />
          }
          ListEmptyComponent={<OfflineNotice offline={online === false} onRetry={onRefresh} />}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={C.accent} style={{ marginVertical: 20 }} /> : null}
          renderItem={({ item }) => <CatalogCard item={toCard(item)} width={CARD_W} onPress={openItem} />}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  intro: {
    color: C.textSecondary, fontSize: 12.5, lineHeight: 19, textAlign: "right",
    fontFamily: "Cairo_500Medium", marginBottom: 12, marginTop: 2,
  },
  filterRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  filterChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: R.pill,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    overflow: "hidden",
  },
  filterChipActive: { borderColor: "transparent", ...ELEVATION_CARD },
  filterText: { color: C.textSecondary, fontSize: 12.5, fontFamily: "Cairo_600SemiBold" },
  filterTextActive: { color: C.textOnAccent, fontFamily: "Cairo_700Bold" },
  empty: { alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 10 },
  emptyIcon: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: C.glass,
    borderWidth: 1, borderColor: C.glassBorder, alignItems: "center", justifyContent: "center", marginBottom: 4,
  },
  emptyTitle: { color: C.text, fontSize: 16, fontFamily: "Cairo_700Bold", textAlign: "center" },
  emptySub: { color: C.textSecondary, fontSize: 13, lineHeight: 20, textAlign: "center", maxWidth: 260, fontFamily: "Cairo_500Medium" },
});

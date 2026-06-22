// Upcoming anime — the most-anticipated titles that haven't aired yet and that
// our sources will pick up once they do. Data is AniList's NOT_YET_RELEASED feed
// (lib/seasons), filtered to non-adult Japanese productions. Because the titles
// aren't released, they can't be source-verified the way the schedule/seasons
// screens are — the popularity sort keeps the list to mainstream anime the
// fansub sites reliably carry. Tapping a card jumps to Discover pre-searched, so
// the viewer is ready the moment it lands.

import { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, FlatList, RefreshControl, ActivityIndicator, Dimensions, StyleSheet } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { fetchUpcomingAnime, type CatalogAnime } from "../lib/seasons";
import { CatalogCard, type CatalogCardData } from "../components/CatalogCard";
import { C, S, R, ELEVATION_CARD } from "../lib/theme";
import { t } from "../lib/i18n";
import { Aurora, ScreenHeader } from "../components/ScreenChrome";

type SortMode = "popular" | "soon";

const { width: SCREEN_W } = Dimensions.get("window");
const PAD = S.paddingContent;
const GAP = S.gapRelaxed;
const NUM_COLS = 3;
const CARD_W = (SCREEN_W - PAD * 2 - GAP * (NUM_COLS - 1)) / NUM_COLS;

const DAY = 24 * 60 * 60;

function badgeFor(item: CatalogAnime): string {
  if (!item.startAt) return t.upcomingSoon;
  const days = Math.round((item.startAt - Date.now() / 1000) / DAY);
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
      },
    });
  };
}

// Most-popular first, or soonest-airing first. Within each mode the secondary
// key keeps the order stable and sensible (popular ties → by date; soon ties →
// by popularity; titles with no announced date sink in "soonest").
function sortItems(items: CatalogAnime[], mode: SortMode): CatalogAnime[] {
  const arr = items.slice();
  if (mode === "popular") {
    arr.sort((a, b) => b.popularity - a.popularity || (a.startAt ?? Infinity) - (b.startAt ?? Infinity));
  } else {
    arr.sort((a, b) => {
      if (a.startAt && b.startAt) return a.startAt - b.startAt || b.popularity - a.popularity;
      if (a.startAt) return -1;
      if (b.startAt) return 1;
      return b.popularity - a.popularity;
    });
  }
  return arr;
}

export default function UpcomingScreen() {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<CatalogAnime[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Default to "most popular" — the filter the user asked for.
  const [sort, setSort] = useState<SortMode>("popular");

  const load = useCallback(async () => {
    try {
      setItems(await fetchUpcomingAnime());
    } catch {
      setItems([]);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  const sorted = useMemo(() => (items ? sortItems(items, sort) : []), [items, sort]);

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
          ListEmptyComponent={
            <View style={s.empty}>
              <View style={s.emptyIcon}><Ionicons name="cloud-offline-outline" size={32} color={C.accent} /></View>
              <Text style={s.emptyTitle}>{t.scheduleError}</Text>
              <Text style={s.emptySub}>{t.scheduleErrorSub}</Text>
            </View>
          }
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

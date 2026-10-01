// Full grid for a source-direct home rail ("this season" / "movies"). Reads the
// source's own listing (lib/sourceRails) — one cheap GET, cached 12h — and shows
// the whole list. Each card carries its real source URL, so tapping opens the
// anime detail page directly (no AniList, no per-tap resolution). Mirrors the
// seasons screen's grid structure.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, FlatList, RefreshControl, ActivityIndicator, StyleSheet,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getRail, type RailItem, type RailKind } from "../../lib/sourceRails";
import { CatalogCard, type CatalogCardData } from "../../components/CatalogCard";
import { C, S, R } from "../../lib/theme";
import { t } from "../../lib/i18n";
import { Aurora, ScreenHeader, OfflineNotice } from "../../components/ScreenChrome";
import { useOnlineStatus } from "../../lib/net";
import { CardLayoutControl } from "../../components/CardLayoutControl";
import { useCardLayout } from "../../lib/cardLayout";

const PAD = S.paddingContent;
const GAP = S.gapRelaxed;

const VALID: RailKind[] = ["movies", "season"];

function titleFor(kind: RailKind): string {
  return kind === "movies" ? t.railMovies : t.railThisSeason;
}

function toCard(item: RailItem): CatalogCardData {
  return { id: item.id, title: item.title, image: item.image, score: null, badge: null, href: item.href };
}

export default function PopularScreen() {
  const cards = useCardLayout("popular", GAP);
  const insets = useSafeAreaInsets();
  const { online } = useOnlineStatus();
  const { kind: kindParam, title: titleParam } = useLocalSearchParams<{ kind: string; title?: string }>();
  const kind: RailKind = (VALID.includes(kindParam as RailKind) ? kindParam : "season") as RailKind;
  const heading = titleParam ? decodeURIComponent(titleParam) : titleFor(kind);

  const [items, setItems] = useState<RailItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);

  const load = useCallback(() => {
    mounted.current = true;
    getRail(kind)
      .then((res) => { if (mounted.current) setItems(res); })
      .catch(() => { if (mounted.current) setItems([]); })
      .finally(() => { if (mounted.current) setRefreshing(false); });
  }, [kind]);

  useEffect(() => { load(); return () => { mounted.current = false; }; }, [load]);

  const onRefresh = useCallback(() => { setRefreshing(true); setItems(null); load(); }, [load]);

  // Stable card objects + renderItem: toCard used to allocate a new object on
  // every render, so CatalogCard's memo never hit and every mounted card
  // re-rendered on any parent state change (online status, refresh, resize).
  const data = useMemo(() => (items ?? []).map(toCard), [items]);
  const renderItem = useCallback(
    ({ item }: { item: CatalogCardData }) => (
      <CatalogCard
        item={item}
        width={cards.cardWidth}
        layout={cards.layout}
        onPress={() => { if (item.href) router.push(`/anime/${encodeURIComponent(item.href)}`); }}
      />
    ),
    [cards.cardWidth, cards.layout],
  );
  const listHeader = useMemo(
    () => (
      <View style={s.listHead}>
        <Text style={s.listHeadCount}>{t.scheduleCount(data.length)}</Text>
      </View>
    ),
    [data.length],
  );

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <Aurora />
      <ScreenHeader title={heading} right={<CardLayoutControl layout={cards.layout} onChange={cards.setLayout} />} />

      {items === null ? (
        <View style={s.center}><ActivityIndicator size="large" color={C.accent} /></View>
      ) : (
        <FlatList
          key={`${cards.layout}-${cards.columns}`}
          data={data}
          numColumns={cards.columns}
          keyExtractor={(item) => String(item.id)}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
          initialNumToRender={12}
          maxToRenderPerBatch={9}
          windowSize={7}
          updateCellsBatchingPeriod={50}
          contentContainerStyle={{ paddingHorizontal: PAD, paddingBottom: insets.bottom + 24, paddingTop: 4, rowGap: GAP }}
          columnWrapperStyle={cards.columns > 1 ? { gap: GAP } : undefined}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} colors={[C.accent]} progressBackgroundColor={C.surface} />
          }
          ListHeaderComponent={listHeader}
          ListEmptyComponent={<OfflineNotice offline={online === false} onRetry={onRefresh} />}
          renderItem={renderItem}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  listHead: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", marginBottom: 14, marginTop: 2 },
  listHeadCount: {
    color: C.textSecondary, fontSize: 14, fontFamily: "Cairo_600SemiBold",
    paddingVertical: 8,
  },
  empty: { alignItems: "center", justifyContent: "center", paddingTop: 70, gap: 10 },
  emptyIcon: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: C.glass,
    borderWidth: 1, borderColor: C.glassBorder, alignItems: "center", justifyContent: "center", marginBottom: 4,
  },
  emptyTitle: { color: C.text, fontSize: 16, fontFamily: "Cairo_700Bold", textAlign: "center" },
  emptySub: { color: C.textSecondary, fontSize: 13, lineHeight: 20, textAlign: "center", maxWidth: 260, fontFamily: "Cairo_500Medium" },
});

// Full grid for a source-direct home rail ("this season" / "movies"). Reads the
// source's own listing (lib/sourceRails) — one cheap GET, cached 12h — and shows
// the whole list. Each card carries its real source URL, so tapping opens the
// anime detail page directly (no AniList, no per-tap resolution). Mirrors the
// seasons screen's grid structure.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, FlatList, RefreshControl, ActivityIndicator, Dimensions, StyleSheet,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { getRail, type RailItem, type RailKind } from "../../lib/sourceRails";
import { CatalogCard, type CatalogCardData } from "../../components/CatalogCard";
import { C, S, R } from "../../lib/theme";
import { t } from "../../lib/i18n";
import { Aurora, ScreenHeader } from "../../components/ScreenChrome";

const { width: SCREEN_W } = Dimensions.get("window");
const PAD = S.paddingContent;
const GAP = S.gapRelaxed;
const NUM_COLS = 3;
const CARD_W = (SCREEN_W - PAD * 2 - GAP * (NUM_COLS - 1)) / NUM_COLS;

const VALID: RailKind[] = ["movies", "season"];

function titleFor(kind: RailKind): string {
  return kind === "movies" ? t.railMovies : t.railThisSeason;
}

function toCard(item: RailItem): CatalogCardData {
  return { id: item.id, title: item.title, image: item.image, score: null, badge: null, href: item.href };
}

export default function PopularScreen() {
  const insets = useSafeAreaInsets();
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

  const data = items ?? [];

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <Aurora />
      <ScreenHeader title={heading} />

      {items === null ? (
        <View style={s.center}><ActivityIndicator size="large" color={C.accent} /></View>
      ) : (
        <FlatList
          data={data}
          numColumns={NUM_COLS}
          keyExtractor={(item) => String(item.id)}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
          initialNumToRender={12}
          maxToRenderPerBatch={9}
          windowSize={7}
          updateCellsBatchingPeriod={50}
          contentContainerStyle={{ paddingHorizontal: PAD, paddingBottom: insets.bottom + 24, paddingTop: 4 }}
          columnWrapperStyle={{ gap: GAP, marginBottom: GAP }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} colors={[C.accent]} progressBackgroundColor={C.surface} />
          }
          ListHeaderComponent={
            <View style={s.listHead}>
              <Text style={s.listHeadCount}>{t.scheduleCount(data.length)}</Text>
            </View>
          }
          ListEmptyComponent={
            <View style={s.empty}>
              <View style={s.emptyIcon}><Ionicons name="flame-outline" size={30} color={C.textMuted} /></View>
              <Text style={s.emptyTitle}>{t.scheduleError}</Text>
              <Text style={s.emptySub}>{t.scheduleErrorSub}</Text>
            </View>
          }
          renderItem={({ item }) => (
            <CatalogCard
              item={toCard(item)}
              width={CARD_W}
              onPress={() => router.push(`/anime/${encodeURIComponent(item.href)}`)}
            />
          )}
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
    color: C.accent, fontSize: 12, fontFamily: "Cairo_600SemiBold",
    backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.borderAccent,
    borderRadius: R.pill, paddingHorizontal: 10, paddingVertical: 3, overflow: "hidden",
  },
  empty: { alignItems: "center", justifyContent: "center", paddingTop: 70, gap: 10 },
  emptyIcon: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: C.glass,
    borderWidth: 1, borderColor: C.glassBorder, alignItems: "center", justifyContent: "center", marginBottom: 4,
  },
  emptyTitle: { color: C.text, fontSize: 16, fontFamily: "Cairo_700Bold", textAlign: "center" },
  emptySub: { color: C.textSecondary, fontSize: 13, lineHeight: 20, textAlign: "center", maxWidth: 260, fontFamily: "Cairo_500Medium" },
});

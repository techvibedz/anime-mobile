// Seasons browser — pick a season (current + the previous ones) and see the
// anime that aired that season. Data is AniList's per-season catalogue
// (lib/seasons), filtered to non-adult Japanese productions, then verified
// against our own sources (witanime / anime4up / anime3rb) so the grid only ever
// shows titles the app can actually open — same availability check the schedule
// screen uses. Rows stream in as each is confirmed; a slow/unreachable source
// falls back to the unfiltered list rather than a misleading empty screen.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, Pressable, FlatList, ScrollView, RefreshControl,
  StyleSheet,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { fetchSeasonAnime, seasonOptions, type CatalogAnime } from "../lib/seasons";
import { CatalogCard, type CatalogCardData } from "../components/CatalogCard";
import { C, S, R, ELEVATION_CARD } from "../lib/theme";
import { t } from "../lib/i18n";
import { Aurora, ScreenHeader, OfflineNotice } from "../components/ScreenChrome";
import { Shimmer } from "../components/Shimmer";
import { useOnlineStatus } from "../lib/net";
import { CardLayoutControl } from "../components/CardLayoutControl";
import { useCardLayout } from "../lib/cardLayout";

const PAD = S.paddingContent;
const GAP = S.gapRelaxed;

function toCard(item: CatalogAnime): CatalogCardData {
  return { id: item.id, title: item.title, image: item.image, score: item.score, badge: item.format, href: item.sourceHref };
}

export default function SeasonsScreen() {
  const cards = useCardLayout("seasons", GAP);
  const insets = useSafeAreaInsets();
  const { online } = useOnlineStatus();
  const options = useMemo(() => seasonOptions(8), []);
  const [selected, setSelected] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  const [itemsByKey, setItemsByKey] = useState<Record<string, CatalogAnime[]>>({});

  const active = options[selected];
  const key = `${active.season}-${active.year}`;

  useEffect(() => {
    if (itemsByKey[key]) return;
    let cancelled = false;
    setError(false);
    fetchSeasonAnime(active.season, active.year)
      .then((rows) => {
        if (cancelled) return;
        if (rows.length === 0) setError(true);
        else setItemsByKey((p) => ({ ...p, [key]: rows }));
      })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [active.season, active.year, itemsByKey, key]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setError(false);
    try {
      const rows = await fetchSeasonAnime(active.season, active.year);
      if (rows.length === 0) setError(true);
      else setItemsByKey((p) => ({ ...p, [key]: rows }));
    } catch {
      setError(true);
    } finally {
      setRefreshing(false);
    }
  }, [active.season, active.year, key]);

  const openItem = useCallback(
    (c: CatalogCardData) => router.push(`/(tabs)/search?q=${encodeURIComponent(c.title)}`),
    [],
  );

  const items = itemsByKey[key];
  const showSkeleton = items === undefined && !error;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <Aurora />
      <ScreenHeader title={t.seasonsTitle} right={<CardLayoutControl layout={cards.layout} onChange={cards.setLayout} />} />

      {/* Season selector rail */}
      <View style={s.railWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.rail}>
          {options.map((o, i) => {
            const act = i === selected;
            return (
              <Pressable key={`${o.season}-${o.year}`} onPress={() => setSelected(i)}>
                <View style={[s.pill, act && s.pillActive]}>
                  {act && (
                    <LinearGradient colors={[C.accent, C.violet]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
                  )}
                  <Text style={[s.pillText, act && s.pillTextActive]}>{o.label}</Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <FlatList
        key={`${cards.layout}-${cards.columns}`}
        data={items ?? []}
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
        ListHeaderComponent={
          <View style={s.listHead}>
            <Text style={s.listHeadTitle}>{active.label}</Text>
            <Text style={s.listHeadCount}>{t.scheduleCount(items?.length ?? 0)}</Text>
          </View>
        }
        ListEmptyComponent={
          showSkeleton ? (
            <View style={s.skeletonGrid}>
              {Array.from({ length: 12 }).map((_, i) => (
                <Shimmer key={i} style={{ width: cards.cardWidth, height: cards.layout === "list" ? 150 : cards.cardWidth * 1.5, marginBottom: GAP }} borderRadius={R.lg} />
              ))}
            </View>
          ) : error ? (
            <OfflineNotice offline={online === false} onRetry={onRefresh} />
          ) : (
            <View style={s.empty}>
              <View style={s.emptyIcon}><Ionicons name="albums-outline" size={30} color={C.textMuted} /></View>
              <Text style={s.emptyTitle}>{t.seasonsEmpty}</Text>
              <Text style={s.emptySub}>{t.seasonsEmptySub}</Text>
            </View>
          )
        }
        renderItem={({ item }) => <CatalogCard item={toCard(item)} width={cards.cardWidth} layout={cards.layout} onPress={openItem} />}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  railWrap: { paddingBottom: 24 },
  rail: { paddingHorizontal: PAD, gap: 8 },
  pill: {
    minHeight: 48, paddingHorizontal: 18, paddingVertical: 10, borderRadius: R.md,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.borderSoft,
    overflow: "hidden", alignItems: "center", justifyContent: "center",
  },
  pillActive: { borderColor: "transparent" },
  pillText: { color: C.textSecondary, fontSize: 13, fontFamily: "Cairo_600SemiBold" },
  pillTextActive: { color: C.textOnAccent, fontFamily: "Cairo_700Bold" },

  listHead: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginBottom: 14, marginTop: 2,
  },
  listHeadTitle: { color: C.text, fontSize: 18, fontFamily: "Cairo_700Bold" },
  listHeadCount: {
    color: C.accent, fontSize: 12, fontFamily: "Cairo_600SemiBold",
    backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.borderAccent,
    borderRadius: R.pill, paddingHorizontal: 10, paddingVertical: 3, overflow: "hidden",
  },

  skeletonGrid: { flexDirection: "row", flexWrap: "wrap", gap: GAP },

  empty: { alignItems: "center", justifyContent: "center", paddingTop: 70, gap: 10 },
  emptyIcon: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: C.glass,
    borderWidth: 1, borderColor: C.glassBorder, alignItems: "center", justifyContent: "center", marginBottom: 4,
  },
  emptyTitle: { color: C.text, fontSize: 16, fontFamily: "Cairo_700Bold", textAlign: "center" },
  emptySub: { color: C.textSecondary, fontSize: 13, lineHeight: 20, textAlign: "center", maxWidth: 260, fontFamily: "Cairo_500Medium" },
});

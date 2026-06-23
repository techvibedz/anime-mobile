// Seasons browser — pick a season (current + the previous ones) and see the
// anime that aired that season. Data is AniList's per-season catalogue
// (lib/seasons), filtered to non-adult Japanese productions, then verified
// against our own sources (witanime / anime4up / anime3rb) so the grid only ever
// shows titles the app can actually open — same availability check the schedule
// screen uses. Rows stream in as each is confirmed; a slow/unreachable source
// falls back to the unfiltered list rather than a misleading empty screen.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, Pressable, FlatList, ScrollView, RefreshControl,
  ActivityIndicator, Dimensions, StyleSheet,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { fetchSeasonAnime, seasonOptions, type CatalogAnime } from "../lib/seasons";
import { filterAvailableItems } from "../lib/schedule";
import { CatalogCard, type CatalogCardData } from "../components/CatalogCard";
import { C, S, R, ELEVATION_CARD } from "../lib/theme";
import { t } from "../lib/i18n";
import { Aurora, ScreenHeader, OfflineNotice } from "../components/ScreenChrome";
import { useOnlineStatus } from "../lib/net";

const { width: SCREEN_W } = Dimensions.get("window");
const PAD = S.paddingContent;
const GAP = S.gapRelaxed;
const NUM_COLS = 3;
const CARD_W = (SCREEN_W - PAD * 2 - GAP * (NUM_COLS - 1)) / NUM_COLS;

function toCard(item: CatalogAnime): CatalogCardData {
  return { id: item.id, title: item.title, image: item.image, score: item.score, badge: item.format };
}

export default function SeasonsScreen() {
  const insets = useSafeAreaInsets();
  const { online } = useOnlineStatus();
  const options = useMemo(() => seasonOptions(8), []);
  const [selected, setSelected] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  // Raw (JP-filtered) catalogue per season, and the source-verified subset.
  const [rawByKey, setRawByKey] = useState<Record<string, CatalogAnime[]>>({});
  const [availByKey, setAvailByKey] = useState<Record<string, CatalogAnime[]>>({});
  const [partial, setPartial] = useState<CatalogAnime[]>([]);
  const [verifyingKey, setVerifyingKey] = useState<string | null>(null);

  const active = options[selected];
  const key = `${active.season}-${active.year}`;

  const verify = useCallback((force = false) => {
    const opt = options[selected];
    const k = `${opt.season}-${opt.year}`;
    if (!force && availByKey[k]) return () => {};
    let cancelled = false;
    setError(false);
    setPartial([]);
    setVerifyingKey(k);
    (async () => {
      let raw = force ? undefined : rawByKey[k];
      if (!raw) {
        raw = await fetchSeasonAnime(opt.season, opt.year).catch(() => [] as CatalogAnime[]);
        if (cancelled) return;
        setRawByKey((p) => ({ ...p, [k]: raw! }));
      }
      if (raw.length === 0) {
        if (!cancelled) { setError(true); setVerifyingKey((v) => (v === k ? null : v)); }
        return;
      }
      // Stream verified rows in; cap the wait so a flaky source can't hang it.
      const deadline = new Promise<CatalogAnime[] | null>((r) => setTimeout(() => r(null), 12000));
      const avail = await Promise.race([
        filterAvailableItems(raw, (soFar) => { if (!cancelled) setPartial(soFar); }),
        deadline,
      ]);
      if (cancelled) return;
      // A timeout (null) or an all-empty result on a non-empty season means the
      // sources were unreachable — show the raw list rather than a blank screen.
      const result = !avail || (avail.length === 0 && raw.length > 0) ? raw : avail;
      setAvailByKey((p) => ({ ...p, [k]: result }));
      setVerifyingKey((v) => (v === k ? null : v));
    })();
    return () => { cancelled = true; };
  }, [options, selected, availByKey, rawByKey]);

  // Verify the selected season the first time it's viewed.
  useEffect(() => verify(), [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    const k = key;
    setAvailByKey((p) => { const n = { ...p }; delete n[k]; return n; });
    setRawByKey((p) => { const n = { ...p }; delete n[k]; return n; });
    const cleanup = verify(true);
    setRefreshing(false);
    return cleanup;
  }, [key, verify]);

  const openItem = useCallback((c: CatalogCardData) => {
    // Defer one frame so the card's press feedback paints before the search-tab
    // navigation + its cross-source scrape take over the JS thread.
    requestAnimationFrame(() => router.push(`/(tabs)/search?q=${encodeURIComponent(c.title)}`));
  }, []);

  const verifying = verifyingKey === key && !availByKey[key];
  // Show the AniList catalogue the INSTANT it lands (≈1s) instead of holding a
  // blank grid for the up-to-12s per-title source verification. Verification
  // still runs in the background and swaps in the availability-filtered subset
  // when it completes (`availByKey`); the raw list is the fast first paint.
  const items = availByKey[key] ?? rawByKey[key] ?? (verifying ? partial : undefined);

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <Aurora />
      <ScreenHeader title={t.seasonsTitle} />

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
        data={items ?? []}
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
            <Text style={s.listHeadTitle}>{active.label}</Text>
            <Text style={s.listHeadCount}>{t.scheduleCount(items?.length ?? 0)}</Text>
          </View>
        }
        ListFooterComponent={
          verifying ? (
            <View style={s.footerCheck}>
              <ActivityIndicator size="small" color={C.accent} />
              <Text style={s.footerCheckText}>{t.scheduleChecking}</Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          verifying ? null : error ? (
            <OfflineNotice offline={online === false} onRetry={onRefresh} />
          ) : (
            <View style={s.empty}>
              <View style={s.emptyIcon}><Ionicons name="albums-outline" size={30} color={C.textMuted} /></View>
              <Text style={s.emptyTitle}>{t.seasonsEmpty}</Text>
              <Text style={s.emptySub}>{t.seasonsEmptySub}</Text>
            </View>
          )
        }
        renderItem={({ item }) => <CatalogCard item={toCard(item)} width={CARD_W} onPress={openItem} />}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  railWrap: { paddingBottom: 10 },
  rail: { paddingHorizontal: PAD, gap: 8 },
  pill: {
    paddingHorizontal: 16, paddingVertical: 9, borderRadius: R.pill,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    overflow: "hidden", alignItems: "center", justifyContent: "center",
  },
  pillActive: { borderColor: "transparent", ...ELEVATION_CARD },
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

  footerCheck: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 18 },
  footerCheckText: { color: C.textSecondary, fontSize: 12, fontFamily: "Cairo_500Medium" },

  empty: { alignItems: "center", justifyContent: "center", paddingTop: 70, gap: 10 },
  emptyIcon: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: C.glass,
    borderWidth: 1, borderColor: C.glassBorder, alignItems: "center", justifyContent: "center", marginBottom: 4,
  },
  emptyTitle: { color: C.text, fontSize: 16, fontFamily: "Cairo_700Bold", textAlign: "center" },
  emptySub: { color: C.textSecondary, fontSize: 13, lineHeight: 20, textAlign: "center", maxWidth: 260, fontFamily: "Cairo_500Medium" },
});

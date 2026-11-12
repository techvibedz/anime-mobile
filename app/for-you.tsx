// "مقترح لك حسب ذوقك" — taste-based recommendations.
//
// Built from what the user actually does: shows they finished or binged pull
// their genres/themes/length up, shows they dropped after a few episodes pull
// them down. Every pick explains itself. Filters and "not interested" re-rank
// locally; the full recompute runs in the background (lib/taste).

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { openAniListEntry } from "../components/AniListPosterCard";
import { RtlRow } from "../components/RtlRow";
import { arFormat, arGenre, arTag } from "../lib/anilistLabels";
import { posterUrl } from "../lib/img";
import { C, R } from "../lib/theme";
import { t } from "../lib/i18n";
import {
  computeTaste,
  hideRecommendation,
  preferredLength,
  readTasteBundle,
  topAffinities,
  unhideRecommendation,
  viewFromBundle,
  type ScoredCandidate,
  type TasteBundle,
  type TasteFilter,
  type TastePhase,
  type TasteReason,
  type TasteView,
} from "../lib/taste";

const FILTERS: { key: TasteFilter; label: string }[] = [
  { key: "all", label: t.tasteFilterAll },
  { key: "short", label: t.tasteFilterShort },
  { key: "finished", label: t.tasteFilterFinished },
  { key: "movie", label: t.tasteFilterMovie },
  { key: "airing", label: t.tasteFilterAiring },
];

export function reasonText(r: TasteReason): string | null {
  switch (r.kind) {
    case "because": return t.tasteBecause(r.verdict, r.seed);
    case "genres": return t.tasteReasonGenres(r.genres.map(arGenre));
    case "theme": {
      const label = arTag(r.tag);
      return label ? t.tasteReasonTheme(label) : null;
    }
    case "length": return t.tasteReasonLength(r.bucket);
    case "studio": return t.tasteReasonStudio(r.studio);
    case "acclaimed": return t.tasteReasonAcclaimed((r.score / 10).toFixed(1));
  }
}

const REASON_ICON: Record<TasteReason["kind"], keyof typeof Ionicons.glyphMap> = {
  because: "heart",
  genres: "pricetags",
  theme: "color-wand",
  length: "time",
  studio: "film",
  acclaimed: "star",
};

export default function ForYouScreen() {
  const insets = useSafeAreaInsets();
  const [bundle, setBundle] = useState<TasteBundle | null>(null);
  const [view, setView] = useState<TasteView | null>(null);
  const [filter, setFilter] = useState<TasteFilter>("all");
  const [phase, setPhase] = useState<TastePhase | null>("reading");
  const [empty, setEmpty] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [undo, setUndo] = useState<ScoredCandidate | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rerank = useCallback(async (b: TasteBundle, f: TasteFilter) => {
    setView(await viewFromBundle(b, f));
  }, []);

  const recompute = useCallback(async (force: boolean) => {
    const b = await computeTaste({ force, onPhase: (p) => setPhase(p === "done" ? null : p) });
    setPhase(null);
    if (!b) {
      setBundle((cur) => {
        if (!cur) setEmpty(true);
        return cur;
      });
      return;
    }
    setEmpty(false);
    setBundle(b);
  }, []);

  // Cached bundle first (instant), then a background refresh.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const cached = await readTasteBundle();
      if (!alive) return;
      if (cached) {
        setBundle(cached);
        setPhase(null);
      }
      await recompute(false);
    })();
    return () => { alive = false; };
  }, [recompute]);

  useEffect(() => {
    if (bundle) void rerank(bundle, filter);
  }, [bundle, filter, rerank]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await recompute(true);
    setRefreshing(false);
  }, [recompute]);

  const onHide = useCallback(async (item: ScoredCandidate) => {
    await hideRecommendation(item.media);
    if (bundle) await rerank(bundle, filter);
    setUndo(item);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), 5000);
  }, [bundle, filter, rerank]);

  const onUndo = useCallback(async () => {
    if (!undo) return;
    await unhideRecommendation(undo.media.id);
    setUndo(null);
    if (bundle) await rerank(bundle, filter);
  }, [undo, bundle, filter, rerank]);

  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);

  const renderItem = useCallback(
    ({ item }: { item: ScoredCandidate }) => <RecRow item={item} onHide={onHide} />,
    [onHide],
  );

  const header = (
    <View>
      {view && <TasteDNA view={view} />}
      <RtlRow contentContainerStyle={ss.filters} keyboardShouldPersistTaps="handled">
        {FILTERS.map((f) => (
          <Pressable
            key={f.key}
            onPress={() => setFilter(f.key)}
            style={[ss.chip, filter === f.key && ss.chipActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === f.key }}
          >
            <Text style={[ss.chipText, filter === f.key && ss.chipTextActive]}>{f.label}</Text>
          </Pressable>
        ))}
      </RtlRow>
      {phase && bundle && (
        <View style={ss.updating}>
          <ActivityIndicator size="small" color={C.accent} />
          <Text style={ss.updatingText}>{t.tasteUpdating}</Text>
        </View>
      )}
    </View>
  );

  return (
    <View style={[ss.root, { paddingTop: insets.top }]}>
      <View style={ss.header}>
        <Pressable onPress={() => router.back()} style={ss.iconBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel={t.back}>
          <Ionicons name="chevron-forward" size={22} color={C.text} />
        </Pressable>
        <View style={ss.headerText}>
          <Text style={ss.title}>{t.tasteTitle}</Text>
          <Text style={ss.subtitle}>{t.tasteSubtitle}</Text>
        </View>
      </View>

      {!bundle && phase ? (
        <View style={ss.center}>
          <ActivityIndicator size="large" color={C.accent} />
          <Text style={ss.phaseText}>{t.tastePhase(phase)}</Text>
          <Text style={ss.phaseHint}>{t.tasteFirstRunHint}</Text>
        </View>
      ) : !bundle && empty ? (
        <View style={ss.center}>
          <Text style={{ fontSize: 42 }}>🎬</Text>
          <Text style={ss.emptyTitle}>{t.tasteEmptyTitle}</Text>
          <Text style={ss.phaseHint}>{t.tasteEmptyHint}</Text>
          <Pressable onPress={() => router.push("/(tabs)/search")} style={ss.emptyBtn} accessibilityRole="button">
            <Text style={ss.emptyBtnText}>{t.discover}</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={view?.ranked ?? []}
          keyExtractor={(item) => String(item.media.id)}
          renderItem={renderItem}
          ListHeaderComponent={header}
          ListEmptyComponent={view ? <Text style={ss.noMatch}>{t.tasteNoMatch}</Text> : null}
          contentContainerStyle={{ paddingBottom: insets.bottom + 90 }}
          initialNumToRender={6}
          maxToRenderPerBatch={6}
          windowSize={7}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} colors={[C.accent]} progressBackgroundColor={C.surface} />
          }
        />
      )}

      {undo && (
        <View style={[ss.toast, { bottom: insets.bottom + 20 }]}>
          <Text style={ss.toastText} numberOfLines={1}>{t.tasteHidden}</Text>
          <Pressable onPress={onUndo} hitSlop={8} accessibilityRole="button">
            <Text style={ss.toastUndo}>{t.tasteUndo}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

/* ── Taste DNA ─────────────────────────────────────────────────────── */

const TasteDNA = memo(function TasteDNA({ view }: { view: TasteView }) {
  const { profile } = view;
  // Ecchi/Hentai are learned from (for filtering) but never displayed.
  const genres = useMemo(
    () => topAffinities(profile.genres, 8).filter((g) => g.name !== "Ecchi" && g.name !== "Hentai").slice(0, 5),
    [profile],
  );
  const themes = useMemo(
    () => topAffinities(profile.tags, 10).map((x) => arTag(x.name)).filter((x): x is string => !!x).slice(0, 4),
    [profile],
  );
  const avoids = useMemo(() => profile.avoided.slice(0, 3).map(arGenre), [profile]);
  const top = genres[0]?.value || 1;
  const s = profile.stats;
  const length = preferredLength(profile);
  const facts: { icon: keyof typeof Ionicons.glyphMap; text: string }[] = [];
  if (s.finished + s.dropped >= 2) facts.push({ icon: "checkmark-done", text: t.tasteFactCompletion(s.completionRate, s.finished) });
  if (s.dropAt != null && s.dropped >= 2) facts.push({ icon: "exit-outline", text: t.tasteFactDropAt(s.dropAt) });
  if (s.pace >= 1.5) facts.push({ icon: "flash", text: t.tasteFactPace(s.pace) });
  if (length) facts.push({ icon: "time-outline", text: t.tasteFactLength(length) });
  if (avoids.length) facts.push({ icon: "remove-circle-outline", text: t.tasteFactAvoids(avoids) });

  return (
    <View style={ss.dna}>
      <View style={ss.dnaHead}>
        <Ionicons name="finger-print" size={18} color={C.mint} />
        <Text style={ss.dnaTitle}>{t.tasteDnaTitle}</Text>
        <Text style={ss.dnaCount}>{t.tasteDnaBasis(s.analysed)}</Text>
      </View>
      {genres.map((g) => (
        <View key={g.name} style={ss.barRow}>
          <Text style={ss.barLabel} numberOfLines={1}>{arGenre(g.name)}</Text>
          <View style={ss.barTrack}>
            <View style={[ss.barFill, { width: `${Math.max(8, Math.round((g.value / top) * 100))}%` }]} />
          </View>
        </View>
      ))}
      {themes.length > 0 && (
        <View style={ss.themeRow}>
          {themes.map((th) => (
            <View key={th} style={ss.theme}><Text style={ss.themeText}>{th}</Text></View>
          ))}
        </View>
      )}
      {facts.map((f) => (
        <View key={f.text} style={ss.fact}>
          <Ionicons name={f.icon} size={14} color={C.textSecondary} />
          <Text style={ss.factText}>{f.text}</Text>
        </View>
      ))}
    </View>
  );
});

/* ── Recommendation row ────────────────────────────────────────────── */

const RecRow = memo(function RecRow({ item, onHide }: { item: ScoredCandidate; onHide: (i: ScoredCandidate) => void }) {
  const m = item.media;
  const reasons = item.reasons.map((r) => ({ r, text: reasonText(r) })).filter((x): x is { r: TasteReason; text: string } => !!x.text).slice(0, 3);
  const meta = [
    m.seasonYear,
    arFormat(m.format),
    m.format !== "MOVIE" && m.episodes ? t.episodeCount(m.episodes) : null,
    m.averageScore ? `★ ${(m.averageScore / 10).toFixed(1)}` : null,
  ].filter(Boolean).join(" · ");
  const pressScale = useRef(new Animated.Value(1)).current;
  const open = useCallback(() => {
    openAniListEntry({
      anilistId: m.id,
      title: m.title,
      titleEnglish: m.titleEnglish,
      image: m.image,
      format: m.format,
    });
  }, [m]);
  return (
    <Pressable
      onPress={open}
      onPressIn={() => Animated.timing(pressScale, { toValue: 0.98, duration: 90, useNativeDriver: true }).start()}
      onPressOut={() => Animated.timing(pressScale, { toValue: 1, duration: 120, useNativeDriver: true }).start()}
      accessibilityRole="button"
      accessibilityLabel={`${m.title}، ${t.tasteMatch(item.match)}`}
    >
      <Animated.View style={[ss.row, { transform: [{ scale: pressScale }] }]}>
        <View style={ss.posterWrap}>
          {m.image ? (
            <Image source={{ uri: posterUrl(m.image, 110) }} style={ss.poster} contentFit="cover" cachePolicy="memory-disk" transition={150} recyclingKey={String(m.id)} />
          ) : (
            <View style={[ss.poster, ss.posterEmpty]} />
          )}
          <View style={ss.matchPill}>
            <Text style={ss.matchText}>{item.match}%</Text>
          </View>
        </View>
        <View style={ss.rowBody}>
          <Text style={ss.rowTitle} numberOfLines={2}>{m.title}</Text>
          {meta ? <Text style={ss.rowMeta} numberOfLines={1}>{meta}</Text> : null}
          {reasons.map(({ r, text }) => (
            <View key={r.kind} style={ss.reason}>
              <Ionicons name={REASON_ICON[r.kind]} size={12} color={r.kind === "because" ? C.mint : C.accent} />
              <Text style={ss.reasonText} numberOfLines={2}>{text}</Text>
            </View>
          ))}
        </View>
        <Pressable onPress={() => onHide(item)} hitSlop={10} style={ss.hideBtn} accessibilityRole="button" accessibilityLabel={t.tasteNotInterested}>
          <Ionicons name="eye-off-outline" size={17} color={C.textMuted} />
        </Pressable>
      </Animated.View>
    </Pressable>
  );
});

const ss = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { direction: "ltr", flexDirection: "row-reverse", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10 },
  iconBtn: {
    width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.07)", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)",
  },
  headerText: { flex: 1, alignItems: "flex-end", marginRight: 12 },
  title: { color: C.text, fontSize: 20, lineHeight: 30, fontFamily: "Cairo_700Bold", textAlign: "right" },
  subtitle: { color: C.textMuted, fontSize: 12, fontFamily: "Cairo_500Medium", textAlign: "right" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28 },
  phaseText: { color: C.text, fontSize: 15, fontFamily: "Cairo_700Bold", marginTop: 14, textAlign: "center" },
  phaseHint: { color: C.textMuted, fontSize: 12, lineHeight: 20, fontFamily: "Cairo_500Medium", marginTop: 6, textAlign: "center" },
  emptyTitle: { color: C.text, fontSize: 17, fontFamily: "Cairo_700Bold", marginTop: 12, textAlign: "center" },
  emptyBtn: { marginTop: 16, paddingHorizontal: 22, paddingVertical: 12, borderRadius: R.lg, backgroundColor: C.accent },
  emptyBtnText: { color: C.textOnAccent, fontSize: 14, fontFamily: "Cairo_700Bold" },

  dna: {
    marginHorizontal: 16, marginTop: 4, padding: 16, borderRadius: 20,
    backgroundColor: "rgba(94,234,212,0.05)", borderWidth: 1, borderColor: "rgba(94,234,212,0.22)",
  },
  dnaHead: { direction: "ltr", flexDirection: "row-reverse", alignItems: "center", marginBottom: 10 },
  dnaTitle: { color: C.text, fontSize: 16, fontFamily: "Cairo_700Bold", marginRight: 8, textAlign: "right" },
  dnaCount: { flex: 1, color: C.textMuted, fontSize: 11, fontFamily: "Cairo_500Medium", textAlign: "left" },
  barRow: { direction: "ltr", flexDirection: "row-reverse", alignItems: "center", marginVertical: 3 },
  barLabel: { width: 96, color: C.textSecondary, fontSize: 12, fontFamily: "Cairo_600SemiBold", textAlign: "right" },
  barTrack: {
    flex: 1, height: 8, borderRadius: 4, marginRight: 10, overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.06)", flexDirection: "row-reverse",
  },
  barFill: { height: "100%", borderRadius: 4, backgroundColor: C.mint },
  themeRow: { direction: "ltr", flexDirection: "row-reverse", flexWrap: "wrap", marginTop: 10 },
  theme: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: R.pill, marginLeft: 6, marginBottom: 6,
    backgroundColor: "rgba(139,147,255,0.14)", borderWidth: 1, borderColor: "rgba(139,147,255,0.32)",
  },
  themeText: { color: "#D9DBFF", fontSize: 11, fontFamily: "Cairo_600SemiBold" },
  fact: { direction: "ltr", flexDirection: "row-reverse", alignItems: "center", marginTop: 6 },
  factText: { flex: 1, color: C.textSecondary, fontSize: 12, lineHeight: 19, fontFamily: "Cairo_500Medium", textAlign: "right", marginRight: 8 },

  filters: { paddingHorizontal: 16, paddingVertical: 14 },
  chip: {
    height: 38, justifyContent: "center", paddingHorizontal: 16, borderRadius: R.pill, marginLeft: 8,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.borderSoft,
  },
  chipActive: { backgroundColor: C.accent, borderColor: C.accent },
  chipText: { color: C.textSecondary, fontSize: 13, fontFamily: "Cairo_600SemiBold" },
  chipTextActive: { color: C.textOnAccent, fontFamily: "Cairo_700Bold" },
  updating: { direction: "ltr", flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", marginBottom: 8 },
  updatingText: { color: C.textMuted, fontSize: 12, fontFamily: "Cairo_500Medium", marginRight: 8 },
  noMatch: { color: C.textMuted, fontSize: 13, fontFamily: "Cairo_500Medium", textAlign: "center", marginTop: 30 },

  row: {
    direction: "ltr", flexDirection: "row-reverse", alignItems: "flex-start",
    marginHorizontal: 16, marginBottom: 12, padding: 10, borderRadius: 18,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.borderSoft,
  },
  posterWrap: { width: 92 },
  poster: { width: 92, height: 132, borderRadius: 12, backgroundColor: C.surfaceLight },
  posterEmpty: { borderWidth: 1, borderColor: C.border },
  matchPill: {
    position: "absolute", left: 6, bottom: 6, paddingHorizontal: 7, paddingVertical: 2, borderRadius: R.pill,
    backgroundColor: "rgba(8,9,12,0.85)", borderWidth: 1, borderColor: "rgba(94,234,212,0.45)",
  },
  matchText: { color: C.mint, fontSize: 11, fontFamily: "Outfit_700Bold" },
  rowBody: { flex: 1, marginRight: 12, alignItems: "flex-end" },
  rowTitle: { color: C.text, fontSize: 15, lineHeight: 22, fontFamily: "Cairo_700Bold", textAlign: "right" },
  rowMeta: { color: C.textMuted, fontSize: 11, fontFamily: "Cairo_500Medium", textAlign: "right", marginTop: 2, marginBottom: 6 },
  reason: { direction: "ltr", flexDirection: "row-reverse", alignItems: "flex-start", marginTop: 4, alignSelf: "stretch" },
  reasonText: { flex: 1, color: C.textSecondary, fontSize: 12, lineHeight: 19, fontFamily: "Cairo_500Medium", textAlign: "right", marginRight: 6 },
  hideBtn: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },

  toast: {
    position: "absolute", left: 16, right: 16, direction: "ltr", flexDirection: "row-reverse", alignItems: "center",
    justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderRadius: 14,
    backgroundColor: "rgba(20,22,30,0.97)", borderWidth: 1, borderColor: C.borderSoft,
  },
  toastText: { flex: 1, color: C.text, fontSize: 13, fontFamily: "Cairo_600SemiBold", textAlign: "right" },
  toastUndo: { color: C.accent, fontSize: 13, fontFamily: "Cairo_700Bold", marginRight: 16 },
});

import { useState, useCallback, useRef, useEffect, memo } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  Dimensions,
  Animated,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { searchAnime, fetchAllAnime, fetchGenre } from "../../lib/api";
import type { SearchResult } from "../../lib/api";
import { MalCardBadge } from "../../components/MalRating";
import { GlassFill } from "../../components/GlassFill";
import { C, S, R, ELEVATION_CARD } from "../../lib/theme";
import { t } from "../../lib/i18n";

const { width: SW } = Dimensions.get("window");
const PAD = S.paddingContent;
const GAP = 10;
const NUM_COLS = 3;
const CARD_W = (SW - PAD * 2 - GAP * (NUM_COLS - 1)) / NUM_COLS;
const CARD_H = CARD_W * (4 / 3);

const GENRE_LABELS: Record<string, string> = {
  All: "الكل",
  Action: "أكشن",
  Adventure: "مغامرة",
  Comedy: "كوميدي",
  Drama: "دراما",
  Fantasy: "خيال",
  Horror: "رعب",
  Mystery: "غموض",
  Romance: "رومانسي",
  "Sci-Fi": "خيال علمي",
  "Slice of Life": "حياة يومية",
  Sports: "رياضي",
  Supernatural: "خارق",
  Thriller: "إثارة",
  Mecha: "ميكا",
  Shounen: "شونين",
  Seinen: "سينين",
};
const GENRES = Object.keys(GENRE_LABELS);

/* ── Skeleton card (pulsing placeholder while the grid loads) ── */
function SkeletonGrid() {
  const pulse = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.8, duration: 700, useNativeDriver: true, isInteraction: false }),
        Animated.timing(pulse, { toValue: 0.35, duration: 700, useNativeDriver: true, isInteraction: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <View style={ss.skeletonWrap}>
      {Array.from({ length: 12 }).map((_, i) => (
        <View key={i} style={{ width: CARD_W }}>
          <Animated.View style={[ss.skeletonCard, { opacity: pulse }]} />
          <Animated.View style={[ss.skeletonLine, { opacity: pulse }]} />
          <Animated.View style={[ss.skeletonLineShort, { opacity: pulse }]} />
        </View>
      ))}
    </View>
  );
}

/* Memoized result card — without this, every visible poster re-rendered on
 * each keystroke (the search-progress strip toggles parent state) and on every
 * pagination append. */
const ResultCard = memo(function ResultCard({ item }: { item: SearchResult }) {
  return (
    <Pressable
      onPress={() => router.push(`/anime/${encodeURIComponent(item.href)}`)}
      style={({ pressed }) => ({ width: CARD_W, opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}
    >
      <View style={ss.resultCard}>
        {item.image ? (
          <Image source={{ uri: item.image }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" recyclingKey={item.href} transition={200} />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: C.surface, alignItems: "center", justifyContent: "center" }]}>
            <Ionicons name="image-outline" size={24} color={C.textMuted} />
          </View>
        )}
        <LinearGradient
          colors={["transparent", "rgba(6,7,26,0.55)"]}
          style={ss.resultGrad}
          pointerEvents="none"
        />
        <MalCardBadge title={item.title} />
        {item.type ? (
          <View style={ss.typeBadge}>
            <Text style={ss.typeBadgeText}>{item.type}</Text>
          </View>
        ) : null}
      </View>
      <Text style={ss.resultTitle} numberOfLines={2}>{item.title}</Text>
    </Pressable>
  );
});

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const { genre: genreParam, q: qParam } = useLocalSearchParams<{ genre?: string; q?: string }>();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [activeGenre, setActiveGenre] = useState("All");
  const [genrePage, setGenrePage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);
  const lastGenreParam = useRef<string | undefined>(undefined);
  const lastQParam = useRef<string | undefined>(undefined);
  const modeRef = useRef<"browse" | "search" | "genre">("browse");
  // Monotonically increasing request id — a slow stale response must never
  // overwrite the results of a newer query the user already typed.
  const reqSeq = useRef(0);

  const loadBrowse = useCallback(async (page = 1) => {
    const seq = ++reqSeq.current;
    if (page === 1 && items.length === 0) setLoading(true);
    else if (page === 1) setSearching(true);
    else setLoadingMore(true);
    try {
      const res = await fetchAllAnime(page);
      if (seq !== reqSeq.current) return; // superseded by a newer request
      if (res.success && res.data.items.length > 0) {
        const newItems: SearchResult[] = res.data.items.map((it) => ({
          title: it.title, href: it.href, image: it.image, type: it.type || undefined,
        }));
        if (page === 1) setItems(newItems);
        else {
          setItems((prev) => {
            const seen = new Set(prev.map((p) => p.href));
            return [...prev, ...newItems.filter((n) => !seen.has(n.href))];
          });
        }
        setHasMore(res.data.hasNext);
        setGenrePage(page);
        // Warm the next page in the background so infinite scroll is instant.
        void fetchAllAnime(page + 1).catch(() => {});
        return;
      }
      // Fallback if all-anime returns nothing
      if (page === 1) {
        const fallback = await fetchGenre("Action", 1);
        if (seq !== reqSeq.current) return;
        if (fallback.success && fallback.data.items.length > 0) {
          setItems(fallback.data.items.map((it: any) => ({
            title: it.title, href: it.href, image: it.image, type: it.type || undefined,
          })));
          setHasMore(fallback.data.hasNext);
          setGenrePage(1);
        }
      }
    } catch {} finally {
      if (seq === reqSeq.current) {
        setLoading(false);
        setSearching(false);
        setLoadingMore(false);
      }
    }
  }, [items.length]);

  const loadGenre = useCallback(async (name: string, page = 1) => {
    const seq = ++reqSeq.current;
    if (page === 1) setSearching(true);
    else setLoadingMore(true);
    try {
      const res = await fetchGenre(name, page);
      if (seq !== reqSeq.current) return;
      if (res.success) {
        const newItems = res.data.items.map((it: any) => ({
          title: it.title, href: it.href, image: it.image, type: it.type || undefined,
        }));
        if (page === 1) setItems(newItems);
        else setItems((prev) => [...prev, ...newItems]);
        setHasMore(res.data.hasNext);
        setGenrePage(page);
        // Prefetch the next genre page too.
        void fetchGenre(name, page + 1).catch(() => {});
      }
    } catch {} finally {
      if (seq === reqSeq.current) {
        setLoading(false);
        setSearching(false);
        setLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => { loadBrowse(); }, []);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      modeRef.current = "browse";
      loadBrowse();
      return;
    }
    modeRef.current = "search";
    const seq = ++reqSeq.current;
    // Keep the current grid visible while searching — a slim progress bar
    // signals activity instead of blanking the whole screen.
    setSearching(true);
    setHasMore(false);
    try {
      // Progressive: witanime results paint almost immediately; anime4up and
      // anime3rb stream in and append without blanking the grid. The seq guard
      // drops any partial from a query the user has already moved past.
      const res = await searchAnime(q.trim(), (partial) => {
        if (seq !== reqSeq.current) return;
        setItems(partial);
        setLoading(false);
      });
      if (seq !== reqSeq.current) return;
      if (res.success) setItems(res.data.results);
      else setItems([]);
    } catch { if (seq === reqSeq.current) setItems([]); }
    finally {
      if (seq === reqSeq.current) { setLoading(false); setSearching(false); }
    }
  }, [loadBrowse]);

  const onChangeText = useCallback((text: string) => {
    setQuery(text);
    if (text.trim() === "") setActiveGenre("All");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Each keystroke costs a full WebView scrape, so wait until the user
    // pauses and has typed something meaningful (≥2 chars).
    if (text.trim() !== "" && text.trim().length < 2) return;
    debounceRef.current = setTimeout(() => doSearch(text), 450);
  }, [doSearch]);

  const handleClear = () => {
    setQuery("");
    setActiveGenre("All");
    modeRef.current = "browse";
    loadBrowse();
    inputRef.current?.focus();
  };

  const handleGenre = useCallback((genre: string) => {
    setActiveGenre(genre);
    setQuery("");
    if (genre === "All") {
      modeRef.current = "browse";
      loadBrowse();
      return;
    }
    modeRef.current = "genre";
    loadGenre(genre, 1);
  }, [loadBrowse, loadGenre]);

  const loadMoreGenre = useCallback(() => {
    if (loadingMore || !hasMore) return;
    if (modeRef.current === "genre") {
      loadGenre(activeGenre, genrePage + 1);
    } else if (modeRef.current === "browse") {
      loadBrowse(genrePage + 1);
    }
  }, [activeGenre, genrePage, loadingMore, hasMore, loadGenre, loadBrowse]);

  useEffect(() => {
    if (genreParam && genreParam !== lastGenreParam.current) {
      lastGenreParam.current = genreParam;
      const decoded = decodeURIComponent(genreParam);
      if (GENRES.includes(decoded)) {
        handleGenre(decoded);
      }
    }
  }, [genreParam, handleGenre]);

  // Deep link from the airing calendar: ?q=<title> pre-fills the search box and
  // runs a search so the viewer can find the just-aired anime on our sources.
  useEffect(() => {
    if (qParam && qParam !== lastQParam.current) {
      lastQParam.current = qParam;
      const decoded = decodeURIComponent(qParam);
      setQuery(decoded);
      setActiveGenre("All");
      modeRef.current = "search";
      doSearch(decoded);
    }
  }, [qParam, doSearch]);

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  // Pull-to-refresh — re-run whichever mode is active (search / genre / browse).
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (modeRef.current === "search" && query.trim()) await doSearch(query);
      else if (modeRef.current === "genre" && activeGenre !== "All") await loadGenre(activeGenre, 1);
      else await loadBrowse(1);
    } finally {
      setRefreshing(false);
    }
  }, [query, activeGenre, doSearch, loadGenre, loadBrowse]);

  const showingSearch = modeRef.current === "search" && query.trim().length > 0;

  return (
    <View style={[ss.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={ss.header}>
        <Text style={ss.heading}>اكتشف</Text>
        {!loading && items.length > 0 && (
          <View style={ss.countPill}>
            <Text style={ss.countPillText}>{items.length}</Text>
          </View>
        )}
      </View>

      {/* Glass search bar */}
      <View style={ss.searchWrap}>
        <View style={[ss.searchBar, searching && ss.searchBarActive]}>
          <GlassFill intensity={16} />
          {searching ? (
            <ActivityIndicator size="small" color={C.accent} />
          ) : (
            <Ionicons name="search" size={18} color={C.textMuted} />
          )}
          <TextInput
            ref={inputRef}
            style={ss.input}
            placeholder={t.searchPlaceholder}
            placeholderTextColor={C.textMuted}
            value={query}
            onChangeText={onChangeText}
            onSubmitEditing={() => { if (debounceRef.current) clearTimeout(debounceRef.current); doSearch(query); }}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            textAlign="right"
          />
          {query.length > 0 && (
            <Pressable onPress={handleClear} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={C.textMuted} />
            </Pressable>
          )}
        </View>
      </View>

      {/* Genre filter chips — fixed container prevents vertical scroll capture */}
      <View style={ss.chipContainer}>
        <ScrollView
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={ss.chipScroll}
          keyboardShouldPersistTaps="handled"
        >
          {GENRES.map((g) => (
            <Pressable key={g} onPress={() => handleGenre(g)}>
              <View style={[ss.chip, activeGenre === g && ss.chipActive]}>
                <Text style={[ss.chipText, activeGenre === g && ss.chipTextActive]}>{GENRE_LABELS[g] || g}</Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Slim progress strip while a search/genre refresh is in flight */}
      <View style={ss.glowLineWrap}>
        <View style={ss.glowLine} />
        {searching && (
          <View style={ss.progressStrip}>
            <LinearGradient
              colors={["transparent", C.accent, "transparent"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
          </View>
        )}
      </View>

      {/* Content */}
      {loading ? (
        <SkeletonGrid />
      ) : items.length > 0 ? (
        <FlatList
          data={items}
          numColumns={NUM_COLS}
          keyExtractor={(item, i) => item.href + i}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
          keyboardShouldPersistTaps="handled"
          initialNumToRender={12}
          maxToRenderPerBatch={9}
          windowSize={7}
          updateCellsBatchingPeriod={50}
          contentContainerStyle={{ padding: PAD, paddingBottom: insets.bottom + 100 }}
          columnWrapperStyle={{ gap: GAP, marginBottom: GAP + 8 }}
          onEndReached={loadMoreGenre}
          onEndReachedThreshold={0.5}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={C.accent}
              colors={[C.accent]}
              progressBackgroundColor={C.surface}
            />
          }
          ListHeaderComponent={showingSearch ? (
            <Text style={ss.resultsLabel}>{`نتائج البحث عن "${query.trim()}"`}</Text>
          ) : null}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={C.accent} style={{ paddingVertical: 20 }} /> : null}
          renderItem={({ item }) => <ResultCard item={item} />}
        />
      ) : (
        <View style={ss.center}>
          <View style={ss.emptyCircle}>
            <Ionicons name="search-outline" size={28} color={C.textMuted} />
          </View>
          <Text style={ss.emptyTitle}>{t.noResults}</Text>
          <Text style={ss.emptyDesc}>{t.searchSub}</Text>
          {showingSearch && (
            <Pressable onPress={handleClear} style={ss.emptyBtn}>
              <Ionicons name="grid-outline" size={14} color={C.accent} />
              <Text style={ss.emptyBtnText}>تصفح كل الأنميات</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const ss = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, paddingBottom: 80 },

  header: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: PAD, paddingTop: 16, paddingBottom: 8,
  },
  heading: {
    color: C.text, fontSize: 26, fontWeight: "700", letterSpacing: -0.4,
    fontFamily: "Cairo_700Bold",
  },
  countPill: {
    backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.borderAccent,
    borderRadius: R.pill, paddingHorizontal: 10, paddingVertical: 3,
  },
  countPillText: { color: C.accent, fontSize: 11, fontWeight: "700", fontFamily: "Outfit_700Bold" },

  // Search bar
  searchWrap: { paddingHorizontal: PAD, paddingBottom: 12 },
  searchBar: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderRadius: R.xxl, height: S.inputHeight, paddingHorizontal: 16,
    overflow: "hidden", borderWidth: 1, borderColor: C.glassBorder,
  },
  searchBarActive: { borderColor: C.borderAccent },
  input: {
    flex: 1, color: C.text, fontSize: 14, height: S.inputHeight,
    fontFamily: "Cairo_500Medium",
  },

  // Chips
  chipContainer: { height: 52, overflow: "visible" },
  chipScroll: { paddingHorizontal: PAD, gap: 8, paddingBottom: 16, alignItems: "center" as const },
  chip: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: R.pill,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
  },
  chipActive: { backgroundColor: C.accent, borderColor: "transparent" },
  chipText: { color: C.textSecondary, fontSize: 13, fontWeight: "600", fontFamily: "Cairo_600SemiBold" },
  chipTextActive: { color: C.textOnAccent },

  // Glow line + progress strip
  glowLineWrap: { height: 2, marginHorizontal: PAD, justifyContent: "center" },
  glowLine: {
    height: 0.5,
    backgroundColor: C.violetGlow,
    shadowColor: C.violet, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.3, shadowRadius: 8,
  },
  progressStrip: { ...StyleSheet.absoluteFillObject, overflow: "hidden", borderRadius: 1 },

  // Results
  resultsLabel: {
    color: C.textSecondary, fontSize: 12, fontWeight: "600",
    fontFamily: "Cairo_600SemiBold", textAlign: "right",
    marginBottom: 12,
  },
  resultCard: {
    width: CARD_W, aspectRatio: 3 / 4, borderRadius: R.lg, overflow: "hidden",
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    ...ELEVATION_CARD,
  },
  resultGrad: { position: "absolute", bottom: 0, left: 0, right: 0, height: 50 },
  typeBadge: {
    position: "absolute", bottom: 6, right: 6,
    backgroundColor: "rgba(0,0,0,0.65)", borderRadius: R.sm,
    paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.1)",
  },
  typeBadgeText: { color: C.textSoft, fontSize: 8, fontWeight: "700", fontFamily: "Cairo_600SemiBold" },
  resultTitle: {
    color: C.text, fontSize: 11, fontWeight: "600", lineHeight: 15,
    marginTop: 6, width: CARD_W, fontFamily: "Cairo_600SemiBold",
  },

  // Skeletons
  skeletonWrap: {
    flexDirection: "row", flexWrap: "wrap", gap: GAP,
    padding: PAD,
  },
  skeletonCard: {
    width: CARD_W, height: CARD_H, borderRadius: R.lg,
    backgroundColor: C.surfaceLight,
  },
  skeletonLine: {
    width: CARD_W * 0.85, height: 10, borderRadius: 5, marginTop: 8,
    backgroundColor: C.surfaceLight,
  },
  skeletonLineShort: {
    width: CARD_W * 0.5, height: 10, borderRadius: 5, marginTop: 5,
    backgroundColor: C.surfaceLight,
  },

  // Empty
  emptyCircle: {
    width: 64, height: 64, borderRadius: R.circle,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    alignItems: "center", justifyContent: "center",
  },
  emptyTitle: { color: C.textSecondary, fontSize: 16, fontWeight: "600", fontFamily: "Cairo_600SemiBold" },
  emptyDesc: { color: C.textMuted, fontSize: 13, textAlign: "center", fontFamily: "Cairo_500Medium" },
  emptyBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.borderAccent,
    borderRadius: R.pill, paddingHorizontal: 16, paddingVertical: 9,
  },
  emptyBtnText: { color: C.accent, fontSize: 12, fontWeight: "700", fontFamily: "Cairo_600SemiBold" },
});

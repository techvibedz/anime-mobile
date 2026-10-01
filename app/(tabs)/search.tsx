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
  Animated,
} from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { searchAnime, fetchAllAnime, fetchGenre } from "../../lib/api";
import type { SearchResult } from "../../lib/api";
import { MalCardBadge } from "../../components/MalRating";
import { CompletionBadge } from "../../components/CompletionBadge";
import { GlassFill } from "../../components/GlassFill";
import { PosterCard, PosterPill, INLINE_POSTER_BADGE } from "../../components/PosterCard";
import { CardLayoutControl } from "../../components/CardLayoutControl";
import { useCardLayout, type CardLayout } from "../../lib/cardLayout";
import { StateView } from "../../components/StateView";
import { Rise } from "../../components/Rise";
import { useSidebarActions } from "../../components/Sidebar";
import { C, S, R, TAr, ELEVATION_GLOW, ABSOLUTE_FILL } from "../../lib/theme";
import { t } from "../../lib/i18n";
import { useReducedMotion } from "../../lib/motion";

const PAD = S.paddingContent;
const GAP = 10;

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
function SkeletonGrid({ width, layout }: { width: number; layout: CardLayout }) {
  const pulse = useRef(new Animated.Value(0.35)).current;
  const reduced = useReducedMotion();
  useEffect(() => {
    // Reduced motion: hold a calm static opacity instead of pulsing.
    if (reduced) { pulse.setValue(0.5); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.8, duration: 700, useNativeDriver: true, isInteraction: false }),
        Animated.timing(pulse, { toValue: 0.35, duration: 700, useNativeDriver: true, isInteraction: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduced]);
  return (
    <View style={ss.skeletonWrap}>
      {Array.from({ length: 12 }).map((_, i) => (
        <View key={i} style={{ width }}>
          <Animated.View style={[ss.skeletonCard, { width, height: layout === "list" ? 150 : width * 1.5, opacity: pulse }]} />
        </View>
      ))}
    </View>
  );
}

/* Memoized result card — built on the unified <PosterCard>. Without this,
 * every visible poster re-rendered on each keystroke (the search-progress strip
 * toggles parent state) and on every pagination append. */
const ResultCard = memo(function ResultCard({ item, width, layout }: { item: SearchResult; width: number; layout: CardLayout }) {
  return (
    <PosterCard
      image={item.image}
      title={item.title}
      onPress={() => router.push(`/anime/${encodeURIComponent(item.href)}`)}
      width={width}
      layout={layout}
      subtitle={layout === "list" ? item.type : undefined}
      aspectRatio={2 / 3}
      recyclingKey={item.href}
      titleLines={2}
      topRight={<MalCardBadge title={item.title} style={INLINE_POSTER_BADGE} />}
      bottomLeft={
        layout !== "list" && item.type ? (
          <PosterPill>
            <Text style={ss.typeBadgeText}>{item.type}</Text>
          </PosterPill>
        ) : null
      }
      bottomRight={<CompletionBadge hrefs={[item.href]} titles={[item.title]} style={INLINE_POSTER_BADGE} />}
    />
  );
});

export default function SearchScreen() {
  const cards = useCardLayout("search", GAP);
  const insets = useSafeAreaInsets();
  const { openSidebar } = useSidebarActions();
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

  // The tabs are pre-mounted (lazy:false) so switching never flashes. Loading
  // the browse grid on MOUNT, however, queued a full all-anime scrape at app
  // launch — competing with the home feed for the same WebView slots. Defer the
  // first load until the tab is actually focused; later focuses keep the grid.
  const browseLoadedRef = useRef(false);
  useFocusEffect(useCallback(() => {
    if (browseLoadedRef.current) return;
    browseLoadedRef.current = true;
    loadBrowse();
  }, [loadBrowse]));

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

  const renderResult = useCallback(
    ({ item }: { item: SearchResult }) => (
      <ResultCard item={item} width={cards.cardWidth} layout={cards.layout} />
    ),
    [cards.cardWidth, cards.layout],
  );
  // Stable key: href alone. The old `href + index` remounted every cell on any
  // list refresh (all keys changed) — the whole grid flickered and re-decoded
  // images.
  const keyExtractor = useCallback((item: SearchResult) => item.href, []);

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
      {/* ── Search console — one cohesive surface lifted over the grid ── */}
      <View style={ss.header}>
        <Rise style={ss.headerTop}>
          <View style={ss.headerActions}>
          <Pressable accessibilityRole="button" accessibilityLabel={t.menu} onPress={openSidebar} hitSlop={8} style={ss.menuBtn}>
            <Ionicons name="menu" size={20} color={C.text} />
          </Pressable>
          <CardLayoutControl layout={cards.layout} onChange={cards.setLayout} />
          </View>
          <View style={ss.headerTitleRow}>
            <Text style={ss.heading}>{t.discover}</Text>
            {!loading && items.length > 0 && (
              <View style={ss.countPill}>
                <Text style={ss.countPillText}>{items.length}</Text>
              </View>
            )}
          </View>
        </Rise>
        <Text style={ss.intro}>{t.searchSub}</Text>

        {/* Glass search field — the hero control */}
        <View style={[ss.searchBar, searching && ss.searchBarActive]}>
          <View style={[ss.searchIcon, searching && ss.searchIconActive]}>
            {searching ? (
              <ActivityIndicator size="small" color={C.accent} />
            ) : (
              <Ionicons name="search" size={18} color={C.textMuted} />
            )}
          </View>
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
            accessibilityLabel={t.searchPlaceholder}
            selectionColor={C.accent}
          />
          {query.length > 0 && (
            <Pressable onPress={handleClear} hitSlop={8} style={ss.clearBtn}>
              <Ionicons name="close-circle" size={18} color={C.textMuted} />
            </Pressable>
          )}
        </View>

        {/* Genre filter strip — part of the console, prevents vertical scroll capture */}
        <View style={ss.chipContainer}>
          <ScrollView
            horizontal
            nestedScrollEnabled
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={ss.chipScroll}
            keyboardShouldPersistTaps="handled"
          >
            {GENRES.map((g) => (
              <Pressable key={g} accessibilityRole="button" accessibilityState={{ selected: activeGenre === g }} onPress={() => handleGenre(g)}>
                <View style={[ss.chip, activeGenre === g && ss.chipActive]}>
                  <Text style={[ss.chipText, activeGenre === g && ss.chipTextActive]}>{GENRE_LABELS[g] || g}</Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {/* Console bottom edge — full-width hairline that doubles as the live
            search-progress strip while a search/genre refresh is in flight */}
        <View style={ss.glowLineWrap}>
          <View style={ss.glowLine} />
          {searching && (
            <View style={ss.progressStrip}>
              <LinearGradient
                colors={["transparent", C.accent, "transparent"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={ABSOLUTE_FILL}
              />
            </View>
          )}
        </View>
      </View>

      {/* Content */}
      {loading ? (
        <SkeletonGrid width={cards.cardWidth} layout={cards.layout} />
      ) : items.length > 0 ? (
        <FlatList
          key={`${cards.layout}-${cards.columns}`}
          data={items}
          numColumns={cards.columns}
          keyExtractor={keyExtractor}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
          keyboardShouldPersistTaps="handled"
          initialNumToRender={12}
          maxToRenderPerBatch={9}
          windowSize={7}
          updateCellsBatchingPeriod={50}
          contentContainerStyle={{ padding: PAD, paddingBottom: insets.bottom + 100, rowGap: GAP + 8 }}
          columnWrapperStyle={cards.columns > 1 ? { gap: GAP } : undefined}
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
            <Text style={ss.resultsLabel}>{t.searchResultsFor(query.trim())}</Text>
          ) : null}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={C.accent} style={{ paddingVertical: 20 }} /> : null}
          renderItem={renderResult}
        />
      ) : (
        <StateView
          icon="search-outline"
          variant="empty"
          title={t.noResults}
          message={t.searchSub}
          primary={showingSearch ? { label: t.browseAll, onPress: handleClear, icon: "grid-outline" } : undefined}
        />
      )}
    </View>
  );
}

const ss = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, paddingBottom: 80 },

  // Search console — a cohesive surface on the opaque canvas, softly lifted over
  // the scrolling grid (opaque bg so scrolled content never bleeds through).
  header: {
    backgroundColor: C.bg, zIndex: 10,
  },
  headerTop: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: PAD, paddingTop: 16, paddingBottom: 12,
  },
  headerTitleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  menuBtn: {
    width: 48, height: 48, borderRadius: R.md, overflow: "hidden", backgroundColor: C.surface,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: C.glassBorder,
  },
  heading: {
    ...TAr.h1, lineHeight: 44, color: C.bone,
  },
  intro: { ...TAr.body, color: C.textMuted, textAlign: "right", paddingHorizontal: PAD, marginBottom: 20 },
  countPill: {
    backgroundColor: C.surfaceLight,
    borderRadius: R.pill, paddingHorizontal: 10, paddingVertical: 3,
  },
  countPillText: { color: C.ember, fontSize: 11, fontWeight: "700", fontFamily: "Outfit_700Bold" },

  // Search bar — the hero control: taller, big soft radius, accent ring on active.
  searchBar: {
    flexDirection: "row", alignItems: "center", gap: 10,
    marginHorizontal: PAD, marginBottom: 14,
    borderRadius: R.md, height: 56, paddingHorizontal: 10, paddingRight: 16, backgroundColor: C.surface,
    overflow: "hidden", borderWidth: 1, borderColor: C.line,
  },
  searchBarActive: { borderColor: C.accent },
  searchIcon: {
    width: 36, height: 36, borderRadius: R.circle,
    alignItems: "center", justifyContent: "center",
  },
  searchIconActive: { backgroundColor: C.accentSoft },
  clearBtn: { width: 40, height: 48, alignItems: "center", justifyContent: "center" },
  input: {
    flex: 1, color: C.text, fontSize: 15, height: 56,
    fontFamily: "Cairo_500Medium",
  },

  // Chips
  chipContainer: { height: 64, overflow: "visible" },
  chipScroll: { paddingHorizontal: PAD, gap: 8, paddingBottom: 16, alignItems: "center" as const },
  chip: {
    height: 48, justifyContent: "center",
    paddingHorizontal: 16, borderRadius: R.sm,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.borderSoft,
  },
  chipActive: { backgroundColor: C.accentSoft, borderColor: C.borderAccent },
  chipText: { color: C.textSecondary, fontSize: 13, lineHeight: 20, fontWeight: "600", fontFamily: "Cairo_600SemiBold", includeFontPadding: false, textAlignVertical: "center" },
  chipTextActive: { color: C.accent },

  // Console bottom edge — full-width hairline + search-progress strip
  glowLineWrap: { height: 2, justifyContent: "center" },
  glowLine: {
    height: 0.5,
    backgroundColor: C.line,
  },
  progressStrip: { ...ABSOLUTE_FILL, overflow: "hidden", borderRadius: 1 },

  // Results
  resultsLabel: {
    ...TAr.bodySmall, color: C.textSecondary,
    textAlign: "right",
    marginBottom: 12,
  },
  typeBadgeText: { color: C.textSoft, fontSize: 8, fontWeight: "700", fontFamily: "Cairo_600SemiBold" },

  // Skeletons
  skeletonWrap: {
    flexDirection: "row", flexWrap: "wrap", gap: GAP,
    padding: PAD,
  },
  skeletonCard: {
    borderRadius: R.lg,
    backgroundColor: C.surfaceLight,
  },
});

import { useState, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Dimensions,
} from "react-native";
import { Image } from "expo-image";
import { BlurView } from "expo-blur";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { searchAnime, fetchAllAnime, fetchGenre } from "../../lib/api";
import type { SearchResult } from "../../lib/api";
import { C, S, R, ELEVATION_CARD } from "../../lib/theme";
import { t } from "../../lib/i18n";

const { width: SW } = Dimensions.get("window");
const PAD = S.paddingContent;
const GAP = 10;
const NUM_COLS = 3;
const CARD_W = (SW - PAD * 2 - GAP * (NUM_COLS - 1)) / NUM_COLS;

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

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const { genre: genreParam } = useLocalSearchParams<{ genre?: string }>();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeGenre, setActiveGenre] = useState("All");
  const [genrePage, setGenrePage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);
  const lastGenreParam = useRef<string | undefined>(undefined);
  const modeRef = useRef<"browse" | "search" | "genre">("browse");

  const loadBrowse = useCallback(async (page = 1) => {
    if (page === 1) setLoading(true);
    else setLoadingMore(true);
    try {
      const res = await fetchAllAnime(page);
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
        return;
      }
      // Fallback if all-anime returns nothing
      if (page === 1) {
        const fallback = await fetchGenre("Action", 1);
        if (fallback.success && fallback.data.items.length > 0) {
          setItems(fallback.data.items.map((it: any) => ({
            title: it.title, href: it.href, image: it.image, type: it.type || undefined,
          })));
          setHasMore(fallback.data.hasNext);
          setGenrePage(1);
        }
      }
    } catch {} finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  const loadGenre = useCallback(async (name: string, page = 1) => {
    if (page === 1) setLoading(true);
    else setLoadingMore(true);
    try {
      const res = await fetchGenre(name, page);
      if (res.success) {
        const newItems = res.data.items.map((it: any) => ({
          title: it.title, href: it.href, image: it.image, type: it.type || undefined,
        }));
        if (page === 1) setItems(newItems);
        else setItems((prev) => [...prev, ...newItems]);
        setHasMore(res.data.hasNext);
        setGenrePage(page);
      }
    } catch {} finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => { loadBrowse(); }, [loadBrowse]);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      modeRef.current = "browse";
      loadBrowse();
      return;
    }
    modeRef.current = "search";
    setLoading(true);
    setHasMore(false);
    try {
      const res = await searchAnime(q.trim());
      if (res.success) setItems(res.data.results);
      else setItems([]);
    } catch { setItems([]); }
    finally { setLoading(false); }
  }, [loadBrowse]);

  const onChangeText = useCallback((text: string) => {
    setQuery(text);
    if (text.trim() === "") setActiveGenre("All");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(text), 350);
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

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  return (
    <View style={[ss.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={ss.header}>
        <Text style={ss.heading}>اكتشف</Text>
      </View>

      {/* Glass search bar */}
      <View style={ss.searchWrap}>
        <View style={ss.searchBar}>
          <BlurView intensity={16} tint="dark" style={StyleSheet.absoluteFill}>
            <View style={[StyleSheet.absoluteFill, { backgroundColor: C.surfaceGlass }]} />
          </BlurView>
          <Ionicons name="search" size={18} color={C.textMuted} />
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

      {/* Glow divider */}
      <View style={ss.glowLine} />

      {/* Content */}
      {loading ? (
        <View style={ss.center}>
          <ActivityIndicator size="large" color={C.accent} />
        </View>
      ) : items.length > 0 ? (
        <FlatList
          data={items}
          numColumns={NUM_COLS}
          keyExtractor={(item, i) => item.href + i}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
          contentContainerStyle={{ padding: PAD, paddingBottom: insets.bottom + 100 }}
          columnWrapperStyle={{ gap: GAP, marginBottom: GAP + 6 }}
          onEndReached={loadMoreGenre}
          onEndReachedThreshold={0.5}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={C.accent} style={{ paddingVertical: 20 }} /> : null}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/anime/${encodeURIComponent(item.href)}`)}
              style={({ pressed }) => ({ width: CARD_W, opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}
            >
              <View style={ss.resultCard}>
                {item.image ? (
                  <Image source={{ uri: item.image }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={item.href} transition={200} />
                ) : (
                  <View style={[StyleSheet.absoluteFill, { backgroundColor: C.surface, alignItems: "center", justifyContent: "center" }]}>
                    <Ionicons name="image-outline" size={24} color={C.textMuted} />
                  </View>
                )}
              </View>
              <Text style={ss.resultTitle} numberOfLines={2}>{item.title}</Text>
              {item.type && <Text style={ss.resultType}>{item.type}</Text>}
            </Pressable>
          )}
        />
      ) : (
        <View style={ss.center}>
          <View style={ss.emptyCircle}>
            <Ionicons name="search-outline" size={28} color={C.textMuted} />
          </View>
          <Text style={ss.emptyTitle}>{t.noResults}</Text>
          <Text style={ss.emptyDesc}>{t.searchSub}</Text>
        </View>
      )}
    </View>
  );
}

const ss = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, paddingBottom: 80 },

  header: { paddingHorizontal: PAD, paddingTop: 16, paddingBottom: 8 },
  heading: {
    color: C.text, fontSize: 26, fontWeight: "700", letterSpacing: -0.4,
    fontFamily: "Outfit_700Bold",
  },

  // Search bar
  searchWrap: { paddingHorizontal: PAD, paddingBottom: 12 },
  searchBar: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderRadius: R.xxl, height: S.inputHeight, paddingHorizontal: 16,
    overflow: "hidden", borderWidth: 1, borderColor: C.glassBorder,
  },
  input: {
    flex: 1, color: C.text, fontSize: 14, height: S.inputHeight,
    fontFamily: "DMSans_400Regular",
  },

  // Chips
  chipContainer: { height: 52, overflow: "visible" },
  chipScroll: { paddingHorizontal: PAD, gap: 8, paddingBottom: 16, alignItems: "center" as const },
  chip: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: R.pill,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
  },
  chipActive: { backgroundColor: C.accent, borderColor: "transparent" },
  chipText: { color: C.textSecondary, fontSize: 13, fontWeight: "600", fontFamily: "DMSans_600SemiBold" },
  chipTextActive: { color: C.textOnAccent },

  // Glow line
  glowLine: {
    height: 0.5, marginHorizontal: PAD,
    backgroundColor: C.violetGlow,
    shadowColor: C.violet, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.3, shadowRadius: 8,
  },

  // Results
  resultCard: {
    width: CARD_W, aspectRatio: 3 / 4, borderRadius: R.lg, overflow: "hidden",
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    ...ELEVATION_CARD,
  },
  resultTitle: {
    color: C.text, fontSize: 11, fontWeight: "600", lineHeight: 15,
    marginTop: 6, width: CARD_W, fontFamily: "DMSans_600SemiBold",
  },
  resultType: {
    color: C.textMuted, fontSize: 10, lineHeight: 13, marginTop: 2,
    width: CARD_W, fontFamily: "DMSans_500Medium",
  },

  // Empty
  emptyCircle: {
    width: 64, height: 64, borderRadius: R.circle,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    alignItems: "center", justifyContent: "center",
  },
  emptyTitle: { color: C.textSecondary, fontSize: 16, fontWeight: "600", fontFamily: "Outfit_600SemiBold" },
  emptyDesc: { color: C.textMuted, fontSize: 13, textAlign: "center", fontFamily: "DMSans_500Medium" },
});

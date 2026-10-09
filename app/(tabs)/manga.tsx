// Manga hub — one combined feed for every source.
//
// There are no source tabs and no source names anywhere: home rails, search
// and genre browse all fan out to every source and merge by normalized title,
// so a work appears once, with the best cover/metadata, and the reader later
// pulls each chapter from the highest-resolution source that has it. The
// search screen carries a full filter sheet (type / status / sort / a large
// genre catalog) and a "load more" pager over the sources' genre pages.
import { MangaLayoutControl, MangaCover, MangaCardTile, MangaSkeleton, MangaState } from "../../components/MangaUI";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { M, MT, MANGA_FILL } from "../../lib/manga/design";
import { t } from "../../lib/i18n";
import {
  browseMergedAll,
  browseMergedGenre,
  fetchMergedHome,
  filterMangaCards,
  mergeCards,
  readCachedMergedHome,
  searchMergedManga,
  type MangaFilters,
} from "../../lib/manga/aggregate";
import { MangaGrid } from "../../components/MangaGrid";
import { useCardLayout } from "../../lib/cardLayout";
import { normFuzzy } from "../../lib/fuzzy";
import { useReducedMotion } from "../../lib/motion";
import { MANGA_GENRES } from "../../lib/manga/genres";
import type { MangaCard, MangaHome } from "../../lib/manga/types";
import type { MangaProgress } from "../../lib/manga/store";
import { removeMangaProgress, useContinueReading } from "../../lib/manga/store";
import { upgradeMangaCover } from "../../lib/manga/cover";
import { openMangaDetail, openMangaLibrary, openMangaReader } from "../../lib/manga/nav";

const PAD = 20;
const GAP = 12;
const RAIL_W = 140;
const CONTINUE_W = 300;
const MAX_GENRES = 3;

const EMPTY_FILTERS: MangaFilters = { type: null, status: null, sort: "default" };

export default function MangaHubScreen() {
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const metrics = useCardLayout("manga-search");
  const [genreQuery, setGenreQuery] = useState("");
  const matchingGenres = useMemo(() => MANGA_GENRES.filter((genre) => normFuzzy([genre.label, genre.asq, genre.mangalik, genre.mangawy].filter(Boolean).join(" ")).includes(normFuzzy(genreQuery))), [genreQuery]);

  const [home, setHome] = useState<MangaHome | null>(null);
  const homeRef = useRef<MangaHome | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [results, setResults] = useState<MangaCard[]>([]);
  const [canLoadMore, setCanLoadMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [browsePage, setBrowsePage] = useState(1);
  const [filters, setFilters] = useState<MangaFilters>(EMPTY_FILTERS);
  const [genres, setGenres] = useState<string[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [draftFilters, setDraftFilters] = useState<MangaFilters>(EMPTY_FILTERS);
  const [draftGenres, setDraftGenres] = useState<string[]>([]);
  const searchSeqRef = useRef(0);
  const rawResultsRef = useRef<MangaCard[]>([]);
  const pagingRef = useRef(false);
  const continueReading = useContinueReading(10);

  // Defer the first fetch until the tab is actually opened — the tab navigator
  // pre-mounts every tab, and the hub has no business fetching at app start.
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  const loadHome = useCallback(async (force: boolean) => {
    if (!force && homeRef.current) return;
    // Stale-while-revalidate: the merged disk caches paint the first frame,
    // then the network pass replaces them (progressively, source by source).
    if (!force && !homeRef.current) {
      const cached = await readCachedMergedHome();
      if (cached) {
        homeRef.current = cached;
        setHome(cached);
      }
    }
    setError(false);
    setRefreshing(force);
    setLoading(!homeRef.current);
    try {
      const merged = await fetchMergedHome({
        force,
        onPartial: (partial) => {
          homeRef.current = partial;
          setHome(partial);
        },
      });
      homeRef.current = merged;
      setHome(merged);
    } catch {
      if (!homeRef.current) setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (focused) void loadHome(false);
  }, [focused, loadHome]);

  const runSearch = useCallback(async (q: string, selectedGenres: string[], active: MangaFilters, page = 1) => {
    const seq = page === 1 ? ++searchSeqRef.current : searchSeqRef.current;
    const trimmed = q.trim();
    if (page === 1) {
      rawResultsRef.current = [];
      setResults([]);
      setBrowsePage(1);
      setCanLoadMore(false);
      setSearching(true);
      setSearched(true);
    }
    const options = { ...active, genres: selectedGenres, page };
    const emit = (cards: MangaCard[]) => {
      if (seq !== searchSeqRef.current) return;
      // Search streams are cumulative and ranked; keep their latest ordering.
      rawResultsRef.current = trimmed && page === 1 ? cards : mergeCards([...rawResultsRef.current, ...cards]);
      setResults(rawResultsRef.current);
    };
    try {
      const batches = trimmed
        ? [await searchMergedManga(trimmed, options, emit)]
        : selectedGenres.length
          ? await Promise.all(selectedGenres.map((genre) => browseMergedGenre(genre, page, options, emit)))
          : [await browseMergedAll(page, options, emit)];
      if (seq !== searchSeqRef.current) return;
      const incoming = mergeCards(batches.flat());
      emit(incoming);
      setBrowsePage(page);
      setCanLoadMore(incoming.length > 0);
    } finally {
      if (seq === searchSeqRef.current) {
        setSearching(false);
        setLoadingMore(false);
        pagingRef.current = false;
      }
    }
  }, []);

  useEffect(() => {
    if (!searchOpen) return;
    // Invalidate immediately, before the debounce: old streams can't paint under new text.
    searchSeqRef.current++;
    pagingRef.current = false;
    setLoadingMore(false);
    setResults([]);
    setSearching(true);
    const timer = setTimeout(() => void runSearch(query, genres, filters), 350);
    return () => { clearTimeout(timer); searchSeqRef.current++; };
  }, [query, genres, filters, searchOpen, runSearch]);

  const loadMore = useCallback(async () => {
    if (pagingRef.current || searching) return;
    pagingRef.current = true;
    setLoadingMore(true);
    await runSearch(query, genres, filters, browsePage + 1);
  }, [query, genres, filters, browsePage, searching, runSearch]);

  const closeSearch = useCallback(() => {
    searchSeqRef.current++;
    Keyboard.dismiss();
    setSearchOpen(false);
    setQuery("");
    setResults([]);
    setSearched(false);
    setSearching(false);
    setFilterOpen(false);
  }, []);

  const openFilters = useCallback(() => {
    Keyboard.dismiss();
    setGenreQuery("");
    setDraftFilters(filters);
    setDraftGenres(genres);
    setFilterOpen(true);
  }, [filters, genres]);

  const applyFilters = useCallback(() => {
    setFilters(draftFilters);
    setGenres(draftGenres);
    setFilterOpen(false);
    Keyboard.dismiss();
  }, [draftFilters, draftGenres]);

  const clearDraftFilters = useCallback(() => {
    setDraftFilters(EMPTY_FILTERS);
    setDraftGenres([]);
  }, []);

  const toggleDraftGenre = useCallback((label: string) => {
    setDraftGenres((previous) => {
      if (previous.includes(label)) return previous.filter((genre) => genre !== label);
      if (previous.length >= MAX_GENRES) return previous;
      return [...previous, label];
    });
  }, []);

  const confirmRemoveContinue = useCallback((item: MangaProgress) => {
    Alert.alert(t.mangaRemoveContinueConfirm, item.title, [
      { text: t.cancel, style: "cancel" },
      {
        text: t.remove,
        style: "destructive",
        onPress: () => {
          void removeMangaProgress(item.source, item.id);
        },
      },
    ]);
  }, []);

  const activeFilterCount =
    (filters.type ? 1 : 0) + (filters.status ? 1 : 0) + (filters.sort !== "default" ? 1 : 0) + genres.length;

  const footer = canLoadMore ? (
    <Pressable style={s.loadMoreBtn} onPress={() => void loadMore()} disabled={loadingMore || searching} accessibilityRole="button" accessibilityLabel={t.mangaLoadMore}>
      {loadingMore ? <ActivityIndicator color={M.accent} /> : <Text style={s.loadMoreText}>{t.mangaLoadMore}</Text>}
    </Pressable>
  ) : null;

  const shown = useMemo(() => filterMangaCards(results, filters), [results, filters]);

  return (
    <View style={s.root}>
      {focused && <StatusBar style="dark" />}
      {searchOpen ? (
        <>
          <View style={[s.searchHeader, { paddingTop: insets.top + 10 }]}>
            <View style={s.searchPageTitle}><Text style={s.searchTitle}>اكتشف قصتك التالية</Text></View>
            <View style={s.searchBarRow}>
              <Pressable style={s.iconBtn} onPress={closeSearch} accessibilityRole="button" accessibilityLabel={t.back}>
                <Ionicons name="arrow-forward" size={20} color={M.ink} />
              </Pressable>
              <Text style={s.searchToolbarLabel}>البحث والتصنيفات</Text>
              <Pressable style={[s.iconBtn, activeFilterCount > 0 && s.iconBtnActive]} onPress={openFilters}
                accessibilityRole="button" accessibilityLabel={t.mangaFilter}>
                <Ionicons name="options-outline" size={20} color={activeFilterCount ? M.accent : M.ink} />
                {activeFilterCount > 0 && <View style={s.filterBadge}><Text style={s.filterBadgeText}>{activeFilterCount}</Text></View>}
              </Pressable>
            </View>
            <View style={s.searchBar}>
              <Ionicons name="search" size={20} color={M.muted} />
              <TextInput value={query} onChangeText={setQuery} onSubmitEditing={Keyboard.dismiss}
                placeholder={t.mangaSearchPlaceholder} placeholderTextColor={M.muted} style={s.input}
                autoFocus returnKeyType="search" accessibilityLabel={t.mangaSearchPlaceholder} />
              {query.length > 0 && <Pressable onPress={() => setQuery("")} style={s.clearQuery} accessibilityRole="button" accessibilityLabel="مسح البحث">
                <Ionicons name="close" size={20} color={M.muted} />
              </Pressable>}
            </View>
            {(activeFilterCount > 0) && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.activeFiltersRow}
              >
                {filters.type ? <FilterPill label={filters.type} onRemove={() => setFilters((p) => ({ ...p, type: null }))} /> : null}
                {filters.status ? <FilterPill label={filters.status} onRemove={() => setFilters((p) => ({ ...p, status: null }))} /> : null}
                {filters.sort !== "default" ? <FilterPill label={filters.sort === "latest" ? t.mangaSortNewest : t.mangaSortTitle} onRemove={() => setFilters((p) => ({ ...p, sort: "default" }))} /> : null}
                {genres.map((genre) => (
                  <FilterPill key={genre} label={genre} onRemove={() => setGenres((p) => p.filter((label) => label !== genre))} />
                ))}
              </ScrollView>
            )}
            <View style={s.resultHeader}>
              <MangaLayoutControl layout={metrics.layout} onChange={metrics.setLayout} />
              <Text style={s.resultCount}>{searching ? t.loading : `${shown.length} نتيجة`}</Text>
            </View>
          </View>

          {shown.length > 0 ? (
            <>
              {searching && (
                <View style={s.searchProgressRow}>
                  <ActivityIndicator size="small" color={M.accent} />
                  <Text style={s.searchProgressText}>{t.loading}</Text>
                </View>
              )}
              <MangaGrid cards={shown} metrics={metrics} bottomInset={insets.bottom + 80} footer={footer} />
            </>
          ) : searching ? (
            <SearchSkeleton />
          ) : searched ? (
            <View style={{ flex: 1 }}><MangaState
              icon="search-outline"
              variant="empty"
              title={t.mangaNoResults}
              message={t.mangaNoResultsSub}
              primary={{ label: t.mangaFilter, onPress: openFilters, icon: "options-outline" }}
            />{footer}</View>
          ) : (
            <MangaState
              icon="book-outline"
              variant="empty"
              title={t.mangaSearchHint}
              message={t.mangaSearchHintSub}
            />
          )}
        </>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + 110 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void loadHome(true)}
              tintColor={M.accent}
              colors={[M.accent]}
              progressBackgroundColor={M.sheet}
            />
          }
        >
          <View style={[s.header, { paddingTop: insets.top + 12 }]}>
            <View style={s.headerRow}>
              <View style={s.headerText}>
                <Text style={s.eyebrow}>PANTOUFA / MANGA</Text>
                <View style={s.titleRow}>
                  <Text style={s.h1}>عالم المانجا</Text>
                  <View style={s.betaBadge}><Text style={s.betaText}>{t.mangaBeta}</Text></View>
                </View>
                <Text style={s.sub}>قصص تستحق أن تقلب صفحاتها.</Text>
              </View>
              <View style={s.headerActions}>

                <Pressable
                  style={s.iconBtn}
                  onPress={openMangaLibrary}
                  accessibilityRole="button"
                  accessibilityLabel={t.mangaLibrary}
                >
                  <Ionicons name="bookmarks-outline" size={19} color={M.ink} />
                  <Text style={s.libraryLabel}>مكتبتي</Text>
                </Pressable>
              </View>
            </View>
          </View>

          <Pressable style={s.homeSearch} onPress={() => setSearchOpen(true)} accessibilityRole="button" accessibilityLabel={t.mangaSearchPlaceholder}>
            <Ionicons name="options-outline" size={20} color={M.accent} />
            <Text style={s.homeSearchText}>{t.mangaSearchPlaceholder}</Text>
            <Ionicons name="search" size={20} color={M.muted} />
          </Pressable>
          <FlatList horizontal inverted data={MANGA_GENRES.slice(0, 6)} keyExtractor={(genre) => genre.label} showsHorizontalScrollIndicator={false} contentContainerStyle={s.quickGenres}
            renderItem={({ item: genre }) => <ChoiceChip label={genre.label} active={false} onPress={() => { setGenres([genre.label]); setSearchOpen(true); }} />} />
          {continueReading.length > 0 && (
            <View style={s.section}>
              <SectionHeader title={t.mangaContinueReading} />
              <FlatList horizontal inverted data={continueReading} keyExtractor={(item) => `${item.source}:${item.id}`}
                showsHorizontalScrollIndicator={false} contentContainerStyle={s.railContent}
                renderItem={({ item }) => <ContinueCard item={item} onRemove={confirmRemoveContinue} />} />
            </View>
          )}
          {loading && !home ? (
            <HubSkeleton />
          ) : error && !home ? (
            <MangaState
              icon="cloud-offline-outline"
              variant="error"
              title={t.mangaLoadError}
              message={t.mangaLoadErrorSub}
              primary={{ label: t.retry, onPress: () => void loadHome(true), icon: "refresh" }}
            />
          ) : home ? (
            <>
              {home.featured[0] && <HeroBanner card={home.featured[0]} />}

              {home.sections.map((section) => (
                <View key={section.id} style={s.section}>
                  <SectionHeader title={section.title} index={home.sections.indexOf(section) + 1} />
                  <FlatList
                    horizontal
                    inverted
                    data={section.items}
                    keyExtractor={(item) => `${section.id}:${item.source}:${item.id}`}
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={s.railContent}
                    initialNumToRender={6}
                    maxToRenderPerBatch={6}
                    windowSize={5}
                    renderItem={({ item, index }) =>
                      section.kind === "latest" ? (
                        <LatestCard card={item} />
                      ) : (
                        <MangaCardTile
                          image={upgradeMangaCover(item.cover)}
                          title={item.title}
                          width={RAIL_W}
                          rank={section.kind === "ranked" ? index + 1 : undefined}
                          onPress={() => openMangaDetail(item)}
                        />
                      )
                    }
                  />
                </View>
              ))}
            </>
          ) : null}
        </ScrollView>
      )}

      {/* filter sheet */}
      <Modal visible={filterOpen} transparent animationType={reducedMotion ? "none" : "fade"} onRequestClose={() => setFilterOpen(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <Pressable style={s.modalBackdrop} onPress={() => setFilterOpen(false)} />
        <View style={[s.filterSheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={s.sheetHeader}>
            <Pressable onPress={() => setFilterOpen(false)} style={s.iconBtn} accessibilityRole="button" accessibilityLabel={t.cancel}>
              <Ionicons name="close" size={20} color={M.muted} />
            </Pressable>
            <Text style={s.sheetTitle}>{t.mangaFiltersTitle}</Text>
          </View>
          <View style={s.genreSearch}>
            <Ionicons name="search" size={18} color={M.muted} />
            <TextInput value={genreQuery} onChangeText={setGenreQuery} placeholder="ابحث عن تصنيف…" placeholderTextColor={M.muted}
              style={s.input} accessibilityLabel="البحث في التصنيفات" returnKeyType="done" onSubmitEditing={Keyboard.dismiss} />
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={s.filterScroll}
            contentContainerStyle={s.filterBody}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <FilterBlock label={t.mangaFilterType}>
              <ChoiceChip
                label={t.mangaFilterAll}
                active={draftFilters.type === null}
                onPress={() => setDraftFilters((p) => ({ ...p, type: null }))}
              />
              {(["مانجا", "مانهوا", "مانها"] as const).map((type) => (
                <ChoiceChip
                  key={type}
                  label={type}
                  active={draftFilters.type === type}
                  onPress={() => setDraftFilters((p) => ({ ...p, type }))}
                />
              ))}
            </FilterBlock>

            <FilterBlock label={t.mangaFilterStatus}>
              <ChoiceChip
                label={t.mangaFilterAll}
                active={draftFilters.status === null}
                onPress={() => setDraftFilters((p) => ({ ...p, status: null }))}
              />
              {(["مستمر", "مكتمل", "معلق"] as const).map((status) => (
                <ChoiceChip
                  key={status}
                  label={status}
                  active={draftFilters.status === status}
                  onPress={() => setDraftFilters((p) => ({ ...p, status }))}
                />
              ))}
            </FilterBlock>

            <FilterBlock label={t.mangaFilterSort}>
              <ChoiceChip
                label={t.mangaSortDefault}
                active={draftFilters.sort === "default"}
                onPress={() => setDraftFilters((p) => ({ ...p, sort: "default" }))}
              />
              <ChoiceChip
                label={t.mangaSortNewest}
                active={draftFilters.sort === "latest"}
                onPress={() => setDraftFilters((p) => ({ ...p, sort: "latest" }))}
              />
              <ChoiceChip
                label={t.mangaSortTitle}
                active={draftFilters.sort === "title"}
                onPress={() => setDraftFilters((p) => ({ ...p, sort: "title" }))}
              />
            </FilterBlock>

            <FilterBlock label={`${t.mangaFilterGenres} · ${draftGenres.length} / ${MAX_GENRES}`}>
              <View style={s.genreGrid}>
                {matchingGenres.map((genre) => (
                  <ChoiceChip
                    key={genre.label}
                    label={genre.label}
                    disabled={draftGenres.length >= MAX_GENRES && !draftGenres.includes(genre.label)}
                    active={draftGenres.includes(genre.label)}
                    onPress={() => toggleDraftGenre(genre.label)}
                  />
                ))}
              </View>
              {matchingGenres.length === 0 && <Text style={s.genreLimitText}>لا توجد تصنيفات مطابقة</Text>}
              <Text style={s.genreLimitText}>النتائج تطابق أحد التصنيفات المختارة</Text>
            </FilterBlock>
            {draftGenres.length >= MAX_GENRES && (
              <Text style={s.genreLimitText}>{t.mangaFilterGenreLimit}</Text>
            )}
          </ScrollView>
          <View style={s.filterActions}>
            <Pressable
              style={({ pressed }) => [s.filterApply, pressed && { opacity: 0.9 }]}
              onPress={applyFilters}
              accessibilityRole="button"
            >
              <Text style={s.filterApplyText}>{t.mangaApply}</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [s.filterClear, pressed && { opacity: 0.85 }]}
              onPress={clearDraftFilters}
              accessibilityRole="button"
            >
              <Text style={s.filterClearText}>{t.mangaClearFilters}</Text>
            </Pressable>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ── pieces ───────────────────────────────────────────────────────────────────

function SectionHeader({ title, index }: { title: string; index?: number }) {
  return (
    <View style={s.sectionHeader}>
      {index != null ? <Text style={s.sectionIndex}>{String(index).padStart(2, "0")}</Text> : <Ionicons name="bookmark-outline" size={18} color={M.accent} />}
      <Text style={s.sectionTitle}>{title}</Text>
    </View>
  );
}

function HeroBanner({ card }: { card: MangaCard }) {
  const cover = upgradeMangaCover(card.cover);
  return (
    <Pressable style={({ pressed }) => [s.hero, pressed && { opacity: 0.85 }]} onPress={() => openMangaDetail(card)} accessibilityRole="button" accessibilityLabel={card.title}>
      <MangaCover uri={cover} label={card.title} style={s.heroCover} />
      <View style={s.heroBody}>
        <Text style={s.heroEyebrow}>على رفّ الاختيارات</Text>
        <View style={s.heroPills}>{card.type ? <Pill text={card.type} /> : null}{card.status ? <Pill text={card.status} /> : null}</View>
        <Text style={s.heroTitle} numberOfLines={3}>{card.title}</Text>
        {card.latest ? <Text style={s.heroSub}>{card.latest}</Text> : null}
        <View style={s.heroCta}><Text style={s.heroCtaText}>اكتشف العمل</Text><Ionicons name="arrow-back" size={18} color={M.white} /></View>
      </View>
    </Pressable>
  );
}

function Pill({ text, tint, textColor }: { text: string; tint?: string; textColor?: string }) {
  return (
    <View style={[s.pill, tint ? { backgroundColor: tint, borderColor: "transparent" } : null]}>
      <Text style={[s.pillText, textColor ? { color: textColor } : null]}>{text}</Text>
    </View>
  );
}

function FilterPill({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <Pressable onPress={onRemove} style={s.filterPill} accessibilityRole="button" accessibilityLabel={`إزالة ${label}`}><Ionicons name="close" size={14} color={M.accent} /><Text style={s.filterPillText}>{label}</Text></Pressable>
  );
}

function ContinueCard({ item, onRemove }: { item: MangaProgress; onRemove: (item: MangaProgress) => void }) {
  const progress = item.total > 0 ? Math.min(1, (item.page + 1) / item.total) : 0;
  const cover = upgradeMangaCover(item.cover);
  return (
    <View style={{ width: CONTINUE_W }}>
    <Pressable
      onPress={() =>
        openMangaReader({
          source: item.source,
          mangaId: item.id,
          mangaTitle: item.title,
          chapter: {
            source: item.chapterSource ?? item.source,
            mangaId: item.chapterMangaId ?? item.id,
            id: item.chapterId,
            number: item.chapterNumber,
          },
          cover: item.cover,
        })
      }
      onLongPress={() => onRemove(item)}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={`${item.title} — الفصل ${item.chapterNumber}`}
      accessibilityHint="اضغط لمتابعة القراءة، أو اضغط مطولاً للإزالة"
    >
      <View style={s.continueRow}>
        <MangaCover uri={cover} label={item.title} style={s.continuePlate} />
        <View style={s.continueBody}>
          <Text style={s.continueTitle} numberOfLines={2}>{item.title}</Text>
          <Text style={s.continueChapter}>الفصل {item.chapterNumber} · {Math.min(item.page + 1, item.total)} / {item.total}</Text>
          <View style={s.progressTrack}><View style={[s.progressFill, { width: `${Math.round(progress * 100)}%` }]} /></View>
          <View style={s.continueActionRow}><Ionicons name="arrow-back" size={16} color={M.accent} /><Text style={s.continueAction}>{t.mangaContinue}</Text></View>
        </View>
      </View>
    </Pressable>
      <Pressable style={s.continueRemoveBtn} onPress={() => onRemove(item)} accessibilityRole="button" accessibilityLabel={t.remove}><Ionicons name="close" size={17} color={M.muted} /></Pressable>
    </View>
  );
}

function LatestCard({ card }: { card: MangaCard }) {
  return <MangaCardTile image={upgradeMangaCover(card.cover)} title={card.title} width={RAIL_W}
    subtitle={card.latest || card.type || undefined} onPress={() => openMangaDetail(card)} />;
}

function SearchSkeleton() {
  return (
    <View style={s.skeletonWrap}>
      {[0, 1].map((row) => (
        <View key={row} style={s.skeletonRow}>
          {[0, 1, 2].map((col) => (
            <MangaSkeleton key={col} style={s.skeletonPoster} borderRadius={6} />
          ))}
        </View>
      ))}
    </View>
  );
}

function HubSkeleton() {
  return (
    <View style={s.skeletonWrap}>
      <MangaSkeleton style={s.skeletonHero} borderRadius={10} />
      <View style={s.skeletonRow}>
        {[0, 1, 2].map((col) => (
          <MangaSkeleton key={col} style={s.skeletonPoster} borderRadius={6} />
        ))}
      </View>
      <MangaSkeleton style={{ height: 18, width: 140, marginTop: 8 }} />
      <View style={s.skeletonRow}>
        {[0, 1, 2].map((col) => (
          <MangaSkeleton key={col} style={s.skeletonPoster} borderRadius={6} />
        ))}
      </View>
    </View>
  );
}

function FilterBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={s.filterBlock}>
      <Text style={s.filterLabel}>{label}</Text>
      <View style={s.filterChoices}>{children}</View>
    </View>
  );
}

function ChoiceChip({ label, active, onPress, disabled = false }: { label: string; active: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      disabled={disabled}
      accessibilityState={{ selected: active, disabled }}
      style={({ pressed }) => [s.choiceChip, active && s.choiceChipActive, disabled && { opacity: 0.4 }, pressed && { opacity: 0.75 }]}
    >
      <Text style={[s.choiceChipText, active && s.choiceChipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: M.paper },
  header: { paddingBottom: 10 },
  headerRow: { flexDirection: "row-reverse", alignItems: "center", paddingHorizontal: PAD, gap: 12 },
  headerText: { flex: 1, minWidth: 0, alignItems: "flex-end" },
  eyebrow: { ...MT.number, fontSize: 10, letterSpacing: 2, color: M.accent, marginBottom: 4 },
  titleRow: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "flex-end", gap: 8, flexWrap: "wrap", maxWidth: "100%" },
  h1: { ...MT.display, color: M.ink, textAlign: "right", flexShrink: 1 },
  betaBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 3, borderWidth: 1, borderColor: M.accent, backgroundColor: M.accentWash },
  betaText: { ...MT.caption, color: M.accent },
  sub: { ...MT.body, color: M.muted, textAlign: "right" },
  headerActions: { flexDirection: "row" },
  iconBtn: { minWidth: 48, minHeight: 48, paddingHorizontal: 10, alignItems: "center", justifyContent: "center", borderRadius: 4, backgroundColor: M.sheet, borderWidth: 1, borderColor: M.line },
  libraryLabel: { ...MT.caption, color: M.ink },
  iconBtnActive: { backgroundColor: M.accentWash, borderColor: M.accent },
  homeSearch: { marginHorizontal: PAD, marginTop: 12, minHeight: 58, borderRadius: 6, backgroundColor: M.sheet, borderWidth: 1, borderColor: M.line, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 12 },
  homeSearchText: { ...MT.body, flex: 1, color: M.muted, textAlign: "right" },
  quickGenres: { paddingHorizontal: PAD, paddingTop: 12, gap: 8 },
  section: { marginTop: 30 },
  sectionHeader: { flexDirection: "row-reverse", alignItems: "center", gap: 10, marginHorizontal: PAD, paddingBottom: 12, marginBottom: 16, borderBottomWidth: 1, borderColor: M.line },
  sectionIndex: { ...MT.number, fontSize: 12, color: M.accent },
  sectionTitle: { ...MT.heading, flex: 1, color: M.ink, textAlign: "right" },
  railContent: { paddingHorizontal: PAD, gap: GAP },
  hero: { marginHorizontal: PAD, marginTop: 28, padding: 18, borderRadius: 6, backgroundColor: M.ink, flexDirection: "row-reverse", alignItems: "center", gap: 18 },
  heroCover: { width: "36%", aspectRatio: 2 / 3, borderRadius: 3 },
  heroBody: { flex: 1, minWidth: 0, alignItems: "flex-end", gap: 8 },
  heroEyebrow: { ...MT.caption, color: M.nightAccent },
  heroPills: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 6 },
  pill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 3, backgroundColor: M.nightPanel, borderWidth: 1, borderColor: M.nightLine },
  pillText: { ...MT.caption, color: M.nightMuted },
  heroTitle: { ...MT.heading, fontSize: 22, lineHeight: 33, color: M.white, textAlign: "right" },
  heroSub: { ...MT.caption, color: M.nightMuted, textAlign: "right" },
  heroCta: { minHeight: 48, flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 12, borderRadius: 4, backgroundColor: M.accent, marginTop: 4 },
  heroCtaText: { ...MT.label, flexShrink: 1, color: M.white, textAlign: "center" },
  continueRow: { flexDirection: "row-reverse", gap: 12, padding: 14, borderRadius: 6, backgroundColor: M.sheet, borderWidth: 1, borderColor: M.line },
  continuePlate: { width: 78, aspectRatio: 2 / 3 },
  continueBody: { flex: 1, minWidth: 0, alignItems: "flex-end", paddingTop: 18, gap: 4 },
  continueTitle: { ...MT.label, color: M.ink, textAlign: "right" },
  continueChapter: { ...MT.caption, color: M.muted, textAlign: "right" },
  progressTrack: { height: 4, width: "100%", backgroundColor: M.wash, marginTop: 6, alignItems: "flex-end" },
  progressFill: { height: 4, backgroundColor: M.read },
  continueActionRow: { flexDirection: "row", gap: 6, alignItems: "center", marginTop: 4 },
  continueAction: { ...MT.caption, color: M.accent },
  continueRemoveBtn: { position: "absolute", left: 0, top: 0, width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  searchHeader: { paddingBottom: 12, backgroundColor: M.paper },
  searchPageTitle: { paddingHorizontal: PAD, alignItems: "flex-end" },
  searchTitle: { ...MT.title, color: M.ink, textAlign: "right" },
  searchBarRow: { flexDirection: "row-reverse", alignItems: "center", gap: 8, paddingHorizontal: PAD, marginVertical: 12 },
  searchToolbarLabel: { ...MT.caption, flex: 1, textAlign: "left", color: M.muted },
  searchBar: { flexDirection: "row", alignItems: "center", minHeight: 58, borderRadius: 6, paddingLeft: 12, backgroundColor: M.sheet, borderWidth: 1, borderColor: M.line, marginHorizontal: PAD },
  input: { ...MT.body, flex: 1, minWidth: 0, color: M.ink, textAlign: "right", paddingHorizontal: 10, paddingVertical: 12 },
  clearQuery: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  filterBadge: { position: "absolute", top: -5, right: -5, minWidth: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: M.accent },
  filterBadgeText: { ...MT.number, fontSize: 10, color: M.white },
  activeFiltersRow: { flexDirection: "row-reverse", flexGrow: 1, paddingHorizontal: PAD, paddingTop: 12, gap: 8 },
  filterPill: { minHeight: 44, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 4, backgroundColor: M.accentWash },
  filterPillText: { ...MT.caption, color: M.accent },
  resultHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: PAD, marginTop: 16, gap: 12 },
  resultCount: { ...MT.label, flexShrink: 1, textAlign: "right", color: M.muted },
  loadMoreBtn: { alignSelf: "center", minHeight: 52, marginVertical: 24, paddingHorizontal: 28, borderRadius: 4, borderWidth: 1, borderColor: M.ink, backgroundColor: M.sheet, justifyContent: "center" },
  loadMoreText: { ...MT.label, color: M.ink },
  searchProgressRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8, paddingHorizontal: PAD, paddingBottom: 8 },
  searchProgressText: { ...MT.caption, color: M.muted },
  modalBackdrop: { ...MANGA_FILL, backgroundColor: M.scrim },
  filterSheet: { position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "90%", backgroundColor: M.paper, borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: PAD, paddingTop: 16, paddingBottom: 12, gap: 12, borderBottomWidth: 1, borderColor: M.line },
  sheetTitle: { ...MT.heading, flexShrink: 1, color: M.ink, textAlign: "right" },
  genreSearch: { minHeight: 56, marginHorizontal: PAD, marginVertical: 12, paddingHorizontal: 12, borderRadius: 4, borderWidth: 1, borderColor: M.line, backgroundColor: M.sheet, flexDirection: "row", alignItems: "center", gap: 8 },
  filterScroll: { flexShrink: 1 },
  filterBody: { paddingBottom: 12 },
  filterBlock: { paddingHorizontal: PAD, paddingVertical: 14, alignItems: "flex-end", gap: 10 },
  filterLabel: { ...MT.label, color: M.ink },
  filterChoices: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 8 },
  genreGrid: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 8, width: "100%" },
  genreLimitText: { ...MT.caption, color: M.muted, textAlign: "right" },
  filterActions: { flexDirection: "row-reverse", gap: 12, paddingHorizontal: PAD, paddingTop: 12, borderTopWidth: 1, borderTopColor: M.line },
  filterApply: { flex: 1, minHeight: 56, padding: 10, alignItems: "center", justifyContent: "center", backgroundColor: M.accent, borderRadius: 4 },
  filterApplyText: { ...MT.label, color: M.white },
  filterClear: { paddingHorizontal: 16, minHeight: 56, alignItems: "center", justifyContent: "center", borderRadius: 4, backgroundColor: M.wash },
  filterClearText: { ...MT.label, color: M.ink },
  choiceChip: { minHeight: 44, paddingHorizontal: 14, paddingVertical: 4, justifyContent: "center", borderRadius: 4, backgroundColor: M.sheet, borderWidth: 1, borderColor: M.line },
  choiceChipActive: { backgroundColor: M.ink, borderColor: M.ink },
  choiceChipText: { ...MT.label, color: M.muted },
  choiceChipTextActive: { color: M.white },
  skeletonWrap: { paddingHorizontal: PAD, paddingTop: 16, gap: 16 },
  skeletonHero: { height: 218, width: "100%" },
  skeletonRow: { flexDirection: "row", gap: GAP, justifyContent: "flex-end" },
  skeletonPoster: { flex: 1, aspectRatio: 2 / 3 },
});

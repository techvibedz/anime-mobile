import { useEffect, useState, useCallback, useMemo, useRef, memo, startTransition } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Dimensions,
  StyleSheet,
  Modal,
  I18nManager,
  ActivityIndicator,
  RefreshControl,
  InteractionManager,
  Share,
  Animated,
  Easing,
  Keyboard,
  TextInput,
} from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, router, useFocusEffect } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { fetchEpisodes, fetchEpisodesUp4, fetchAnime3rbEpisodes, searchAnime } from "../../lib/api";
import type { AnimeDetail, Episode, SearchResult } from "../../lib/api";
import { addFavorite, removeFavorite, favoriteListOf, subscribeFavorites } from "../../lib/favorites";
import type { FavoriteList } from "../../lib/favorites";
import { getCompletedSets, isEpisodeWatched, animeTitleKey, normHref, toggleWatched, type CompletedSets } from "../../lib/history";
import { recordAnimeCompletion } from "../../lib/completion";
import { fetchSeriesFinished } from "../../lib/airing";
import { getDownloads, subscribeDownloads, type DownloadStatus, type DownloadMeta } from "../../lib/downloads";
import { fetchAnimeInfo, fetchAnimeMal, fetchAnimeRelations, getAltTitles, peekMalRating } from "../../lib/animeInfo";
import type { AnimeInfoField, RelatedAnimeEntry } from "../../lib/animeInfo";
import { normLatin, seasonNum, formatCat } from "../../lib/relations";
import { MalBadge, MalCardBadge } from "../../components/MalRating";
import { AiringCountdown } from "../../components/AiringCountdown";
import { Shimmer } from "../../components/Shimmer";
import { GlassFill } from "../../components/GlassFill";
import { DownloadPicker } from "../../components/DownloadPicker";
import { PosterCard } from "../../components/PosterCard";
import { C, R, S, TAr, ELEVATION_CARD, ELEVATION_GLOW, ELEVATION_NAV } from "../../lib/theme";
import { posterUrl } from "../../lib/img";
import { t } from "../../lib/i18n";
import { Rise } from "../../components/Rise";
import { useReducedMotion } from "../../lib/motion";
import { useSidebar } from "../../components/Sidebar";
import { shouldShowSynopsis, synopsisForDisplay } from "../../lib/animeDetail";

// Core React Native bundles a Clipboard native module (no extra dependency), so
// copying works over OTA on the existing build. Deep-import since the top-level
// `Clipboard` export was removed from react-native.
const Clipboard = require("react-native/Libraries/Components/Clipboard/Clipboard")
  .default as { setString(s: string): void };

const { width: SW } = Dimensions.get("window");
const BANNER_H = 360;
const PAD = S.paddingContent;
const EP_CARD_WIDTH = (SW - PAD * 2 - 10) / 2;

type TabKey = "episodes" | "related" | "info";

export default function AnimeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { openSidebar } = useSidebar();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AnimeDetail | null>(null);
  const [episodes4up, setEpisodes4up] = useState<Episode[]>([]);
  const [episodes3rb, setEpisodes3rb] = useState<Episode[]>([]);
  const [merged, setMerged] = useState<{ anime4up: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [synopsisOpen, setSynopsisOpen] = useState(false);
  const [bookmarkList, setBookmarkList] = useState<FavoriteList | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("episodes");
  // Completed-episode index (across all anime). Carries both per-href matches
  // (same source) and per-anime episode-number matches (cross source), so a
  // "watched" badge shows regardless of which source the episode was played in.
  const [completed, setCompleted] = useState<CompletedSets>({ hrefs: new Set(), numbersByTitle: new Map() });
  const [malScore, setMalScore] = useState<number | null>(null);
  // Related anime (sequels, prequels, side stories, spin-offs) from AniList —
  // the source sites carry no related section, so these are resolved by title.
  const [relations, setRelations] = useState<RelatedAnimeEntry[]>([]);
  const [relationsLoading, setRelationsLoading] = useState(true);
  const [titleCopied, setTitleCopied] = useState(false);
  const [posterOpen, setPosterOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const detailScrollRef = useRef<ScrollView>(null);
  const tabContentYRef = useRef(0);
  const scrollToEpisodeOffset = useCallback((offset: number) => {
    detailScrollRef.current?.scrollTo({
      y: Math.max(0, tabContentYRef.current + offset - 12),
      animated: true,
    });
  }, []);
  const bookmarked = bookmarkList !== null;
  const animeHref = id ? decodeURIComponent(id) : "";
  const isMainSource = /witanime/i.test(animeHref);

  useEffect(() => {
    if (!id) return;
    const url = decodeURIComponent(id);
    let cancelled = false;
    let resolvedTitle: string | null = null;
    (async () => {
      try {
        // Primary scrape — return as soon as witanime data is ready so the
        // UI renders episodes within a few seconds. onUpdated fires when the
        // background revalidation finds visibly newer data (a newly-aired
        // episode), so the list refreshes itself without a manual reload.
        const res = await fetchEpisodes(url, (fresh) => {
          if (cancelled || !fresh?.success) return;
          setData(fresh.data);
          setEpisodes4up(fresh.data.episodes4up || []);
          setMerged(fresh.data.merged || null);
        });
        if (cancelled) return;
        if (res.success) {
          resolvedTitle = res.data.title;
          setData(res.data);
          setEpisodes4up(res.data.episodes4up || []);
          setMerged(res.data.merged || null);
        } else {
          setError(t.failedToLoad);
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? t.failedToLoad);
      } finally {
        if (!cancelled) setLoading(false);
      }
      // Background enrichment — find anime4up URL + scrape its episodes so
      // the "both sources" badge appears and url4up flows to /watch.
      // This runs after the UI is already showing, so the user doesn't wait.
      try {
        const enrich = await fetchEpisodesUp4(url, resolvedTitle);
        if (cancelled) return;
        if (enrich.merged) setMerged(enrich.merged);
        if (enrich.episodes4up.length > 0) setEpisodes4up(enrich.episodes4up);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [id]);

  // Re-check on focus and whenever local/cloud favorites change. Cloud hydration
  // happens asynchronously after sign-in, so a one-time mount check can race it
  // and leave an already-favorited anime showing an empty heart.
  useFocusEffect(useCallback(() => {
    if (!id) return;
    let active = true;
    const refresh = () => {
      favoriteListOf(decodeURIComponent(id)).then((list) => {
        if (active) setBookmarkList(list);
      });
    };
    refresh();
    const unsubscribe = subscribeFavorites(refresh);
    return () => { active = false; unsubscribe(); };
  }, [id]));

  // Resolve the lightweight MyAnimeList score for the header badge once the
  // title is known. The slower full facts load only when the Info tab opens.
  useEffect(() => {
    if (!data?.title) return;
    setMalScore(peekMalRating(data.title) ?? null);
    let cancelled = false;
    fetchAnimeMal(data.title).then((m) => { if (!cancelled) setMalScore(m.score); });
    return () => { cancelled = true; };
  }, [data?.title]);

  // Resolve related anime (other seasons, side stories, spin-offs) once the
  // title is known. Runs after the UI is showing, so it never blocks render;
  // the Related tab appears the moment AniList answers.
  useEffect(() => {
    if (!data?.title) return;
    let cancelled = false;
    setRelationsLoading(true);
    fetchAnimeRelations(data.title, animeHref).then((r) => {
      if (!cancelled) setRelations(r);
    }).finally(() => {
      if (!cancelled) setRelationsLoading(false);
    });
    return () => { cancelled = true; };
  }, [data?.title, animeHref]);

  // Background: pull anime3rb's full episode list (a third source for the
  // cross-source union). witanime is often a week behind and anime4up paginates,
  // so anime3rb frequently carries the newest episode the others are missing.
  // Skip when the page itself is already an anime3rb page (its episodes are the
  // primary list). Runs after the UI is showing, so it never blocks render.
  useEffect(() => {
    if (!data?.title) return;
    if (/anime3rb\.com/i.test(animeHref)) return;
    let cancelled = false;
    fetchAnime3rbEpisodes(data.title)
      .then((eps) => { if (!cancelled && eps.length > 0) setEpisodes3rb(eps); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [data?.title, animeHref]);

  // Refresh watched flags when the screen regains focus (e.g. after watching).
  useFocusEffect(useCallback(() => {
    getCompletedSets().then(setCompleted);
  }, []));

  // The two cross-source lists (anime4up + anime3rb) are resolved by TITLE, so a
  // fuzzy match can land on the WRONG entry — a split-cour or continuous-numbered
  // listing whose episodes are numbered 13–24 instead of 1–12. Merging that by
  // number doubled the count (a 12-episode anime suddenly showed 24). Only trust
  // a secondary source when it OVERLAPS the opened page's own episode numbers;
  // zero overlap means it resolved to a different anime/season, so drop it. When
  // the page's own list is empty (primary scrape failed) we keep the secondaries
  // — they're the only data we have to validate against.
  const trusted = useMemo(
    () => trustedSources(data?.episodes ?? [], episodes4up, episodes3rb),
    [data?.episodes, episodes4up, episodes3rb],
  );

  // Record this anime's completion state — the data behind the poster-card
  // badges (lib/completion) and the profile's "completed" stat. Recomputed
  // whenever the merged episode list or the watched-set changes, so watching the
  // last available episode flips the badge on, and a newly-aired episode flips it
  // back off. "finished" is gated on the series no longer airing, so a still-
  // running show's latest episode reads as "caught up" rather than "completed".
  // Derive the last episode number + whether it's been watched. Memoized so the
  // recording effect below depends only on these PRIMITIVES — not the `completed`
  // object (which gets a new reference on every focus) — so toggling any
  // non-final episode no longer re-fires the AniList airing check.
  const { maxNum, caughtUp } = useMemo(() => {
    if (!data) return { maxNum: 0, caughtUp: false };
    const all = [...data.episodes, ...trusted.up4, ...trusted.a3rb];
    let mx = 0;
    let hasNum = false;
    for (const e of all) {
      if (e.number != null && e.number > mx) { mx = e.number; hasNum = true; }
    }
    if (!hasNum) return { maxNum: 0, caughtUp: false };
    const lastHrefs = all.filter((e) => e.number === mx).map((e) => e.href);
    return { maxNum: mx, caughtUp: isEpisodeWatched(completed, { hrefs: lastHrefs, epNum: mx, animeTitle: data.title }) };
  }, [data, trusted, completed]);

  useEffect(() => {
    if (!data || !animeHref || maxNum === 0) return;
    let cancelled = false;
    (async () => {
      const finished = caughtUp ? await fetchSeriesFinished(data.title, maxNum) : false;
      if (cancelled) return;
      // Record EVERY known source href + title so a card from any source rail
      // (e.g. the anime4up-sourced "this season" rail) resolves the badge — not
      // just the URL the anime happened to be opened under.
      await recordAnimeCompletion({
        hrefs: [animeHref, merged?.anime4up],
        titles: [data.title],
        lastEpNum: maxNum,
        caughtUp,
        finished,
      }).catch(() => {});
    })();
    return () => { cancelled = true; };
  }, [data?.title, animeHref, merged?.anime4up, maxNum, caughtUp]);

  const handleToggleWatched = useCallback(async (ep: GridEpisode) => {
    // Use whichever source href exists so source-only episodes (no witanime
    // href) can still be toggled — and store under that same href so the
    // marker matches on the next render. The episode number rides along so the
    // flag bridges to the other sources too.
    const primary = ep.href || ep.href4up || ep.href3rb;
    if (!data || !primary) return;
    await toggleWatched(primary, {
      episodeTitle: ep.title || `${t.episode} ${ep.number}`,
      animeTitle: data.title,
      animeHref,
      image: data.poster,
      epNum: ep.number ?? undefined,
    });
    // Re-read the index so both the href and per-title number sets reflect the
    // toggle (a cross-source episode has no href in this page to flip locally).
    getCompletedSets().then(setCompleted);
  }, [data, animeHref]);

  // Tapping the heart: if not saved, open the picker so the user chooses Watching vs Planned.
  // If already saved, remove from list.
  const toggleBookmark = useCallback(async () => {
    if (!data || !id) return;
    const href = decodeURIComponent(id);
    if (bookmarked) {
      await removeFavorite(href);
      setBookmarkList(null);
    } else {
      setPickerOpen(true);
    }
  }, [data, id, bookmarked]);

  const saveToList = useCallback(async (list: FavoriteList) => {
    if (!data || !id) return;
    const href = decodeURIComponent(id);
    const ok = await addFavorite({ title: data.title, href, image: data.poster, list });
    if (ok) setBookmarkList(list);
    setPickerOpen(false);
  }, [data, id]);

  // Long-press the title to copy it instantly — no manual text selection.
  const copyTitle = useCallback(() => {
    if (!data?.title) return;
    Clipboard.setString(data.title);
    setTitleCopied(true);
    setTimeout(() => setTitleCopied(false), 1500);
  }, [data?.title]);

  // Share the anime by title. The href is a rotating scraper URL (not a stable
  // public link), so we share the title text — the recipient finds it in-app.
  const shareAnime = useCallback(() => {
    if (!data?.title) return;
    Share.share({ message: t.shareAnime(data.title) }).catch(() => {});
  }, [data?.title]);

  // Pull-to-refresh: re-scrape the page, its anime4up enrichment, and retry the
  // MAL rating (handy when a transient Jikan/CF blip left it without a score).
  const reload = useCallback(async () => {
    if (!animeHref) return;
    setRefreshing(true);
    try {
      const res = await fetchEpisodes(animeHref);
      if (res.success) {
        setData(res.data);
        setEpisodes4up(res.data.episodes4up || []);
        setMerged(res.data.merged || null);
        setError(null);
        fetchAnimeMal(res.data.title).then((m) => setMalScore(m.score)).catch(() => {});
      }
      try {
        const enrich = await fetchEpisodesUp4(animeHref, res.data.title);
        if (enrich.merged) setMerged(enrich.merged);
        if (enrich.episodes4up.length > 0) setEpisodes4up(enrich.episodes4up);
      } catch {}
    } catch {} finally {
      setRefreshing(false);
    }
  }, [animeHref]);

  if (loading) return <DetailSkeleton />;

  if (error || !data) {
    return (
      <View style={[ss.root, ss.center]}>
        <View style={ss.errorCircle}>
          <Ionicons name="alert" size={28} color={C.accent} />
        </View>
        <Text style={ss.errorMsg}>{error ?? t.notFound}</Text>
        <Pressable onPress={() => router.back()} style={ss.btnPrimary}>
          <Text style={ss.btnPrimaryText}>{t.goBack}</Text>
        </Pressable>
      </View>
    );
  }

  const firstPlayable = data.episodes.find((e) => e.href);
  const synopsis = synopsisForDisplay(data.synopsis);
  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: "episodes", label: t.tabEpisodes, count: data.totalEpisodes },
    { key: "related", label: t.tabRelated, count: relationsLoading ? undefined : relations.length },
    { key: "info", label: t.tabInfo },
  ];

  return (
    <View style={ss.root}>
      <ScrollView
        ref={detailScrollRef}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={reload}
            tintColor={C.accent}
            colors={[C.accent]}
            progressBackgroundColor={C.surface}
          />
        }
      >
        {/* ── Banner ─────────────────────────── */}
        <View style={ss.banner}>
          {(data.banner || data.poster) ? (
            <Image
              source={{ uri: posterUrl(data.banner || data.poster, SW) }}
              style={{ width: SW, height: BANNER_H }}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={200}
            />
          ) : null}
          <LinearGradient
            colors={["rgba(10,10,11,0.35)", "transparent", "rgba(10,10,11,0.6)", C.bg]}
            locations={[0, 0.28, 0.62, 1]}
            style={StyleSheet.absoluteFill}
          />
        </View>

        {/* ── Hero — poster punches through the banner ──────── */}
        <Rise style={ss.hero}>
          <View style={ss.heroRow}>
            {data.poster ? (
              <Pressable
                onPress={() => setPosterOpen(true)}
                style={({ pressed }) => [ss.heroPosterPressable, pressed && { opacity: 0.86 }]}
                accessibilityRole="imagebutton"
                accessibilityLabel={t.viewPoster}
              >
                <Image
                  source={{ uri: posterUrl(data.poster, 240) }}
                  style={ss.heroPoster}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  transition={200}
                />
                <View style={ss.posterExpandBadge} pointerEvents="none">
                  <Ionicons name="expand-outline" size={13} color={C.white} />
                </View>
              </Pressable>
            ) : (
              <View style={[ss.heroPoster, ss.heroPosterFallback]}>
                <Ionicons name="image-outline" size={26} color={C.textMuted} />
              </View>
            )}
            <View style={ss.heroText}>
              <Pressable onLongPress={copyTitle} delayLongPress={350}>
                <Text style={ss.title}>{data.title}</Text>
              </Pressable>
              {titleCopied && (
                <View style={ss.copiedPill}>
                  <Ionicons name="checkmark-circle" size={13} color={C.accent} />
                  <Text style={ss.copiedText}>{t.titleCopied}</Text>
                </View>
              )}

              {/* Quick meta — MAL rating badge; full genre list lives below the synopsis */}
              {(malScore != null || data.rating) && (
                <View style={ss.quickMeta}>
                  <MalBadge score={malScore} />
                  {data.rating && (
                    <View style={ss.ratingPill}>
                      <Ionicons name="star" size={12} color={C.gold} />
                      <Text style={ss.ratingText}>{data.rating}</Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          </View>

          {/* Next-episode countdown — only shows for currently-airing anime */}
          <AiringCountdown title={data.title} />

          {/* Synopsis */}
          {shouldShowSynopsis(animeHref, synopsis) ? (
            <Pressable onPress={() => setSynopsisOpen((v) => !v)}>
              <Text style={ss.synopsis} numberOfLines={synopsisOpen ? undefined : 3}>
                {synopsis}
              </Text>
              <Text style={ss.readMore}>{synopsisOpen ? t.showLess : t.readMore}</Text>
            </Pressable>
          ) : null}

          {/* All genre chips */}
          <View style={ss.chipRow}>
            {data.genres.map((g, i) => (
              <View key={i} style={ss.chip}>
                <GlassFill intensity={16} />
                <Text style={ss.chipText}>{g}</Text>
              </View>
            ))}
          </View>
        </Rise>

        {/* ── Glow divider ──────────────────── */}
        <View style={ss.glowLine} />

        {/* ── Tab Bar ───────────────────────── */}
        <View style={ss.tabBar}>
          {tabs.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <Pressable
                key={tab.key}
                onPress={() => setActiveTab(tab.key)}
                style={[ss.tabItem, active && ss.tabItemActive]}
              >
                <Text style={[ss.tabText, active && ss.tabTextActive]}>{tab.label}</Text>
                {tab.count != null && (
                  <View style={[ss.tabCount, active && ss.tabCountActive]}>
                    <Text style={[ss.tabCountText, active && ss.tabCountTextActive]}>{tab.count}</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>

        {/* ── Tab Content ───────────────────── */}
        <View
          style={ss.tabContent}
          onLayout={(event) => { tabContentYRef.current = event.nativeEvent.layout.y; }}
        >
          {activeTab === "episodes" && (
            <EpisodesTab
              episodes={data.episodes}
              episodes4up={trusted.up4}
              episodes3rb={trusted.a3rb}
              merged={merged}
              poster={data.poster}
              completed={completed}
              onToggleWatched={handleToggleWatched}
              animeHref={animeHref}
              animeTitle={data.title}
              onJumpToOffset={scrollToEpisodeOffset}
            />
          )}
          {activeTab === "related" && <RelatedTab items={relations} loading={relationsLoading} />}
          {activeTab === "info" && <InfoTab data={data} isMainSource={isMainSource} />}
        </View>
      </ScrollView>

      {/* ── Floating top bar — back + menu ──── */}
      <View style={[ss.topBar, { top: insets.top + 8 }]}>
        <GlassCircleBtn icon="chevron-back" onPress={() => router.back()} />
        <GlassCircleBtn icon="menu" onPress={openSidebar} />
      </View>

      {/* ── Floating action bar — playback is always one tap away ── */}
      <View style={[ss.actionBar, { paddingBottom: insets.bottom + 10 }]}>
        <GlassFill intensity={26} />
        <Pressable
          style={ss.actionPlayWrap}
          onPress={() => firstPlayable?.href && router.push(`/watch/${encodeURIComponent(firstPlayable.href)}`)}
        >
          <LinearGradient colors={[C.accent, C.mint]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={ss.actionPlayGrad}>
            <Ionicons name="play" size={16} color={C.textOnAccent} />
            <Text style={ss.btnPrimaryText}>{t.watchNow}</Text>
          </LinearGradient>
        </Pressable>
        <Pressable style={ss.actionIcon} onPress={toggleBookmark}>
          <Ionicons name={bookmarked ? "heart" : "heart-outline"} size={20} color={bookmarked ? C.accent : C.text} />
        </Pressable>
        <Pressable style={ss.actionIcon} onPress={shareAnime}>
          <Ionicons name="share-outline" size={19} color={C.text} />
        </Pressable>
      </View>

      {/* ── Add-to-list picker (slide-up sheet) ───────────────── */}
      {pickerOpen && (
        <ListPickerSheet title={data.title} onPick={saveToList} onClose={() => setPickerOpen(false)} />
      )}

      {/* Full-resolution poster viewer. The hardware back button and the
          visible top button both close the modal without leaving this anime. */}
      {data.poster && (
        <Modal
          visible={posterOpen}
          animationType="fade"
          presentationStyle="fullScreen"
          statusBarTranslucent
          onRequestClose={() => setPosterOpen(false)}
        >
          <View style={ss.posterViewer}>
            <ActivityIndicator style={ss.posterViewerLoader} size="large" color={C.accent} />
            <Image
              source={{ uri: posterUrl(data.poster, SW, 1200) }}
              style={ss.posterViewerImage}
              contentFit="contain"
              cachePolicy="memory-disk"
              transition={250}
            />
            <LinearGradient
              colors={["rgba(0,0,0,0.78)", "rgba(0,0,0,0.22)", "transparent"]}
              style={ss.posterViewerTopGradient}
              pointerEvents="none"
            />
            <Pressable
              onPress={() => setPosterOpen(false)}
              style={[ss.posterViewerBack, { top: insets.top + 10 }]}
              accessibilityRole="button"
              accessibilityLabel={t.back}
            >
              <Ionicons name="chevron-back" size={21} color={C.white} />
              <Text style={ss.posterViewerBackText}>{t.back}</Text>
            </Pressable>
            <Text style={[ss.posterViewerTitle, { bottom: insets.bottom + 18 }]} numberOfLines={2}>
              {data.title}
            </Text>
          </View>
        </Modal>
      )}
    </View>
  );
}

/* ── Add-to-list bottom sheet ────────────────── */

function ListPickerSheet({ title, onPick, onClose }: { title: string; onPick: (list: FavoriteList) => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const translateY = useRef(new Animated.Value(reduced ? 0 : 520)).current;
  const backdrop = useRef(new Animated.Value(reduced ? 1 : 0)).current;

  useEffect(() => {
    if (reduced) return;
    Animated.parallel([
      Animated.timing(translateY, { toValue: 0, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(backdrop, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
  }, []);

  const animateClose = () => {
    if (reduced) { onClose(); return; }
    Animated.parallel([
      Animated.timing(translateY, { toValue: 520, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(backdrop, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(({ finished }) => { if (finished) onClose(); });
  };

  return (
    <Modal transparent visible animationType="none" onRequestClose={animateClose}>
      <View style={{ flex: 1 }}>
        <Pressable style={StyleSheet.absoluteFill} onPress={animateClose}>
          <Animated.View style={[StyleSheet.absoluteFill, ss.sheetBackdrop, { opacity: backdrop }]} />
        </Pressable>
        <View style={ss.sheetAnchor} pointerEvents="box-none">
          <Animated.View
            style={[ss.sheetPanel, { paddingBottom: insets.bottom + 16, transform: [{ translateY }] }]}
            onStartShouldSetResponder={() => true}
          >
            <View style={ss.sheetGrabber} />
            <Text style={ss.pickerTitle}>{t.addToList}</Text>
            <Text style={ss.pickerSub}>{t.saveWhere(title)}</Text>

            <Pressable style={ss.pickerOption} onPress={() => onPick("watching")}>
              <View style={[ss.pickerIcon, { backgroundColor: C.accent + "22" }]}>
                <Ionicons name="play-circle" size={22} color={C.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={ss.pickerOptTitle}>{t.currentlyWatching}</Text>
                <Text style={ss.pickerOptSub}>{t.watchingDesc}</Text>
              </View>
              <Ionicons name={I18nManager.isRTL ? "chevron-back" : "chevron-forward"} size={18} color={C.textMuted} />
            </Pressable>

            <Pressable style={ss.pickerOption} onPress={() => onPick("planned")}>
              <View style={[ss.pickerIcon, { backgroundColor: C.accent + "22" }]}>
                <Ionicons name="bookmark" size={20} color={C.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={ss.pickerOptTitle}>{t.planToWatch}</Text>
                <Text style={ss.pickerOptSub}>{t.plannedDesc}</Text>
              </View>
              <Ionicons name={I18nManager.isRTL ? "chevron-back" : "chevron-forward"} size={18} color={C.textMuted} />
            </Pressable>

            <Pressable style={ss.pickerCancel} onPress={animateClose}>
              <Text style={ss.pickerCancelText}>{t.cancel}</Text>
            </Pressable>
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

function GlassCircleBtn({ icon, color = C.text, onPress }: { icon: string; color?: string; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <View style={ss.glassCircle}>
        <GlassFill intensity={16} />
        <Ionicons name={icon as any} size={20} color={color} />
      </View>
    </Pressable>
  );
}

/* ── Cross-source trust guard ───────────────── */
// anime4up + anime3rb episode lists are resolved by TITLE, so a fuzzy match can
// land on a different anime/season whose episodes are numbered disjointly (e.g.
// a split-cour entry numbered 13–24 instead of 1–12). Unioning that by number
// doubled the episode count.
//
// A zero-overlap secondary clearly resolved to the wrong entry, so it's dropped.
// But a PARTIAL-overlap secondary is just as wrong: a title like "Dr. Stone:
// Science Future Part 3" resolves on the other sites to the CONTINUOUS-numbered
// full-series listing, which shares the anchor's numbers (passing a simple
// overlap test) yet also carries dozens of episodes from the OTHER parts/cours.
// Appended, those inflate the count well past the part's real episode list.
//
// So a secondary is clamped to the anchor's own episode-number RANGE — keeping
// gap-fills (a number missing from witanime but inside its range) while dropping
// any cross-part block that falls outside it. The lookahead past the max is 0:
// allowing even one episode beyond the anchor let the continuous-numbered
// full-series listing append the NEXT part's episode 1 (numbered max+1), so the
// detail page still showed one foreign episode. The home "new episodes" feed
// surfaces genuinely-newer episodes separately. When the page's own list is
// empty (the primary scrape failed) the secondaries are the only data we have,
// so they're kept as-is.
const NEWER_EP_LOOKAHEAD = 0;

function trustedSources(
  anchor: Episode[],
  up4: Episode[],
  a3rb: Episode[],
): { up4: Episode[]; a3rb: Episode[] } {
  const anchorNums = new Set<number>();
  for (const e of anchor) if (e.number != null) anchorNums.add(e.number);
  if (anchorNums.size === 0) return { up4, a3rb };
  let min = Infinity;
  let max = -Infinity;
  for (const n of anchorNums) {
    if (n < min) min = n;
    if (n > max) max = n;
  }
  const ceil = max + NEWER_EP_LOOKAHEAD;
  const clamp = (list: Episode[]) => {
    // Must share at least one number (zero overlap = wrong entry entirely)…
    let overlaps = false;
    for (const e of list) if (e.number != null && anchorNums.has(e.number)) { overlaps = true; break; }
    if (!overlaps) return [];
    // …then keep only episodes within the anchor's own range (+ newest lookahead),
    // so a continuous-numbered cross-part listing can't append foreign episodes.
    return list.filter((e) => e.number != null && e.number >= min && e.number <= ceil);
  };
  return { up4: clamp(up4), a3rb: clamp(a3rb) };
}

/* ── Tab: Episodes ──────────────────────────── */

function EpisodesTab({
  episodes,
  episodes4up,
  episodes3rb,
  merged,
  poster,
  completed,
  onToggleWatched,
  animeHref,
  animeTitle,
  onJumpToOffset,
}: {
  episodes: AnimeDetail["episodes"];
  episodes4up: Episode[];
  episodes3rb: Episode[];
  merged: { anime4up: string } | null;
  poster: string;
  completed: CompletedSets;
  onToggleWatched: (ep: GridEpisode) => void;
  animeHref: string;
  animeTitle: string;
  onJumpToOffset: (offset: number) => void;
}) {
  const [sortDesc, setSortDesc] = useState(true); // true = newest first
  const [episodeQuery, setEpisodeQuery] = useState("");
  const [jumpError, setJumpError] = useState(false);
  const [highlightedEpisode, setHighlightedEpisode] = useState<number | null>(null);
  const gridYRef = useRef(0);
  const episodeOffsetsRef = useRef(new Map<number, number>());
  const pendingJumpEpisodeRef = useRef<number | null>(null);
  // Live per-episode download state, keyed by the episode's primary href, so each
  // grid card can show idle / progress / done and trigger an offline save.
  const [downloads, setDownloads] = useState<Record<string, { status: DownloadStatus; progress: number }>>({});
  const [dlPicker, setDlPicker] = useState<DownloadMeta | null>(null);
  useEffect(() => {
    const sync = () => getDownloads().then((list) => {
      const m: Record<string, { status: DownloadStatus; progress: number }> = {};
      for (const d of list) m[d.episodeHref] = { status: d.status, progress: d.progress };
      setDownloads(m);
    });
    sync();
    return subscribeDownloads(sync);
  }, []);

  const onDownloadEp = useCallback((ep: GridEpisode) => {
    const primary = ep.href || ep.href4up || ep.href3rb;
    if (!primary) return;
    setDlPicker({
      animeTitle,
      episodeTitle: ep.title || `${t.episode} ${ep.number}`,
      epNum: ep.number ?? null,
      image: poster,
      animeHref,
      episodeHref: primary,
      url4up: ep.href4up || undefined,
      url3rb: ep.href3rb || undefined,
    });
  }, [animeTitle, poster, animeHref]);

  // Render in chunks so anime with 500+ episodes don't freeze the JS thread.
  // FIRST is a cheap first paint that mounts the moment data lands — so building
  // the grid never janks the screen-open transition or starves touch feedback
  // while the user is mid-tap. Once interactions settle we expand to PAGE (the
  // full first window); "show more" appends another PAGE each tap.
  const FIRST = 12;
  const PAGE = 80;
  const [visibleCount, setVisibleCount] = useState(FIRST);

  // Union the episode lists across ALL THREE sources, keyed by episode number,
  // so the grid is as complete as the *most up-to-date* source — not just
  // witanime. witanime frequently lags a week behind and anime4up paginates, so
  // an episode that only exists on anime4up or anime3rb still shows up and stays
  // playable (the watch screen layers each source's servers on the href). For
  // an episode present in several sources, witanime's data wins (richer
  // hrefs/screenshots); the others fill the gaps and contribute newer episodes.
  const mergedEps = useMemo(() => {
    const byNum = new Map<number, GridEpisode>();
    const ensure = (num: number, seed: Partial<GridEpisode>): GridEpisode => {
      let g = byNum.get(num);
      if (!g) {
        g = {
          title: seed.title || `${t.episode} ${num}`,
          number: num,
          type: seed.type || "",
          screenshot: seed.screenshot || "",
          href: null,
          href4up: null,
          href3rb: null,
        };
        byNum.set(num, g);
      }
      return g;
    };
    for (const ep of episodes) {
      const g = ensure(ep.number, ep);
      g.href = ep.href ?? g.href;
      g.title = ep.title || g.title;
      if (ep.type) g.type = ep.type;
      if (ep.screenshot) g.screenshot = ep.screenshot;
    }
    for (const e of episodes4up) {
      const g = ensure(e.number, e);
      g.href4up = e.href || g.href4up;
      if (!g.screenshot && e.screenshot) g.screenshot = e.screenshot;
    }
    for (const e of episodes3rb) {
      const g = ensure(e.number, e);
      g.href3rb = e.href || g.href3rb;
      if (!g.screenshot && e.screenshot) g.screenshot = e.screenshot;
    }
    return Array.from(byNum.values());
  }, [episodes, episodes4up, episodes3rb]);

  const sorted = useMemo(() => [...mergedEps].sort((a, b) => {
    const an = a.number ?? 0;
    const bn = b.number ?? 0;
    return sortDesc ? bn - an : an - bn;
  }), [mergedEps, sortDesc]);

  // Highest episode number = the last available episode. Its card gets a
  // "finale" tag so the user can see which episode finishes the anime.
  const lastEpNum = useMemo(
    () => mergedEps.reduce((m, e) => Math.max(m, e.number ?? 0), 0),
    [mergedEps],
  );

  // Ascending order, computed once — used to derive prev/next for the watch
  // screen. Previously re-sorted inside every card's onPress handler.
  const byNum = useMemo(
    () => [...mergedEps].sort((a, b) => (a.number ?? 0) - (b.number ?? 0)),
    [mergedEps],
  );

  // The set of episode numbers watched for THIS anime (cross-source), resolved
  // ONCE here instead of re-deriving the anime's title key (NFKD + regex) inside
  // every one of the 80 grid cards on every render. Cards then do a plain Set
  // lookup. This is the hot path the watched-state change made expensive.
  const watchedNumbers = useMemo(
    () => completed.numbersByTitle.get(animeTitleKey(animeTitle)) ?? null,
    [completed, animeTitle],
  );

  // Reset to the cheap first batch when the sort flips so the user sees the top
  // of the NEW order instantly; the expansion effect below re-fills the page.
  useEffect(() => {
    episodeOffsetsRef.current.clear();
    pendingJumpEpisodeRef.current = null;
    setHighlightedEpisode(null);
    setVisibleCount(FIRST);
  }, [sortDesc]);

  // Expand from the cheap first batch to the full page once the screen
  // transition + first paint have settled — so the heavy 80-card build runs
  // off the critical path and never blocks the navigation animation or taps.
  // Re-runs when the merged list grows (enrichment sources land after the UI
  // is already showing). startTransition keeps the expansion interruptible.
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      startTransition(() => setVisibleCount((n) => Math.max(n, PAGE)));
    });
    return () => task.cancel();
  }, [mergedEps.length]);

  const visible = sorted.slice(0, visibleCount);
  const hasMore = visibleCount < sorted.length;

  const scrollToEpisodeNumber = useCallback((episodeNumber: number) => {
    const offset = episodeOffsetsRef.current.get(episodeNumber);
    if (offset == null) return false;
    onJumpToOffset(gridYRef.current + offset);
    return true;
  }, [onJumpToOffset]);

  const handleEpisodeLayout = useCallback((episodeNumber: number, offset: number) => {
    episodeOffsetsRef.current.set(episodeNumber, offset);
    if (pendingJumpEpisodeRef.current !== episodeNumber) return;
    pendingJumpEpisodeRef.current = null;
    requestAnimationFrame(() => scrollToEpisodeNumber(episodeNumber));
  }, [scrollToEpisodeNumber]);

  const jumpToEpisode = useCallback(() => {
    const normalized = episodeQuery
      .trim()
      .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
      .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
    const wanted = Number(normalized);
    const index = Number.isInteger(wanted) && wanted > 0
      ? sorted.findIndex((episode) => episode.number === wanted)
      : -1;
    if (index < 0) {
      setJumpError(true);
      setHighlightedEpisode(null);
      return;
    }
    Keyboard.dismiss();
    setJumpError(false);
    setHighlightedEpisode(wanted);
    if (index < visibleCount && scrollToEpisodeNumber(wanted)) {
      return;
    }
    pendingJumpEpisodeRef.current = wanted;
    startTransition(() => setVisibleCount((count) => Math.max(count, Math.min(sorted.length, index + PAGE))));
  }, [episodeQuery, sorted, visibleCount, scrollToEpisodeNumber]);

  if (mergedEps.length === 0) {
    return (
      <View style={ss.emptyTab}>
        <Ionicons name="film-outline" size={40} color={C.textMuted} />
        <Text style={ss.emptyTabText}>{t.noEpisodes}</Text>
      </View>
    );
  }

  return (
    <>
      {/* Sort + source row */}
      <View style={ss.epToolbar}>
        <View style={ss.epToolbarLeft}>
          <Pressable
            onPress={() => setSortDesc(true)}
            style={[ss.sortChip, sortDesc && ss.sortChipActive]}
          >
            <Ionicons name="arrow-down" size={12} color={sortDesc ? C.textOnAccent : C.textSecondary} />
            <Text style={[ss.sortChipText, sortDesc && ss.sortChipTextActive]}>{t.sortNewest}</Text>
          </Pressable>
          <Pressable
            onPress={() => setSortDesc(false)}
            style={[ss.sortChip, !sortDesc && ss.sortChipActive]}
          >
            <Ionicons name="arrow-up" size={12} color={!sortDesc ? C.textOnAccent : C.textSecondary} />
            <Text style={[ss.sortChipText, !sortDesc && ss.sortChipTextActive]}>{t.sortOldest}</Text>
          </Pressable>
        </View>
        <Text style={ss.epCount}>{t.episodeCount(mergedEps.length)}</Text>
      </View>

      {merged && (
        <View style={ss.sourceBadge}>
          <Ionicons name="checkmark-circle" size={12} color={C.accent} />
          <Text style={ss.sourceBadgeText}>{t.bothSourcesMerged}</Text>
        </View>
      )}

      <View style={ss.episodeJumpRow}>
        <TextInput
          value={episodeQuery}
          onChangeText={(value) => { setEpisodeQuery(value); if (jumpError) setJumpError(false); }}
          onSubmitEditing={jumpToEpisode}
          keyboardType="number-pad"
          returnKeyType="go"
          placeholder={t.episodeJumpPlaceholder}
          placeholderTextColor={C.textMuted}
          selectionColor={C.accent}
          style={[ss.episodeJumpInput, jumpError && ss.episodeJumpInputError]}
          accessibilityLabel={t.episodeJumpPlaceholder}
        />
        <Pressable onPress={jumpToEpisode} style={ss.episodeJumpButton} accessibilityRole="button">
          <Ionicons name="locate" size={16} color={C.textOnAccent} />
          <Text style={ss.episodeJumpButtonText}>{t.goToEpisode}</Text>
        </Pressable>
      </View>
      {jumpError && <Text style={ss.episodeJumpError}>{t.episodeNotFound}</Text>}

      <Text style={ss.hint}>{t.tapToToggleWatched}</Text>

      {/* Episode grid: 2 columns for thumbnail cards */}
      <View
        style={ss.epGrid}
        onLayout={(event) => { gridYRef.current = event.nativeEvent.layout.y; }}
      >
        {visible.map((ep, i) => {
          const primary = ep.href || ep.href4up || ep.href3rb || "";
          // Cheap per-card check: href set membership (any source) OR the
          // precomputed cross-source episode-number set. No NFKD per card.
          const watched =
            (!!ep.href && completed.hrefs.has(normHref(ep.href))) ||
            (!!ep.href4up && completed.hrefs.has(normHref(ep.href4up))) ||
            (!!ep.href3rb && completed.hrefs.has(normHref(ep.href3rb))) ||
            (ep.number != null && !!watchedNumbers?.has(ep.number));
          return (
            <EpisodeGridCard
              key={`${ep.number}-${i}`}
              ep={ep}
              watched={watched}
              highlighted={ep.number === highlightedEpisode}
              onLayout={handleEpisodeLayout}
              isLast={mergedEps.length > 1 && ep.number === lastEpNum}
              poster={poster}
              animeHref={animeHref}
              animeTitle={animeTitle}
              byNum={byNum}
              onToggleWatched={onToggleWatched}
              dl={downloads[primary]}
              onDownload={onDownloadEp}
            />
          );
        })}
      </View>
      {hasMore && (
        <Pressable
          onPress={() => startTransition(() => setVisibleCount((n) => n + PAGE))}
          style={{
            marginTop: 12,
            paddingVertical: 14,
            borderRadius: R.lg,
            backgroundColor: C.surfaceLight,
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "row",
            gap: 6,
          }}
        >
          <Ionicons name="chevron-down" size={16} color={C.text} />
          <Text style={{ color: C.text, fontWeight: "600", fontSize: 13 }}>
            {t.showMore(sorted.length - visibleCount)}
          </Text>
        </Pressable>
      )}
      <DownloadPicker visible={!!dlPicker} meta={dlPicker} onClose={() => setDlPicker(null)} />
    </>
  );
}

/* ── Episode grid card (memoized) ───────────── */
// Memoized so toggling a "watched" flag (or the focus refetch of watched
// hrefs) only re-renders the single card whose state changed — not all 80
// cards in a long series. byNum is a stable reference from the parent.
type GridEpisode = Episode & { href4up: string | null; href3rb: string | null };

const EpisodeGridCard = memo(function EpisodeGridCard({
  ep,
  watched,
  highlighted,
  onLayout,
  isLast,
  poster,
  animeHref,
  animeTitle,
  byNum,
  onToggleWatched,
  dl,
  onDownload,
}: {
  ep: GridEpisode;
  watched: boolean;
  highlighted: boolean;
  onLayout: (episodeNumber: number, offset: number) => void;
  isLast: boolean;
  poster: string;
  animeHref: string;
  animeTitle: string;
  byNum: GridEpisode[];
  onToggleWatched: (ep: GridEpisode) => void;
  dl?: { status: DownloadStatus; progress: number };
  onDownload: (ep: GridEpisode) => void;
}) {
  const dlDone = dl?.status === "completed";
  const dlBusy = dl?.status === "downloading" || dl?.status === "resolving";
  const dlPct = Math.round((dl?.progress ?? 0) * 100);
  return (
    <Pressable
      disabled={!ep.href && !ep.href4up && !ep.href3rb}
      onPress={() => {
        // Pick the primary source: witanime first (richest page), then anime4up,
        // then anime3rb — so an episode missing from witanime still plays from
        // whichever source has it. Every source href + the episode number and
        // anime title ride along so the watch screen can layer the OTHER
        // sources' servers on top regardless of which one is primary.
        const primary = ep.href || ep.href4up || ep.href3rb;
        if (!primary) return;
        const up4IsPrimary = !ep.href && !!ep.href4up;
        // Derive next/prev by EPISODE NUMBER, not array index, so the
        // buttons stay correct regardless of the visible sort order.
        const sib = (e?: GridEpisode) => (e ? (e.href || e.href4up || e.href3rb || '') : '');
        const myIdx = byNum.findIndex((e) => (e.href || e.href4up || e.href3rb) === primary);
        const nextE = myIdx >= 0 ? sib(byNum[myIdx + 1]) : '';
        const prevE = myIdx >= 0 ? sib(byNum[myIdx - 1]) : '';
        // Defer the push one frame so the Pressable's pressed style (opacity +
        // scale) paints first — the watch screen's mount (video player + WebView
        // + server scrape) is heavy enough to otherwise swallow the tap feedback.
        requestAnimationFrame(() => router.push({
          pathname: `/watch/${encodeURIComponent(primary)}`,
          params: {
            url4up: up4IsPrimary ? '' : (ep.href4up || ''),
            url3rb: ep.href3rb || '',
            epNum: ep.number != null ? String(ep.number) : '',
            animeTitle: animeTitle || '',
            img: poster || '',
            nextEp: nextE,
            prevEp: prevE,
            anime: animeHref,
          },
        }));
      }}
      onLongPress={() => onToggleWatched(ep)}
      delayLongPress={300}
      onLayout={(event) => onLayout(ep.number, event.nativeEvent.layout.y)}
      style={({ pressed }) => [
        ss.epCard,
        highlighted && ss.epCardHighlighted,
        pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
      ]}
    >
      <View style={[ss.epCardThumb, watched && ss.epCardThumbWatched]}>
        {ep.screenshot ? (
          <Image source={{ uri: ep.screenshot }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={200} />
        ) : poster ? (
          <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={200} />
        ) : null}
        {watched && <View style={ss.watchedDim} />}
        <LinearGradient
          colors={["transparent", "rgba(0,0,0,0.85)"]}
          style={ss.epCardGradient}
        />
        <View style={ss.epCardPlayBtn}>
          <Ionicons name={watched ? "checkmark" : "play"} size={14} color="#fff" />
        </View>
        <View style={ss.epCardNumBadge}>
          <Text style={ss.epCardNumText}>{String(ep.number ?? '?').padStart(2, '0')}</Text>
        </View>
        {isLast && (
          <View style={ss.latestBadge}>
            <Ionicons name="sparkles" size={9} color="#fff" />
            <Text style={ss.latestBadgeText} numberOfLines={1}>{t.latestEpBadge}</Text>
          </View>
        )}
        {watched && (
          <View style={ss.watchedBadge}>
            <Ionicons name="checkmark-circle" size={11} color="#fff" />
            <Text style={ss.watchedBadgeText}>{t.watchedBadge}</Text>
          </View>
        )}
        {ep.href4up && !watched && (
          <View style={ss.epCardSourceBadge}>
            <Ionicons name="layers" size={10} color="#000" />
          </View>
        )}
        {/* Download button — top-left. Stops propagation so it never opens the
            player; shows idle / progress / done state. */}
        <Pressable
          onPress={() => { if (!dlBusy && !dlDone) onDownload(ep); else router.push("/downloads"); }}
          hitSlop={8}
          style={ss.epDownloadBtn}
        >
          {dl?.status === "downloading" ? (
            <Text style={ss.epDownloadPct}>{dlPct}%</Text>
          ) : (
            <Ionicons
              name={dlDone ? "checkmark-circle" : dlBusy ? "cloud-download" : "download-outline"}
              size={15}
              color={dlDone ? C.success : C.white}
            />
          )}
        </Pressable>
      </View>
      <Text style={[ss.epCardTitle, watched && { color: C.textMuted }]} numberOfLines={1}>
        {`${t.episode} ${ep.number ?? ''}`.trim()}
      </Text>
    </Pressable>
  );
});

/* ── Tab: Related ───────────────────────────── */

// Score how well a search result's title matches the wanted related title.
// Latin-folded equality/containment first, then token overlap, with a
// season match bonus / mismatch penalty so "Season 2" doesn't latch onto
// Season 1. Mirrors the scorer in lib/relations but for plain result titles.
//
// The season penalty is HARSHER here than in lib/relations: resolving a card to
// a source page is the step that opens the actual wrong anime, so a "Season N"
// card must not settle for the base series when the site simply doesn't carry
// that season — better to report "not found" than open Season 1.
function scoreRelatedMatch(want: string, got: string): number {
  const w = normLatin(want);
  const g = normLatin(got);
  if (!w || !g) return 0;
  let s: number;
  if (g === w) s = 100;
  else if (g.startsWith(w) || w.startsWith(g)) s = 82;
  else if (g.includes(w) || w.includes(g)) s = 70;
  else {
    const wt = w.split(" ").filter((x) => x.length > 1);
    const gt = new Set(g.split(" ").filter((x) => x.length > 1));
    let shared = 0;
    for (const x of wt) if (gt.has(x)) shared++;
    s = wt.length ? Math.round((shared / wt.length) * 64) : 0;
  }
  const ws = seasonNum(want);
  const gs = relatedSeasonNum(got, ws);
  if (ws > 0 && gs > 0) s += ws === gs ? 10 : -25;
  else if (ws > 0 && gs === 0) s -= 14;
  return s;
}

function stripRelatedSeasonNoise(latin: string): string {
  return latin
    .replace(/\b([0-9]+)(?:st|nd|rd|th)\s+season\b/g, " ")
    .replace(/\b(season|part|cour)\s*[0-9]*\b/g, " ")
    .replace(/\bs[0-9]+\b/g, " ")
    .replace(/\b(first|second|third|fourth|fifth|sixth)\s+season\b/g, " ")
    .replace(/\b(i|ii|iii|iv|v|vi)\s*$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function relatedSeasonNum(title: string, expectedSeason = 0): number {
  const explicit = seasonNum(title);
  if (explicit > 0) return explicit;
  if (expectedSeason <= 0) return 0;
  const trailing = normLatin(title).match(/\b([2-9][0-9]?)$/);
  return trailing ? parseInt(trailing[1], 10) : 0;
}

function relatedNumberedSeasonVariants(title: string): string[] {
  const season = seasonNum(title);
  if (season <= 0) return [];
  const base = stripRelatedSeasonNoise(normLatin(title));
  return base ? [`${base} ${season}`, `${base} Season ${season}`] : [];
}

// Best title-match score for a result against EVERY name the related entry is
// known by (AniList romaji + English). The source sites index an anime under
// only one language, so a romaji-only score misses results listed in English.
type RelatedLookupEntry = RelatedAnimeEntry & { lookupTitles?: string[] };

function relatedLookupTitles(entry: RelatedLookupEntry): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (title: string | null | undefined) => {
    const v = (title || "").trim();
    const k = v.toLowerCase();
    if (v && !seen.has(k)) { seen.add(k); out.push(v); }
  };
  add(entry.title);
  add(entry.titleEnglish);
  for (const title of entry.lookupTitles || []) add(title);
  for (const title of out.slice()) {
    for (const variant of relatedNumberedSeasonVariants(title)) add(variant);
  }
  return out;
}

function bestRelatedLookupMatch(entry: RelatedLookupEntry, gotTitle: string): number {
  let best = 0;
  for (const title of relatedLookupTitles(entry)) {
    best = Math.max(best, scoreRelatedMatch(title, gotTitle));
  }
  return best;
}

// Minimum title-match confidence before a tapped related card is allowed to
// open a source page. Below this we report "not found" rather than risk opening
// a different anime. 60 clears strong containment / near-full token overlap but
// rejects a single-word coincidence and a season-mismatched base series.
const MIN_RELATED_TITLE_SCORE = 60;

function RelatedTab({ items, loading }: { items: RelatedAnimeEntry[]; loading: boolean }) {
  // AniList knows the related anime by name only — the source sites don't link
  // them — so tapping a card resolves the title to a playable source URL via
  // the same cross-source search the search screen uses, then opens its detail
  // page. A per-card spinner shows while that lookup runs.
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [notFoundId, setNotFoundId] = useState<number | null>(null);

  const openRelated = useCallback(async (entry: RelatedAnimeEntry) => {
    if (resolvingId != null) return;
    setResolvingId(entry.anilistId);
    setNotFoundId(null);

    // Score a result against the related card: title similarity (season-aware,
    // either language) that MUST clear MIN_RELATED_TITLE_SCORE, biased hard by
    // format so a 1-episode OVA card doesn't resolve to the 12-episode series.
    // `strong` = safe to open from a still-incomplete (partial) pool: a near-exact
    // title (≥82) with a compatible format. Anything weaker waits for the full
    // pool so a better candidate can still win.
    const wantFmt = formatCat(entry.format);
    const scoreOf = (r: SearchResult, lookupEntry: RelatedLookupEntry = entry): { sc: number; strong: boolean } | null => {
      const titleScore = bestRelatedLookupMatch(lookupEntry, r.title);
      if (titleScore < MIN_RELATED_TITLE_SCORE) return null; // too weak — skip
      const wantedSeason = Math.max(...relatedLookupTitles(lookupEntry).map((title) => seasonNum(title)), 0);
      if (wantedSeason > 1) {
        const gotSeason = relatedSeasonNum(r.title, wantedSeason);
        // Never open the unnumbered/base page for an explicit later-season card.
        if (gotSeason !== wantedSeason) return null;
      }
      let sc = titleScore;
      let fmtOk = true;
      if (wantFmt) {
        const gotFmt = formatCat(r.type) || formatCat(r.title);
        if (gotFmt) { sc += gotFmt === wantFmt ? 45 : -45; fmtOk = gotFmt === wantFmt; }
        else { if (wantFmt !== "tv") sc -= 15; fmtOk = wantFmt === "tv"; } // unmarked ≈ series
      }
      return { sc, strong: titleScore >= 82 && fmtOk };
    };

    // Search the source sites by BOTH names AniList knows (romaji + English) — a
    // site may index an anime under only one language. Run the queries in PARALLEL
    // and navigate the INSTANT a streamed partial yields a strong match, instead
    // of awaiting every source of every query serially (which cost ~30s worst
    // case). `navigated` doubles as the abort flag: still-running search jobs on
    // the serial bus just get their late partials ignored.
    const seen = new Set<string>();
    const pooled: SearchResult[] = [];
    let navigated = false;
    const go = (href: string) => {
      if (navigated) return;
      navigated = true;
      router.push(`/anime/${encodeURIComponent(href)}`);
    };
    const consider = (results: SearchResult[], lookupEntry: RelatedLookupEntry = entry) => {
      if (navigated) return;
      for (const r of results) {
        if (r?.href && !seen.has(r.href)) { seen.add(r.href); pooled.push(r); }
      }
      for (const r of pooled) {
        if (scoreOf(r, lookupEntry)?.strong) { go(r.href); return; }
      }
    };

    try {
      const altTitleSets = await Promise.all(
        [entry.title, entry.titleEnglish]
          .filter((q): q is string => !!q && q.trim().length > 0)
          .map((q) => getAltTitles(q).catch(() => [])),
      );
      const altTitles = altTitleSets.flat();
      const lookupEntry: RelatedLookupEntry = { ...entry, lookupTitles: altTitles };
      const queries = relatedLookupTitles(lookupEntry)
        .filter((q): q is string => !!q && q.trim().length > 0)
        .filter((q, i, a) => a.findIndex((x) => x.toLowerCase() === q.toLowerCase()) === i);
      await Promise.all(queries.map((q) =>
        searchAnime(q, (results) => consider(results, lookupEntry)).then((res) => consider(res.data.results, lookupEntry)).catch(() => {}),
      ));
      if (navigated) return;

      // No strong early hit — pick the best of the full pool.
      let hit: SearchResult | undefined;
      let best = -Infinity;
      for (const r of pooled) {
        const s = scoreOf(r, lookupEntry);
        if (s && s.sc > best) { best = s.sc; hit = r; }
      }
      if (hit?.href) {
        go(hit.href);
      } else {
        setNotFoundId(entry.anilistId);
        setTimeout(() => setNotFoundId((id) => (id === entry.anilistId ? null : id)), 2500);
      }
    } catch {
      setNotFoundId(entry.anilistId);
      setTimeout(() => setNotFoundId((id) => (id === entry.anilistId ? null : id)), 2500);
    } finally {
      setResolvingId(null);
    }
  }, [resolvingId]);

  if (loading) {
    return (
      <View style={ss.emptyTab}>
        <ActivityIndicator color={C.accent} />
        <Text style={ss.emptyTabText}>{t.loading}</Text>
      </View>
    );
  }
  if (items.length === 0) {
    return (
      <View style={ss.emptyTab}>
        <Ionicons name="film-outline" size={40} color={C.textMuted} />
        <Text style={ss.emptyTabText}>{t.noRelated}</Text>
      </View>
    );
  }
  return (
    <View style={ss.relatedGrid}>
      {items.map((item) => {
        const resolving = resolvingId === item.anilistId;
        const notFound = notFoundId === item.anilistId;
        // 2 columns — bigger, more readable posters than the old 3-col grid,
        // and a partial last row leaves a far smaller gap on the trailing
        // (left, in RTL) edge.
        const cardW = (SW - PAD * 2 - 12) / 2;
        return (
          <PosterCard
            key={item.anilistId}
            image={item.image}
            title={item.title}
            subtitle={item.format || undefined}
            onPress={() => openRelated(item)}
            width={cardW}
            recyclingKey={String(item.anilistId)}
            titleLines={2}
            topRight={<MalCardBadge title={item.title} />}
            footer={
              <View style={ss.relationBadge}>
                <Text style={ss.relationBadgeText} numberOfLines={1}>{item.relation}</Text>
              </View>
            }
            centerOverlay={
              (resolving || notFound) ? (
                <View style={ss.relatedOverlay}>
                  {resolving ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="search-outline" size={18} color="#fff" />
                      <Text style={ss.relatedOverlayText}>{t.notFound}</Text>
                    </>
                  )}
                </View>
              ) : null
            }
          />
        );
      })}
    </View>
  );
}

/* ── Tab: Info ───────────────────────────────── */

function InfoTab({ data, isMainSource }: { data: AnimeDetail; isMainSource: boolean }) {
  const [fields, setFields] = useState<AnimeInfoField[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchAnimeInfo(data.title)
      .then((f) => { if (!cancelled) setFields(f); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [data.title]);

  // Prefer the API-enriched facts; fall back to whatever the scrape provided.
  const scraped = isMainSource ? Object.entries(data.metadata).map(([label, value]) => ({ label, value })) : [];
  const rows: AnimeInfoField[] = fields && fields.length > 0 ? fields : scraped;

  if (loading && rows.length === 0) {
    return (
      <View style={ss.emptyTab}>
        <ActivityIndicator color={C.accent} />
        <Text style={ss.emptyTabText}>{t.loadingInfo}</Text>
      </View>
    );
  }

  if (rows.length === 0) {
    return (
      <View style={ss.emptyTab}>
        <Ionicons name="information-circle-outline" size={40} color={C.textMuted} />
        <Text style={ss.emptyTabText}>{t.noInfo}</Text>
      </View>
    );
  }

  return (
    <View>
      {rows.map((row, i) => (
        <View key={i} style={ss.infoRow}>
          <Text style={ss.infoLabel}>{row.label}</Text>
          <Text style={ss.infoValue}>{row.value}</Text>
        </View>
      ))}
    </View>
  );
}

/* ── Skeleton ─────────────────────────────────── */

function DetailSkeleton() {
  return (
    <View style={ss.root}>
      <Shimmer style={{ width: SW, height: BANNER_H }} borderRadius={0} />
      <View style={{ paddingHorizontal: PAD, marginTop: -88, flexDirection: "row-reverse", alignItems: "flex-end" }}>
        <Shimmer style={{ width: 112, height: 168 }} borderRadius={R.lg} />
        <View style={{ flex: 1, marginRight: 14, alignItems: "flex-end" }}>
          <Shimmer style={{ width: "80%" as any, height: 26, marginBottom: 10 }} />
          <Shimmer style={{ width: "50%" as any, height: 14, marginBottom: 10 }} />
          <Shimmer style={{ width: 88, height: 22 }} borderRadius={100} />
        </View>
      </View>
      <View style={{ paddingHorizontal: PAD, marginTop: 24 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <Shimmer key={i} style={{ width: "100%" as any, height: 68, marginBottom: 8 }} borderRadius={R.lg} />
        ))}
      </View>
    </View>
  );
}

/* ── Styles ───────────────────────────────────── */

const ss = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  // Banner
  banner: { width: SW, height: BANNER_H, backgroundColor: C.surface, overflow: "hidden" },
  meshBg: { ...StyleSheet.absoluteFillObject },

  // Hero — poster overlaps the banner base, title/meta beside it (RTL).
  hero: { marginTop: -88, paddingHorizontal: PAD },
  heroRow: { flexDirection: "row-reverse", alignItems: "flex-end" },
  heroPoster: {
    width: 112, aspectRatio: 2 / 3, borderRadius: R.lg,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.borderLight,
    ...ELEVATION_CARD,
  },
  heroPosterPressable: { position: "relative", borderRadius: R.lg },
  posterExpandBadge: {
    position: "absolute", right: 7, bottom: 7,
    width: 26, height: 26, borderRadius: R.circle,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.72)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.24)",
  },
  heroPosterFallback: { alignItems: "center", justifyContent: "center" },

  // Full-screen poster viewer
  posterViewer: { flex: 1, backgroundColor: C.player, alignItems: "center", justifyContent: "center" },
  posterViewerLoader: { position: "absolute" },
  posterViewerImage: { width: "100%", height: "100%" },
  posterViewerTopGradient: { position: "absolute", top: 0, left: 0, right: 0, height: 130 },
  posterViewerBack: {
    position: "absolute", left: 16, zIndex: 2,
    minHeight: 42, flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 13, borderRadius: R.pill,
    backgroundColor: "rgba(0,0,0,0.62)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.2)",
  },
  posterViewerBackText: { color: C.white, fontSize: 13, fontWeight: "700", fontFamily: "Cairo_700Bold" },
  posterViewerTitle: {
    position: "absolute", left: 24, right: 24,
    color: C.white, fontSize: 17, fontWeight: "700", textAlign: "center",
    fontFamily: "Cairo_700Bold", textShadowColor: "rgba(0,0,0,0.9)", textShadowRadius: 8,
  },
  // marginRight (physical) spaces the text from the poster in the row-reverse
  // layout without using `gap` (RN 0.81 gap + row-reverse Yoga bug).
  heroText: { flex: 1, marginRight: 14, alignItems: "flex-end", paddingBottom: 4 },
  title: {
    ...TAr.h1, fontSize: 28, lineHeight: 33,
    color: C.bone, textAlign: "right", writingDirection: "rtl",
  },
  copiedPill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    alignSelf: "flex-end", marginTop: 8,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: R.pill,
    backgroundColor: C.accent + "1F",
  },
  copiedText: { color: C.accent, fontSize: 11, fontWeight: "700", fontFamily: "Cairo_600SemiBold" },
  quickMeta: {
    flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end",
    gap: 6, marginTop: 14,
  },
  ratingPill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: C.goldSoft, borderRadius: R.pill,
    paddingHorizontal: 12, paddingVertical: 5,
  },
  ratingText: { color: C.gold, fontSize: 11, fontWeight: "600", fontFamily: "Cairo_600SemiBold" },

  // Error-state primary button (also the "go back" action).
  btnPrimary: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: C.accent, borderRadius: R.pill, paddingVertical: 15,
    ...ELEVATION_GLOW,
  },
  btnPrimaryText: { color: C.textOnAccent, fontSize: 14, fontWeight: "600", fontFamily: "Cairo_600SemiBold" },

  // Floating action bar — frosted, pinned to the bottom over the scroll.
  actionBar: {
    position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 40,
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: PAD, paddingTop: 12, overflow: "hidden",
    borderTopWidth: 1, borderColor: C.glassBorder,
    ...ELEVATION_NAV,
  },
  actionPlayWrap: { flex: 1, borderRadius: R.pill, ...ELEVATION_GLOW },
  actionPlayGrad: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 14, borderRadius: R.pill, overflow: "hidden",
  },
  actionIcon: {
    width: 52, height: 50, alignItems: "center", justifyContent: "center",
    borderRadius: R.pill, backgroundColor: C.surfaceGlass,
    borderWidth: 1, borderColor: C.glassBorder,
  },

  // Synopsis
  synopsis: { color: C.textSoft, fontSize: 14, lineHeight: 23, marginTop: 20, fontFamily: "Cairo_500Medium" },
  readMore: { color: C.accent, fontSize: 11, fontWeight: "600", marginTop: 6, fontFamily: "Cairo_600SemiBold" },

  // Chips
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 16 },
  chip: {
    paddingHorizontal: 11, paddingVertical: 5, borderRadius: R.sm, overflow: "hidden",
    borderWidth: 1, borderColor: C.borderLight,
  },
  chipText: { color: C.textSecondary, fontSize: 10.5, fontWeight: "600", letterSpacing: 0.3, fontFamily: "Cairo_600SemiBold" },

  // Section divider — a faint brand-violet hairline, no glow.
  glowLine: {
    height: 1, marginTop: 20, marginHorizontal: PAD,
    backgroundColor: C.violetSoft,
  },

  // Tabs
  // Editorial underline tabs — an ember stroke marks the active tab, no filled pill.
  tabBar: {
    flexDirection: "row", marginTop: 18, marginHorizontal: PAD, gap: 0,
    borderBottomWidth: 1, borderBottomColor: C.line,
  },
  tabItem: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 13, borderBottomWidth: 2, borderBottomColor: "transparent", marginBottom: -1,
  },
  tabItemActive: { borderBottomColor: C.ember },
  tabText: { color: C.textMuted, fontSize: 14, fontWeight: "600", fontFamily: "Cairo_600SemiBold" },
  tabTextActive: { color: C.bone, fontFamily: "Cairo_700Bold" },
  tabCount: {
    backgroundColor: C.glass, borderRadius: R.pill,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  tabCountActive: { backgroundColor: C.accentSoft },
  tabCountText: { color: C.textMuted, fontSize: 10, fontWeight: "500" },
  tabCountTextActive: { color: C.ember },

  // Tab content — extra bottom pad clears the floating action bar.
  tabContent: { paddingHorizontal: PAD, paddingTop: 16, paddingBottom: 132 },

  // Episodes — toolbar
  epToolbar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 10, paddingHorizontal: 4, marginBottom: 8,
  },
  epToolbarLeft: { flexDirection: "row", gap: 8 },
  sortChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: R.pill,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
  },
  sortChipActive: { backgroundColor: C.accent, borderColor: "transparent" },
  sortChipText: { color: C.textSecondary, fontSize: 12, fontWeight: "600", fontFamily: "Cairo_600SemiBold" },
  sortChipTextActive: { color: C.textOnAccent },
  epCount: { color: C.textMuted, fontSize: 12, fontFamily: "Cairo_500Medium" },

  sourceBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingVertical: 6, paddingHorizontal: 10, marginBottom: 10,
    backgroundColor: C.accent + "1F", borderRadius: R.pill,
    alignSelf: "flex-start",
  },
  sourceBadgeText: { color: C.accent, fontSize: 11, fontWeight: "700", fontFamily: "Cairo_600SemiBold" },

  episodeJumpRow: {
    flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6,
  },
  episodeJumpInput: {
    flex: 1, minHeight: 42, borderRadius: R.lg, paddingHorizontal: 14,
    color: C.text, backgroundColor: C.surfaceLight,
    borderWidth: 1, borderColor: C.border,
    fontFamily: "Outfit_600SemiBold", fontSize: 14, textAlign: "left",
  },
  episodeJumpInputError: { borderColor: C.error },
  episodeJumpButton: {
    minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingHorizontal: 14, borderRadius: R.lg, backgroundColor: C.accent,
  },
  episodeJumpButtonText: {
    color: C.textOnAccent, fontSize: 12, fontWeight: "700", fontFamily: "Cairo_700Bold",
  },
  episodeJumpError: {
    color: C.error, fontSize: 11, marginBottom: 8, textAlign: "right", fontFamily: "Cairo_500Medium",
  },

  // Episodes — grid (2 columns)
  epGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  epCard: { width: EP_CARD_WIDTH, borderRadius: R.lg },
  epCardHighlighted: {
    backgroundColor: C.accentSoft, shadowColor: C.accent,
    shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.45, shadowRadius: 10, elevation: 6,
  },
  epCardThumb: {
    width: "100%", aspectRatio: 16 / 9, borderRadius: R.lg, overflow: "hidden",
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    position: "relative",
  },
  epCardGradient: { ...StyleSheet.absoluteFillObject },
  epCardPlayBtn: {
    position: "absolute", left: "50%", top: "50%",
    width: 36, height: 36, borderRadius: 18, marginLeft: -18, marginTop: -18,
    backgroundColor: C.accent, alignItems: "center", justifyContent: "center",
  },
  epCardNumBadge: {
    position: "absolute", bottom: 6, left: 8,
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: R.pill,
    backgroundColor: "rgba(0,0,0,0.75)",
  },
  epCardNumText: { color: "#fff", fontSize: 11, fontWeight: "700", fontFamily: "Outfit_600SemiBold" },
  epCardSourceBadge: {
    position: "absolute", top: 6, right: 6,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: R.pill,
    backgroundColor: C.accent,
  },
  epCardSourceText: { color: "#000", fontSize: 9, fontWeight: "800", fontFamily: "Outfit_700Bold" },
  epDownloadBtn: {
    position: "absolute", top: 6, left: 6,
    minWidth: 26, height: 26, paddingHorizontal: 5, borderRadius: R.pill,
    backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.18)",
  },
  epDownloadPct: { color: "#fff", fontSize: 9, fontWeight: "800", fontFamily: "Outfit_700Bold" },
  hint: {
    color: C.textMuted, fontSize: 11, marginBottom: 10,
    fontFamily: "Cairo_500Medium", textAlign: "right", writingDirection: "rtl",
  },
  epCardThumbWatched: { borderColor: C.accent },
  watchedDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  watchedBadge: {
    position: "absolute", top: 6, right: 6,
    flexDirection: "row", alignItems: "center", gap: 3,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: R.pill,
    backgroundColor: C.accent,
  },
  watchedBadgeText: {
    color: "#fff", fontSize: 9, fontWeight: "800",
    fontFamily: "Cairo_700Bold",
  },
  latestBadge: {
    position: "absolute", bottom: 6, right: 8,
    flexDirection: "row", alignItems: "center", gap: 3,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: R.pill,
    backgroundColor: C.ember,
  },
  latestBadgeText: {
    color: "#fff", fontSize: 8, fontWeight: "800",
    fontFamily: "Cairo_700Bold",
  },
  epCardTitle: {
    color: C.textSecondary, fontSize: 11, fontWeight: "600",
    marginTop: 6, fontFamily: "Cairo_600SemiBold",
  },

  // Related — 2 columns, relaxed gap.
  relatedGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  relationBadge: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    paddingHorizontal: 6, paddingVertical: 3,
    backgroundColor: C.ember, alignItems: "center",
  },
  relationBadgeText: {
    color: C.textOnAccent, fontSize: 9, fontWeight: "800",
    fontFamily: "Cairo_700Bold", writingDirection: "rtl",
  },
  relatedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(10,10,11,0.72)",
    alignItems: "center", justifyContent: "center", gap: 6,
  },
  relatedOverlayText: { color: "#fff", fontSize: 10, fontWeight: "600", fontFamily: "Cairo_600SemiBold" },

  // Info
  infoRow: { flexDirection: "row-reverse", paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: C.borderSoft },
  infoLabel: { color: C.textMuted, fontSize: 13, fontWeight: "500", width: 110, fontFamily: "Cairo_500Medium", textAlign: "right" },
  infoValue: { color: C.textSecondary, fontSize: 13, flex: 1, fontFamily: "Cairo_500Medium", textAlign: "left", writingDirection: "rtl" },

  // Empty
  emptyTab: { alignItems: "center", paddingVertical: 48, gap: 12 },
  emptyTabText: { color: C.textMuted, fontSize: 14, fontFamily: "Cairo_500Medium" },

  // Top bar
  topBar: {
    position: "absolute", left: PAD, right: PAD,
    flexDirection: "row", justifyContent: "space-between",
  },
  glassCircle: {
    width: 40, height: 40, borderRadius: R.circle, overflow: "hidden",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: C.glassBorder,
  },

  // Error
  errorCircle: {
    width: 64, height: 64, borderRadius: R.circle,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    alignItems: "center", justifyContent: "center", marginBottom: 16,
  },
  errorMsg: { color: C.textMuted, fontSize: 16, marginBottom: 20, fontFamily: "Cairo_500Medium" },

  // List picker modal
  pickerBackdrop: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center", justifyContent: "center", padding: 24,
  },
  pickerSheet: {
    width: "100%", maxWidth: 380,
    backgroundColor: C.bg, borderRadius: R.xl, padding: 20,
    borderWidth: 1, borderColor: C.border, gap: 10,
  },
  pickerTitle: {
    color: C.text, fontSize: 18, fontWeight: "700",
    fontFamily: "Cairo_700Bold", textAlign: "center",
  },
  pickerSub: {
    color: C.textMuted, fontSize: 12, textAlign: "center",
    fontFamily: "Cairo_500Medium", marginBottom: 8,
  },
  pickerOption: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 12, borderRadius: R.lg,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
  },
  pickerIcon: {
    width: 40, height: 40, borderRadius: R.circle,
    alignItems: "center", justifyContent: "center",
  },
  pickerOptTitle: {
    color: C.text, fontSize: 14, fontWeight: "700",
    fontFamily: "Cairo_600SemiBold",
  },
  pickerOptSub: {
    color: C.textMuted, fontSize: 11, marginTop: 2,
    fontFamily: "Cairo_500Medium",
  },
  pickerCancel: { paddingVertical: 10, alignItems: "center", marginTop: 4 },
  pickerCancelText: {
    color: C.textMuted, fontSize: 13, fontWeight: "600",
    fontFamily: "Cairo_500Medium",
  },

  // Slide-up bottom sheet (add-to-list) — matches the home episode sheet.
  sheetBackdrop: { backgroundColor: "rgba(0,0,0,0.72)" },
  sheetAnchor: { flex: 1, justifyContent: "flex-end" },
  sheetPanel: {
    backgroundColor: C.playerSheet,
    borderTopLeftRadius: R.xxl, borderTopRightRadius: R.xxl,
    paddingHorizontal: 20, paddingTop: 12,
    borderTopWidth: 1, borderColor: C.border, gap: 10,
    ...ELEVATION_NAV,
  },
  sheetGrabber: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: C.controlDim,
    alignSelf: "center", marginBottom: 8,
  },
});

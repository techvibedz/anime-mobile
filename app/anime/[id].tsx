import { useEffect, useState, useCallback, useMemo, memo } from "react";
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
} from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, router, useFocusEffect } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { fetchEpisodes, fetchEpisodesUp4, fetchAnime3rbEpisodes, searchAnime } from "../../lib/api";
import type { AnimeDetail, Episode, SearchResult } from "../../lib/api";
import { addFavorite, removeFavorite, favoriteListOf } from "../../lib/favorites";
import type { FavoriteList } from "../../lib/favorites";
import { getCompletedEpisodeHrefs, isEpisodeCompleted, normHref, toggleWatched } from "../../lib/history";
import { recordAnimeCompletion } from "../../lib/completion";
import { fetchNextAiring } from "../../lib/airing";
import { startDownload, getDownloads, subscribeDownloads, type DownloadStatus } from "../../lib/downloads";
import { fetchAnimeInfo, fetchAnimeMal, fetchAnimeRelations } from "../../lib/animeInfo";
import type { AnimeInfoField, RelatedAnimeEntry } from "../../lib/animeInfo";
import { normLatin, seasonNum, formatCat } from "../../lib/relations";
import { MalBadge, MalCardBadge } from "../../components/MalRating";
import { AiringCountdown } from "../../components/AiringCountdown";
import { Shimmer } from "../../components/Shimmer";
import { GlassFill } from "../../components/GlassFill";
import { C, R, S, ELEVATION_CARD, ELEVATION_GLOW } from "../../lib/theme";
import { t } from "../../lib/i18n";

// Core React Native bundles a Clipboard native module (no extra dependency), so
// copying works over OTA on the existing build. Deep-import since the top-level
// `Clipboard` export was removed from react-native.
const Clipboard = require("react-native/Libraries/Components/Clipboard/Clipboard")
  .default as { setString(s: string): void };

const { width: SW } = Dimensions.get("window");
const BANNER_H = 360;
const PAD = S.paddingContent;

type TabKey = "episodes" | "related" | "info";

export default function AnimeDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
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
  // Normalized hrefs of every completed episode (across all anime). Each grid
  // card matches its own source hrefs against this, so the "watched" badge is
  // independent of which source URL was played or which animeHref was stored.
  const [completedHrefs, setCompletedHrefs] = useState<Set<string>>(new Set());
  const [malScore, setMalScore] = useState<number | null>(null);
  // Related anime (sequels, prequels, side stories, spin-offs) from AniList —
  // the source sites carry no related section, so these are resolved by title.
  const [relations, setRelations] = useState<RelatedAnimeEntry[]>([]);
  const [titleCopied, setTitleCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const bookmarked = bookmarkList !== null;
  const animeHref = id ? decodeURIComponent(id) : "";

  useEffect(() => {
    if (!id) return;
    const url = decodeURIComponent(id);
    let cancelled = false;
    favoriteListOf(url).then(setBookmarkList);
    (async () => {
      try {
        // Primary scrape — return as soon as witanime data is ready so the
        // UI renders episodes within a few seconds.
        const res = await fetchEpisodes(url);
        if (cancelled) return;
        if (res.success) {
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
        const enrich = await fetchEpisodesUp4(url, /* title */ null);
        if (cancelled) return;
        if (enrich.merged) setMerged(enrich.merged);
        if (enrich.episodes4up.length > 0) setEpisodes4up(enrich.episodes4up);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [id]);

  // Resolve the MyAnimeList score for the header badge once the title is known.
  // This also warms the shared cache the Info tab reads, so opening it is instant.
  useEffect(() => {
    if (!data?.title) return;
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
    fetchAnimeRelations(data.title, animeHref).then((r) => { if (!cancelled) setRelations(r); });
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
    getCompletedEpisodeHrefs().then(setCompletedHrefs);
  }, []));

  // Record this anime's completion state — the data behind the poster-card
  // badges (lib/completion) and the profile's "completed" stat. Recomputed
  // whenever the merged episode list or the watched-set changes, so watching the
  // last available episode flips the badge on, and a newly-aired episode flips it
  // back off. "finished" is gated on the series no longer airing, so a still-
  // running show's latest episode reads as "caught up" rather than "completed".
  useEffect(() => {
    if (!data || !animeHref) return;
    const all = [...data.episodes, ...episodes4up, ...episodes3rb];
    if (all.length === 0) return;
    let maxNum = 0;
    let hasNum = false;
    for (const e of all) {
      if (e.number != null && e.number > maxNum) { maxNum = e.number; hasNum = true; }
    }
    if (!hasNum) return;
    const lastHrefs = all.filter((e) => e.number === maxNum).map((e) => e.href);
    const caughtUp = isEpisodeCompleted(completedHrefs, lastHrefs);
    let cancelled = false;
    (async () => {
      // The series' finale is out when AniList reports no upcoming episode. A
      // network miss defaults to "finished" — anime watched to the last
      // available episode are overwhelmingly completed series.
      let airing = false;
      try { airing = !!(await fetchNextAiring(data.title)); } catch {}
      if (cancelled) return;
      // Record EVERY known source href + title so a card from any source rail
      // (e.g. the anime4up-sourced "this season" rail) resolves the badge — not
      // just the URL the anime happened to be opened under.
      await recordAnimeCompletion({
        hrefs: [animeHref, merged?.anime4up],
        titles: [data.title],
        lastEpNum: maxNum,
        caughtUp,
        finished: caughtUp && !airing,
      }).catch(() => {});
    })();
    return () => { cancelled = true; };
  }, [data, episodes4up, episodes3rb, completedHrefs, animeHref, merged]);

  const handleToggleWatched = useCallback(async (ep: GridEpisode) => {
    // Use whichever source href exists so source-only episodes (no witanime
    // href) can still be toggled — and store under that same href so the
    // marker matches on the next render.
    const primary = ep.href || ep.href4up || ep.href3rb;
    if (!data || !primary) return;
    const next = await toggleWatched(primary, {
      episodeTitle: ep.title || `${t.episode} ${ep.number}`,
      animeTitle: data.title,
      animeHref,
      image: data.poster,
    });
    setCompletedHrefs((prev) => {
      const copy = new Set(prev);
      const key = normHref(primary);
      if (next) copy.add(key); else copy.delete(key);
      return copy;
    });
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
        const enrich = await fetchEpisodesUp4(animeHref, null);
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
  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: "episodes", label: t.tabEpisodes, count: data.totalEpisodes },
    ...(relations.length > 0 ? [{ key: "related" as TabKey, label: t.tabRelated, count: relations.length }] : []),
    { key: "info", label: t.tabInfo },
  ];

  return (
    <View style={ss.root}>
      <ScrollView
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
        {/* ── Banner with mesh gradient ──────── */}
        <View style={ss.banner}>
          <View style={ss.meshBg}>
            <LinearGradient
              colors={[C.meshViolet, "transparent"]}
              start={{ x: 0.2, y: 0.5 }}
              end={{ x: 0.8, y: 0.5 }}
              style={[StyleSheet.absoluteFill, { opacity: 0.8 }]}
            />
            <LinearGradient
              colors={[C.meshPink, "transparent"]}
              start={{ x: 0.8, y: 0.2 }}
              end={{ x: 0.2, y: 0.8 }}
              style={[StyleSheet.absoluteFill, { opacity: 0.6 }]}
            />
          </View>
          {(data.banner || data.poster) ? (
            <Image
              source={{ uri: data.banner || data.poster }}
              style={{ width: SW, height: BANNER_H }}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={200}
            />
          ) : null}
          <LinearGradient
            colors={["rgba(0,0,0,0.2)", "transparent", "rgba(6,7,26,0.5)", C.bg]}
            locations={[0, 0.25, 0.6, 1]}
            style={StyleSheet.absoluteFill}
          />
        </View>

        {/* ── Info Section ──────────────────── */}
        <View style={ss.infoSection}>
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

          {/* Next-episode countdown — only shows for currently-airing anime */}
          <AiringCountdown title={data.title} />

          {/* Action buttons */}
          <View style={ss.actions}>
            <Pressable
              style={ss.btnPrimary}
              onPress={() => firstPlayable?.href && router.push(`/watch/${encodeURIComponent(firstPlayable.href)}`)}
            >
              <Ionicons name="play" size={16} color={C.textOnAccent} />
              <Text style={ss.btnPrimaryText}>{t.watchNow}</Text>
            </Pressable>
            <Pressable style={ss.btnGlass} onPress={toggleBookmark}>
              <Ionicons
                name={bookmarked ? "heart" : "heart-outline"}
                size={18}
                color={bookmarked ? C.accent : C.text}
              />
            </Pressable>
          </View>

          {/* Synopsis */}
          {data.synopsis ? (
            <Pressable onPress={() => setSynopsisOpen((v) => !v)}>
              <Text style={ss.synopsis} numberOfLines={synopsisOpen ? undefined : 3}>
                {data.synopsis}
              </Text>
              <Text style={ss.readMore}>{synopsisOpen ? t.showLess : t.readMore}</Text>
            </Pressable>
          ) : null}

          {/* All genre chips */}
          <View style={ss.chipRow}>
            {data.genres.map((g, i) => (
              <View key={i} style={ss.chip}>
                <Text style={ss.chipText}>{g}</Text>
              </View>
            ))}
          </View>
        </View>

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
        <View style={ss.tabContent}>
          {activeTab === "episodes" && (
            <EpisodesTab
              episodes={data.episodes}
              episodes4up={episodes4up}
              episodes3rb={episodes3rb}
              merged={merged}
              poster={data.poster}
              completedHrefs={completedHrefs}
              onToggleWatched={handleToggleWatched}
              animeHref={animeHref}
              animeTitle={data.title}
            />
          )}
          {activeTab === "related" && <RelatedTab items={relations} />}
          {activeTab === "info" && <InfoTab data={data} />}
        </View>
      </ScrollView>

      {/* ── Floating top buttons ─────────────── */}
      <View style={[ss.topBar, { top: insets.top + 8 }]}>
        <GlassCircleBtn icon="chevron-back" onPress={() => router.back()} />
        <View style={{ flexDirection: "row", gap: 8 }}>
          <GlassCircleBtn icon="share-outline" />
          <GlassCircleBtn
            icon={bookmarked ? "heart" : "heart-outline"}
            color={bookmarked ? C.accent : C.text}
            onPress={toggleBookmark}
          />
        </View>
      </View>

      {/* ── Add-to-list picker ───────────────── */}
      <Modal transparent animationType="fade" visible={pickerOpen} onRequestClose={() => setPickerOpen(false)}>
        <Pressable style={ss.pickerBackdrop} onPress={() => setPickerOpen(false)}>
          <Pressable style={ss.pickerSheet} onPress={() => {}}>
            <Text style={ss.pickerTitle}>{t.addToList}</Text>
            <Text style={ss.pickerSub}>{t.saveWhere(data.title)}</Text>

            <Pressable style={ss.pickerOption} onPress={() => saveToList("watching")}>
              <View style={[ss.pickerIcon, { backgroundColor: C.accent + "22" }]}>
                <Ionicons name="play-circle" size={22} color={C.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={ss.pickerOptTitle}>{t.currentlyWatching}</Text>
                <Text style={ss.pickerOptSub}>{t.watchingDesc}</Text>
              </View>
              <Ionicons name={I18nManager.isRTL ? "chevron-back" : "chevron-forward"} size={18} color={C.textMuted} />
            </Pressable>

            <Pressable style={ss.pickerOption} onPress={() => saveToList("planned")}>
              <View style={[ss.pickerIcon, { backgroundColor: C.accent + "22" }]}>
                <Ionicons name="bookmark" size={20} color={C.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={ss.pickerOptTitle}>{t.planToWatch}</Text>
                <Text style={ss.pickerOptSub}>{t.plannedDesc}</Text>
              </View>
              <Ionicons name={I18nManager.isRTL ? "chevron-back" : "chevron-forward"} size={18} color={C.textMuted} />
            </Pressable>

            <Pressable style={ss.pickerCancel} onPress={() => setPickerOpen(false)}>
              <Text style={ss.pickerCancelText}>{t.cancel}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
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

/* ── Tab: Episodes ──────────────────────────── */

function EpisodesTab({
  episodes,
  episodes4up,
  episodes3rb,
  merged,
  poster,
  completedHrefs,
  onToggleWatched,
  animeHref,
  animeTitle,
}: {
  episodes: AnimeDetail["episodes"];
  episodes4up: Episode[];
  episodes3rb: Episode[];
  merged: { anime4up: string } | null;
  poster: string;
  completedHrefs: Set<string>;
  onToggleWatched: (ep: GridEpisode) => void;
  animeHref: string;
  animeTitle: string;
}) {
  const [sortDesc, setSortDesc] = useState(true); // true = newest first
  // Live per-episode download state, keyed by the episode's primary href, so each
  // grid card can show idle / progress / done and trigger an offline save.
  const [downloads, setDownloads] = useState<Record<string, { status: DownloadStatus; progress: number }>>({});
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
    startDownload({
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
  // Initial 80 covers most users; "show more" appends another 80 each tap.
  const PAGE = 80;
  const [visibleCount, setVisibleCount] = useState(PAGE);

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

  // Reset window when sort flips so user always sees the FIRST page of the
  // new order (not a weird middle chunk).
  useEffect(() => { setVisibleCount(PAGE); }, [sortDesc, mergedEps.length]);

  const visible = sorted.slice(0, visibleCount);
  const hasMore = visibleCount < sorted.length;

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

      <Text style={ss.hint}>{t.tapToToggleWatched}</Text>

      {/* Episode grid: 2 columns for thumbnail cards */}
      <View style={ss.epGrid}>
        {visible.map((ep, i) => {
          const primary = ep.href || ep.href4up || ep.href3rb || "";
          return (
            <EpisodeGridCard
              key={`${ep.number}-${i}`}
              ep={ep}
              watched={isEpisodeCompleted(completedHrefs, [ep.href, ep.href4up, ep.href3rb])}
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
          onPress={() => setVisibleCount((n) => n + PAGE)}
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
            {`عرض المزيد (${sorted.length - visibleCount})`}
          </Text>
        </Pressable>
      )}
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
        router.push({
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
        });
      }}
      onLongPress={() => onToggleWatched(ep)}
      delayLongPress={300}
      style={({ pressed }) => [ss.epCard, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}
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
            <Text style={ss.epCardSourceText}>2X</Text>
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
  const gs = seasonNum(got);
  if (ws > 0 && gs > 0) s += ws === gs ? 10 : -25;
  else if (ws > 0 && gs === 0) s -= 14;
  return s;
}

// Best title-match score for a result against EVERY name the related entry is
// known by (AniList romaji + English). The source sites index an anime under
// only one language, so a romaji-only score misses results listed in English.
function bestRelatedMatch(entry: RelatedAnimeEntry, gotTitle: string): number {
  let s = scoreRelatedMatch(entry.title, gotTitle);
  if (entry.titleEnglish) s = Math.max(s, scoreRelatedMatch(entry.titleEnglish, gotTitle));
  return s;
}

// Minimum title-match confidence before a tapped related card is allowed to
// open a source page. Below this we report "not found" rather than risk opening
// a different anime. 60 clears strong containment / near-full token overlap but
// rejects a single-word coincidence and a season-mismatched base series.
const MIN_RELATED_TITLE_SCORE = 60;

function RelatedTab({ items }: { items: RelatedAnimeEntry[] }) {
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
    try {
      // Search the source sites by BOTH names AniList knows (romaji + English):
      // a site may index an anime under only one language, so a single-query
      // search returned no good candidate and we'd settle for a wrong one. Pool
      // and de-dupe (by href) the results of every query.
      const queries = [entry.title, entry.titleEnglish]
        .filter((q): q is string => !!q && q.trim().length > 0)
        .filter((q, i, a) => a.findIndex((x) => x.toLowerCase() === q.toLowerCase()) === i);
      const seen = new Set<string>();
      const pooled: SearchResult[] = [];
      for (const q of queries) {
        const res = await searchAnime(q);
        for (const r of res.data.results) {
          if (r?.href && !seen.has(r.href)) { seen.add(r.href); pooled.push(r); }
        }
      }
      // Pick the BEST match, not just the first result. The source sites' search
      // is fuzzy, so results[0] for a query was sometimes a different anime
      // entirely — opening the "wrong" page. Score each result against the
      // related title (season-aware, either language) AND its format: an OVA /
      // movie / special shares the base title with the main TV series, so without
      // a format check a 1-episode OVA card would resolve to the 12-episode
      // series. We bias hard toward the result whose format matches the card's.
      // A result must clear MIN_RELATED_TITLE_SCORE on TITLE alone to be eligible
      // — otherwise we'd rather report "not found" than open a different anime.
      const wantFmt = formatCat(entry.format);
      let hit: SearchResult | undefined;
      let best = -Infinity;
      for (const r of pooled) {
        const titleScore = bestRelatedMatch(entry, r.title);
        if (titleScore < MIN_RELATED_TITLE_SCORE) continue; // too weak — skip
        let sc = titleScore;
        if (wantFmt) {
          const gotFmt = formatCat(r.type) || formatCat(r.title);
          if (gotFmt) sc += gotFmt === wantFmt ? 45 : -45;
          else if (wantFmt !== "tv") sc -= 15; // unmarked result is usually the series
        }
        if (sc > best) { best = sc; hit = r; }
      }
      if (hit?.href) {
        router.push(`/anime/${encodeURIComponent(hit.href)}`);
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
        return (
          <Pressable
            key={item.anilistId}
            onPress={() => openRelated(item)}
            style={({ pressed }) => [ss.relatedCard, { opacity: pressed ? 0.85 : 1 }]}
          >
            <View style={ss.relatedImageWrap}>
              {item.image ? (
                <Image source={{ uri: item.image }} style={ss.relatedImage} contentFit="cover" cachePolicy="memory-disk" recyclingKey={String(item.anilistId)} transition={200} />
              ) : (
                <View style={[ss.relatedImage, { alignItems: "center", justifyContent: "center" }]}>
                  <Ionicons name="image-outline" size={24} color={C.textMuted} />
                </View>
              )}
              <MalCardBadge title={item.title} />
              {/* Relation type ribbon — "تكملة" (sequel), "قصة جانبية" (side story), … */}
              <View style={ss.relationBadge}>
                <Text style={ss.relationBadgeText} numberOfLines={1}>{item.relation}</Text>
              </View>
              {(resolving || notFound) && (
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
              )}
            </View>
            <Text style={ss.relatedTitle} numberOfLines={2}>{item.title}</Text>
            {item.format && <Text style={ss.relatedType}>{item.format}</Text>}
          </Pressable>
        );
      })}
    </View>
  );
}

/* ── Tab: Info ───────────────────────────────── */

function InfoTab({ data }: { data: AnimeDetail }) {
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
  const scraped = Object.entries(data.metadata).map(([label, value]) => ({ label, value }));
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
      <View style={{ paddingHorizontal: PAD, marginTop: -48 }}>
        <Shimmer style={{ width: SW * 0.6, height: 28, marginBottom: 12 }} />
        <Shimmer style={{ width: SW * 0.4, height: 14, marginBottom: 20 }} />
        <View style={{ flexDirection: "row", gap: 10, marginBottom: 24 }}>
          <Shimmer style={{ width: 140, height: 48 }} borderRadius={100} />
          <Shimmer style={{ width: 48, height: 48 }} borderRadius={100} />
        </View>
        {Array.from({ length: 6 }).map((_, i) => (
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

  // Info
  infoSection: { marginTop: -48, paddingHorizontal: PAD },
  title: {
    color: C.text, fontSize: 24, fontWeight: "800", lineHeight: 30, letterSpacing: -0.4,
    textAlign: "center", fontFamily: "Cairo_700Bold",
  },
  copiedPill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    alignSelf: "center", marginTop: 8,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: R.pill,
    backgroundColor: C.accent + "1F",
  },
  copiedText: { color: C.accent, fontSize: 11, fontWeight: "700", fontFamily: "Cairo_600SemiBold" },
  quickMeta: {
    flexDirection: "row", flexWrap: "wrap", justifyContent: "center",
    gap: 6, marginTop: 14,
  },
  ratingPill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: C.goldSoft, borderRadius: R.pill,
    paddingHorizontal: 12, paddingVertical: 5,
  },
  ratingText: { color: C.gold, fontSize: 11, fontWeight: "600", fontFamily: "Cairo_600SemiBold" },

  // Actions
  actions: { flexDirection: "row", gap: 10, marginTop: 20 },
  btnPrimary: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: C.accent, borderRadius: R.pill, paddingVertical: 15,
    ...ELEVATION_GLOW,
  },
  btnPrimaryText: { color: C.textOnAccent, fontSize: 14, fontWeight: "600", fontFamily: "Cairo_600SemiBold" },
  btnGlass: {
    width: 52, alignItems: "center", justifyContent: "center",
    borderRadius: R.pill, backgroundColor: C.surfaceGlass,
    borderWidth: 1, borderColor: C.glassBorder,
  },

  // Synopsis
  synopsis: { color: C.textSecondary, fontSize: 14, lineHeight: 22, marginTop: 20, fontFamily: "Cairo_500Medium" },
  readMore: { color: C.accent, fontSize: 11, fontWeight: "600", marginTop: 6, fontFamily: "Cairo_600SemiBold" },

  // Chips
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 16 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: R.pill,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
  },
  chipText: { color: C.textSecondary, fontSize: 11, fontWeight: "600", fontFamily: "Cairo_600SemiBold" },

  // Glow line
  glowLine: {
    height: 1, marginTop: 20, marginHorizontal: PAD,
    backgroundColor: C.violetGlow,
    shadowColor: C.violet, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.3, shadowRadius: 8,
  },

  // Tabs
  tabBar: {
    flexDirection: "row", marginTop: 16, marginHorizontal: PAD, gap: 4,
  },
  tabItem: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 12, borderRadius: R.default,
  },
  tabItemActive: { backgroundColor: C.accentSoft },
  tabText: { color: C.textMuted, fontSize: 14, fontWeight: "600", fontFamily: "Cairo_600SemiBold" },
  tabTextActive: { color: C.accent },
  tabCount: {
    backgroundColor: C.glass, borderRadius: R.pill,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  tabCountActive: { backgroundColor: "rgba(255,45,85,0.1)" },
  tabCountText: { color: C.textMuted, fontSize: 10, fontWeight: "500" },
  tabCountTextActive: { color: C.accent },

  // Tab content
  tabContent: { paddingHorizontal: PAD, paddingTop: 16, paddingBottom: 100 },

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

  // Episodes — grid (2 columns)
  epGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  epCard: { width: (SW - PAD * 2 - 10) / 2 },
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
    backgroundColor: C.violet,
  },
  latestBadgeText: {
    color: "#fff", fontSize: 8, fontWeight: "800",
    fontFamily: "Cairo_700Bold",
  },
  epCardTitle: {
    color: C.textSecondary, fontSize: 11, fontWeight: "600",
    marginTop: 6, fontFamily: "Cairo_600SemiBold",
  },

  // Related
  relatedGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  relatedCard: { width: (SW - PAD * 2 - 24) / 3 },
  relatedImageWrap: {
    width: "100%", aspectRatio: 2 / 3, borderRadius: R.lg, overflow: "hidden",
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    position: "relative",
  },
  relatedImage: { width: "100%", height: "100%" },
  relationBadge: {
    position: "absolute", bottom: 6, left: 6, right: 6,
    paddingHorizontal: 6, paddingVertical: 3, borderRadius: R.sm,
    backgroundColor: C.accent, alignItems: "center",
  },
  relationBadgeText: {
    color: C.textOnAccent, fontSize: 9, fontWeight: "800",
    fontFamily: "Cairo_700Bold", writingDirection: "rtl",
  },
  relatedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(6,7,26,0.72)",
    alignItems: "center", justifyContent: "center", gap: 6,
  },
  relatedOverlayText: { color: "#fff", fontSize: 10, fontWeight: "600", fontFamily: "Cairo_600SemiBold" },
  relatedTitle: { color: C.text, fontSize: 11, fontWeight: "600", marginTop: 6, fontFamily: "Cairo_600SemiBold" },
  relatedType: { color: C.textMuted, fontSize: 10, marginTop: 2, fontFamily: "Cairo_500Medium" },

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
});

import { useEffect, useState, useCallback, useRef, useMemo, memo, startTransition } from "react";
import {
  View,
  Text,
  ScrollView,
  FlatList,
  Pressable,
  useWindowDimensions,
  RefreshControl,
  StyleSheet,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  AppState,
  Animated,
  Easing,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { fetchHome } from "../../lib/api";
import type { FeaturedItem, HomeSection, AnimeItem, EpisodeItem } from "../../lib/api";
import { episodeNumberFromUrl } from "../../lib/videoProviders";
import { isEpisodeUrl, toAnimeUrl } from "../../lib/favorites";
import { getContinueWatching, getHistoryByAnime, progressPercent, dismissFromContinue, animeTitleKey, normAnimeKey } from "../../lib/history";
import type { WatchEntry, AnimeHistoryGroup } from "../../lib/history";
import { getFavorites } from "../../lib/favorites";
import { canonTitle } from "../../lib/relations";
import { fetchAnimeRecommendations } from "../../lib/animeInfo";
import type { RecItem } from "../../lib/animeInfo";
import { pickTasteSeeds, rankRecommendations, type RankedRec } from "../../lib/recommend";
import { AniListPosterCard } from "../../components/AniListPosterCard";
import { syncEpisodeNotifications, reportRecentEpisodes, getUnreadCount } from "../../lib/notifications";
import { useSidebarActions } from "../../components/Sidebar";
import { PantoufaWordmark } from "../../components/PantoufaWordmark";
import { Shimmer } from "../../components/Shimmer";
import { AdBanner } from "../../components/AdBanner";
import { MalCardBadge } from "../../components/MalRating";
import { reconcileCompletionFromEpisodes } from "../../lib/completion";
import { CompletionBadge } from "../../components/CompletionBadge";
import { PosterCard } from "../../components/PosterCard";
import { StateView } from "../../components/StateView";
import { C, S, R, T, TAr, ELEVATION_CARD, ELEVATION_GLOW, ELEVATION_NAV, ABSOLUTE_FILL } from "../../lib/theme";
import { t } from "../../lib/i18n";
import { checkOnline } from "../../lib/net";
import { remoteLog, errText } from "../../lib/remoteLog";
import { useReducedMotion } from "../../lib/motion";
import { posterUrl } from "../../lib/img";
import { Rise } from "../../components/Rise";
import { RtlRow } from "../../components/RtlRow";
import { AnimeOfTheDay } from "../../components/AnimeOfTheDay";

const HERO_H = 520;
const CARD_W = 140;
const CARD_H = 200;
const EP_W = 232;
const EP_H = 130;
// Space reserved to the right of a ranked poster for its numeral (1 / 2 digits).
const RANK_W1 = 46;
const RANK_W2 = 92;
const PAD = S.paddingContent;

const SECTION_LABELS: Record<string, string> = {
  recently_updated: "حلقات جديدة",
  latest_movies: "أحدث الأفلام",
  top_animes: "أكثر الأنميات مشاهدة",
  top_movies: "أكثر الأفلام مشاهدة",
};

// The home feed shows ONLY witanime's own rails, in payload order: latest
// episodes, then latest movies / most-watched animes / most-watched movies.
// Filtering to the known ids keeps a stale cached payload from resurrecting
// the removed "trending"/"movies" sections.
const HOME_SECTION_IDS = ["recently_updated", "latest_movies", "top_animes", "top_movies"];

/* ── Hero Carousel (isolated) ──────────────────────────────────
   Owns its OWN paging index + 5s auto-advance timer, so a hero tick or swipe
   re-renders only the carousel — not the entire home feed. Full-bleed: the art
   runs under the status bar and the floating top bar. */
const HeroCarousel = memo(function HeroCarousel({ featured, topInset }: { featured: FeaturedItem[]; topInset: number }) {
  const { width: SW } = useWindowDimensions();
  const heroRef = useRef<ScrollView>(null);
  const [heroIndex, setHeroIndex] = useState(0);
  const heroTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Reduce Motion: no auto-advance and no slow zoom; every slide stays reachable.
  const reduced = useReducedMotion();
  const heroH = HERO_H + topInset;

  const startAuto = useCallback(() => {
    if (heroTimer.current) clearInterval(heroTimer.current);
    if (featured.length <= 1) return;
    if (reduced) return;
    // Paused while backgrounded; restarts on foreground (below).
    if (AppState.currentState !== "active") return;
    heroTimer.current = setInterval(() => {
      setHeroIndex((prev) => {
        const next = (prev + 1) % featured.length;
        heroRef.current?.scrollTo({ x: next * SW, animated: true });
        return next;
      });
    }, 6000);
  }, [featured.length, reduced, SW]);

  useEffect(() => {
    startAuto();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") startAuto();
      else if (heroTimer.current) { clearInterval(heroTimer.current); heroTimer.current = null; }
    });
    return () => {
      if (heroTimer.current) clearInterval(heroTimer.current);
      sub.remove();
    };
  }, [startAuto]);

  const onHeroScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / SW);
    setHeroIndex((cur) => (idx !== cur ? idx : cur));
  };

  return (
    <View>
      <ScrollView
        ref={heroRef}
        horizontal
        pagingEnabled
        onLayout={() => heroRef.current?.scrollTo({ x: heroIndex * SW, animated: false })}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => { onHeroScroll(e); startAuto(); }}
        scrollEventThrottle={16}
      >
        {featured.map((item, i) => (
          <HeroSlide key={item.href || i} item={item} width={SW} height={heroH} active={i === heroIndex} reduced={reduced} />
        ))}
      </ScrollView>
      {featured.length > 1 && (
        <View style={ss.heroTrack} pointerEvents="none">
          {featured.map((_, si) => (
            <View key={si} style={[ss.seg, si === heroIndex && ss.segActive]} />
          ))}
        </View>
      )}
    </View>
  );
});

function openHeroItem(item: FeaturedItem, details: boolean) {
  if (!item.href) return;
  if (isEpisodeUrl(item.href)) {
    const animeUrl = toAnimeUrl(item.href);
    if (details) {
      if (animeUrl) router.push(`/anime/${encodeURIComponent(animeUrl)}`);
      return;
    }
    const epNum = episodeNumberFromUrl(item.href);
    // Defer a frame so the press feedback paints before the heavy watch mount.
    requestAnimationFrame(() => router.push({
      pathname: `/watch/${encodeURIComponent(item.href)}`,
      params: {
        ...(animeUrl ? { anime: animeUrl } : {}),
        animeTitle: item.title,
        ...(epNum != null ? { epNum: String(epNum) } : {}),
      },
    }));
  } else {
    // Anime-page slides: Details opens the page; Watch now opens it and starts
    // the first episode (the page resolves the episode list).
    router.push(details
      ? `/anime/${encodeURIComponent(item.href)}`
      : { pathname: `/anime/${encodeURIComponent(item.href)}`, params: { play: "1" } });
  }
}

const HeroSlide = memo(function HeroSlide({ item, width, height, active, reduced }: {
  item: FeaturedItem; width: number; height: number; active: boolean; reduced: boolean;
}) {
  // Slow "Ken Burns" push-in on the visible slide only; native driver, one value.
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    scale.setValue(1);
    if (!active || reduced) return;
    const anim = Animated.timing(scale, { toValue: 1.08, duration: 7000, easing: Easing.out(Easing.quad), useNativeDriver: true, isInteraction: false });
    anim.start();
    return () => anim.stop();
  }, [active, reduced, scale]);
  // Episode-only slides have no separate details page target besides the anime.
  const canDetail = !isEpisodeUrl(item.href) || !!toAnimeUrl(item.href);
  return (
    <View style={[ss.heroSlide, { width, height }]}>
      {item.image ? (
        <Animated.View style={[ABSOLUTE_FILL, { transform: [{ scale }] }]}>
          <Image source={{ uri: posterUrl(item.image, width * 1.5, 1200) }} style={ABSOLUTE_FILL} contentFit="cover" cachePolicy="memory-disk" recyclingKey={item.href} transition={250} />
        </Animated.View>
      ) : null}
      {/* Top scrim keeps the status bar + floating top bar legible over bright art. */}
      <LinearGradient colors={["rgba(8,9,12,0.78)", "rgba(8,9,12,0)"]} style={ss.heroTopScrim} />
      {/* Bottom scrim — title, synopsis and CTAs always sit on a dark plate (AA). */}
      <LinearGradient
        colors={["rgba(8,9,12,0)", "rgba(8,9,12,0.6)", "rgba(8,9,12,0.94)", C.bg]}
        locations={[0, 0.38, 0.74, 1]}
        style={[ss.heroBottomScrim, { height: height * 0.72 }]}
      />
      <View style={ss.heroContent}>
        {item.genres.length > 0 && (
          <Text style={ss.heroGenres} numberOfLines={1}>{item.genres.slice(0, 3).join("  ·  ")}</Text>
        )}
        <Text style={ss.heroTitle} numberOfLines={2}>{item.title}</Text>
        {item.description ? <Text style={ss.heroDesc} numberOfLines={2}>{item.description}</Text> : null}
        <View style={ss.heroButtons}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t.watchNow}
            onPress={() => openHeroItem(item, false)}
            style={({ pressed }) => [ss.heroPrimary, pressed && ss.pressedSoft]}
          >
            <Ionicons name="play" size={18} color={C.textOnAccent} />
            <Text style={ss.heroPrimaryText}>{t.watchNow}</Text>
          </Pressable>
          {canDetail ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.openAnimePage}
              onPress={() => openHeroItem(item, true)}
              style={({ pressed }) => [ss.heroSecondary, pressed && ss.pressedSoft]}
            >
              <Ionicons name="information-circle-outline" size={19} color={C.text} />
              <Text style={ss.heroSecondaryText}>{t.heroDetails}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
});

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { openSidebar } = useSidebarActions();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [featured, setFeatured] = useState<FeaturedItem[]>([]);
  const [sections, setSections] = useState<HomeSection[]>([]);
  const [history, setHistory] = useState<WatchEntry[]>([]);
  const [unread, setUnread] = useState(0);
  // True once a connectivity probe confirms the device is offline AND we have no
  // content to show — drives the offline home state (funnels to Downloads).
  const [offline, setOffline] = useState(false);

  // Cold-start resilience: the first scrape can come back empty while the
  // WebView is still warming up / clearing Cloudflare. Instead of dropping the
  // user on a blank home, keep the skeleton up and retry a few times.
  //
  // BOUND THE SKELETON BY TIME, NOT COUNT. MAX_EMPTY_RETRIES used to multiply
  // each retry by the full ~60s per-scrape timeout, so a region-blocked source
  // kept the loader up for ~5 minutes before the empty state appeared — and
  // nobody waits 5 minutes ("stuck forever"). The cold-WebView rescue that the
  // retries were designed for lands in 5-15s; a 25s deadline covers it while
  // bounding every other path to a Retry button the user can actually see.
  const emptyRetry = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasContent = useRef(false);
  const coldStartDeadline = useRef(0);
  const lastLoadAt = useRef(0);
  const MAX_EMPTY_RETRIES = 5;
  const COLD_START_DEADLINE_MS = 25000;

  // Popup shown when tapping an episode card — choose Watch vs Anime page
  const [episodePopup, setEpisodePopup] = useState<EpisodeItem | null>(null);
  const openEpisodePopup = useCallback((ep: EpisodeItem) => setEpisodePopup(ep), []);
  const closeEpisodePopup = useCallback(() => setEpisodePopup(null), []);

  // Stable handler so the memoized ContinueCard doesn't re-render every time
  // the home screen state changes (focus refresh, popup open/close, badge).
  const handleRemoveContinue = useCallback((href: string) => {
    // Hide it immediately (optimistic) — the storage write must
    // not be able to leave a card the user just closed.
    setHistory((prev) => prev.filter((h) => h.episodeHref !== href));
    dismissFromContinue(href)
      .then(() => getContinueWatching().then(setHistory))
      .catch(() => {});
  }, []);

  const load = useCallback(async (forceRefresh = false) => {
    lastLoadAt.current = Date.now();
    // Start (or reuse) an absolute cold-start deadline so the skeleton can't
    // exceed ~25s TOTAL across retries regardless of per-scrape latency.
    if (coldStartDeadline.current === 0) coldStartDeadline.current = Date.now() + COLD_START_DEADLINE_MS;
    const withinDeadline = () => Date.now() < coldStartDeadline.current;
    try {
      // fetchHome's onUpdated fires when the background revalidation lands with
      // visibly newer content (new episode aired etc.) — the feed updates live,
      // no pull-to-refresh needed.
      const [res, hist] = await Promise.all([
        fetchHome((fresh) => {
          if (!fresh?.success) return;
          const feat = fresh.data.featured ?? [];
          const secs = fresh.data.sections ?? [];
          if (feat.length > 0 || secs.length > 0) {
            hasContent.current = true;
            // Transition: the full feed mount (~40 cards) is time-sliced so it
            // can't freeze the first taps; the skeleton stays up meanwhile.
            startTransition(() => {
              setFeatured(feat);
              setSections(secs);
              setLoading(false);
            });
          }
        }, { forceRefresh }),
        getContinueWatching(),
      ]);
      setHistory(hist);
      const feat = res?.success ? (res.data.featured ?? []) : [];
      const secs = res?.success ? (res.data.sections ?? []) : [];
      const gotContent = feat.length > 0 || secs.length > 0;
      if (gotContent) {
        startTransition(() => {
          setFeatured(feat);
          setSections(secs);
        });
        hasContent.current = true;
        emptyRetry.current = 0;
        setOffline(false);
      } else if (!hasContent.current) {
        // Empty scrape with nothing on screen yet. Distinguish a genuine offline
        // device from a cold WebView / un-cleared Cloudflare challenge: probe
        // reachability. Offline → stop retrying and show the offline state
        // immediately (funnels to Downloads) instead of spinning for ~15s.
        if (!(await checkOnline())) {
          setOffline(true);
          setLoading(false);
          setRefreshing(false);
          return;
        }
        if (emptyRetry.current < MAX_EMPTY_RETRIES && withinDeadline()) {
          emptyRetry.current += 1;
          retryTimer.current = setTimeout(() => { void load(); }, 3000);
          return; // don't drop out of the loading state
        }
      }
    } catch (e) {
      console.error("Home load failed:", e);
      void remoteLog("error", "home", "home load threw", { error: errText(e), retry: emptyRetry.current });
      if (!hasContent.current) {
        if (!(await checkOnline())) {
          setOffline(true);
          setLoading(false);
          setRefreshing(false);
          return;
        }
        if (emptyRetry.current < MAX_EMPTY_RETRIES && withinDeadline()) {
          emptyRetry.current += 1;
          retryTimer.current = setTimeout(() => { void load(); }, 3000);
          return;
        }
      }
    }
    // Reached here with no content → the user sees the empty/offline state.
    // Log only once per cold start so a stuck retry loop doesn't flood.
    if (!hasContent.current) {
      void remoteLog("warn", "home", "home empty after retries", {
        retries: emptyRetry.current,
        online: await checkOnline().catch(() => null),
      });
    }
    // Same transition lane as the feed setters above: an urgent loading=false
    // would render once with the not-yet-committed (empty) feed.
    startTransition(() => setLoading(false));
    setRefreshing(false);
  }, []);

  // Manual refresh / retry: clear the cold-start counters so a user-initiated
  // reload gets a fresh batch of attempts.
  const reload = useCallback(() => {
    emptyRetry.current = 0;
    coldStartDeadline.current = 0; // fresh deadline for a user-initiated retry
    if (retryTimer.current) clearTimeout(retryTimer.current);
    void load(true);
  }, [load]);

  useEffect(() => {
    load();
    return () => { if (retryTimer.current) clearTimeout(retryTimer.current); };
  }, [load]);

  // Detect new episodes → in-app notification center + report newly-available
  // episodes to the server for closed-app push (with image). Both run in the
  // background so they never block the home feed.
  useFocusEffect(useCallback(() => {
    if (loading) return;
    if (Date.now() - lastLoadAt.current > 60_000) void load();
    const run = () => {
      // Carries reconcileCompletionFromEpisodes — re-running on foreground (not
      // just mount) is what clears a stale "caught up" badge after a new episode
      // drops while the app stayed alive. Throttled inside syncEpisodeNotifications.
      syncEpisodeNotifications()
        .then(() => getUnreadCount())
        .then(setUnread)
        .catch(() => {});
      reportRecentEpisodes().catch(() => {});
    };
    const timer = setTimeout(run, 15_000);
    const poll = setInterval(() => { if (AppState.currentState === "active") { void load(true); run(); } }, 5 * 60_000);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") { void load(true); run(); }
    });
    return () => { clearTimeout(timer); clearInterval(poll); sub.remove(); };
  }, [loading, load]));

  // Reconcile directly from the visible feed, including cache and cloud hydration.
  useFocusEffect(useCallback(() => {
    const refreshBadges = () => {
      const episodes = sections.filter((s) => s.type === "episode").flatMap((s) => s.items as EpisodeItem[]);
      void reconcileCompletionFromEpisodes(episodes.map((ep) => ({
        animeHref: ep.animeHref || toAnimeUrl(ep.href), animeTitle: ep.animeTitle,
        epNum: episodeNumberFromUrl(ep.href) ?? extractEpisodeNumber(ep.title),
      }))).catch(() => {});
    };
    refreshBadges();
  }, [sections]));

  // Refresh history + unread badge when the tab regains focus
  useFocusEffect(useCallback(() => {
    getContinueWatching().then(setHistory);
    getUnreadCount().then(setUnread).catch(() => {});
  }, []));

  // Top bar: transparent over the hero, solid once the hero scrolls away.
  // Animates only when crossing the threshold, never per frame.
  const topBarSolid = useRef(new Animated.Value(0)).current;
  const topBarShown = useRef(false);
  const onFeedScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const show = e.nativeEvent.contentOffset.y > HERO_H - 320; // before the hero title reaches the bar
    if (show === topBarShown.current) return;
    topBarShown.current = show;
    Animated.timing(topBarSolid, { toValue: show ? 1 : 0, duration: 180, useNativeDriver: true }).start();
  }, [topBarSolid]);

  // Show only the known witanime rails, in the payload's (display) order.
  const visibleSections = useMemo(
    () => sections.filter((s) => HOME_SECTION_IDS.includes(s.id)),
    [sections],
  );

  if (loading) return <HomeSkeleton />;

  // Genuinely nothing to show after the retries were exhausted — give the user
  // a clear retry affordance instead of a near-blank page. Uses the filtered
  // rail list so a payload carrying only dropped/unknown section ids still
  // lands on the empty state instead of rendering an almost-blank feed.
  if (featured.length === 0 && visibleSections.length === 0 && history.length === 0) {
    return (
      <HomeEmpty
        insets={insets}
        offline={offline}
        onMenu={openSidebar}
        onRetry={() => { setLoading(true); reload(); }}
      />
    );
  }

  return (
    <View style={ss.root}>
      {/* ── Top Bar — floats over the full-bleed hero, turns solid past it ── */}
      <View style={[ss.topBar, ss.topBarFloating, { paddingTop: insets.top + 8 }]}>
        <Animated.View pointerEvents="none" style={[ABSOLUTE_FILL, ss.topBarSolid, { opacity: topBarSolid }]} />
        <View style={ss.topBarInner}>
          <PantoufaWordmark />
          {/* Actions consolidated into one frosted segmented cluster — a single
              premium control instead of three scattered circles. Each segment
              keeps its own 44px hit target + handler. */}
          <View style={ss.actionCluster}>
            <Pressable accessibilityRole="button" accessibilityLabel={t.scheduleTitle} style={ss.clusterBtn} onPress={() => router.push("/schedule")} hitSlop={8}>
              <Ionicons name="calendar-outline" size={18} color={C.text} />
            </Pressable>
            <View style={ss.clusterDivider} />
            <Pressable accessibilityRole="button" accessibilityLabel={t.notifications} style={ss.clusterBtn} onPress={() => router.push("/notifications")} hitSlop={8}>
              <Ionicons name={unread > 0 ? "notifications" : "notifications-outline"} size={18} color={unread > 0 ? C.accent : C.text} />
              {unread > 0 && (
                <View style={ss.notifBadge}>
                  <Text style={ss.notifBadgeText}>{unread > 9 ? "9+" : unread}</Text>
                </View>
              )}
            </Pressable>
            <View style={ss.clusterDivider} />
            <Pressable accessibilityRole="button" accessibilityLabel={t.menu} style={ss.clusterBtn} onPress={openSidebar} hitSlop={8}>
              <Ionicons name="menu" size={20} color={C.text} />
            </Pressable>
          </View>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        removeClippedSubviews
        onScroll={onFeedScroll}
        scrollEventThrottle={32}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); reload(); }}
            tintColor={C.accent}
            colors={[C.accent]}
            progressBackgroundColor={C.surface}
          />
        }
      >
        {/* ── Hero Carousel (state isolated — see HeroCarousel) ─────── */}
        {featured.length > 0
          ? <HeroCarousel featured={featured} topInset={insets.top} />
          : <View style={{ height: insets.top + 76 }} />}

        <AnimeOfTheDay />

        {/* ── Resume shelf (Continue Watching) ───────────────
            Promoted onto a frosted panel that OVERLAPS the hero's lower edge —
            the privileged "get back to it" surface floating over the cinematic
            plate. Same data + handlers as before, new hierarchy. */}
        {history.length > 0 && (
          <View style={ss.shelf}>
            <View style={ss.shelfHeader}>
              <View style={ss.sectionTitleRow}>
                <Text style={ss.sectionTitle}>{t.continueWatching}</Text>
                <View style={ss.sectionTick} />
              </View>
            </View>
            <RtlRow contentContainerStyle={{ paddingHorizontal: PAD, gap: 14, paddingBottom: 2 }}>
              {history.slice(0, 10).map((entry) => (
                <ContinueCard
                  key={entry.episodeHref}
                  entry={entry}
                  onRemove={handleRemoveContinue}
                />
              ))}
            </RtlRow>
          </View>
        )}

        {/* ── Sections ─────────────────────── */}
        <ForYouRail history={history} width={CARD_W} />

        {visibleSections.map((section, si) => {
          // The new-episodes rail always shows the newest 10 (fuller list
          // behind the See all button); anime rails keep the wider preview.
          const MAX_PREVIEW = section.type === "episode" ? 10 : 15;
          const previewItems = section.items.slice(0, MAX_PREVIEW);
          const hasMore = section.items.length > MAX_PREVIEW;
          const openAll = () => {
            const localized = SECTION_LABELS[section.id] || section.title;
            router.push(`/see-all/${encodeURIComponent(section.id)}?title=${encodeURIComponent(localized)}&type=${section.type}`);
          };
          return (
            <Rise key={section.id} style={ss.section} delay={Math.min(si, 6) * 70}>
              <View style={ss.sectionHeader}>
                <View style={ss.sectionTitleRow}>
                  <Text style={ss.sectionTitle}>{SECTION_LABELS[section.id] || section.title}</Text>
                  <View style={ss.sectionTick} />
                </View>
                <Pressable style={({ pressed }) => [ss.seeAllBtn, pressed && ss.pressedSoft]} onPress={openAll} accessibilityRole="button" hitSlop={6}>
                  <Ionicons name="chevron-back" size={13} color={C.accent} />
                  <Text style={ss.seeAllText}>{t.seeAllShort}</Text>
                </Pressable>
              </View>
              <FlatList<AnimeItem | EpisodeItem>
                horizontal
                inverted
                showsHorizontalScrollIndicator={false}
                initialNumToRender={3}
                maxToRenderPerBatch={3}
                windowSize={3}
                data={previewItems}
                keyExtractor={(item, i) => item.href || String(i)}
                contentContainerStyle={{ paddingHorizontal: PAD, gap: 14 }}
                renderItem={({ item, index }) => section.type === "anime"
                  // Rank numerals only mean something on the "most watched" rails.
                  ? <AnimeCardView item={item as AnimeItem} rank={section.id.startsWith("top_") ? index + 1 : undefined} />
                  : <EpisodeCardView item={item as EpisodeItem} onPress={openEpisodePopup} />}
                ListFooterComponent={hasMore ? (
                  <Pressable style={ss.seeAllCard} onPress={openAll}>
                    <View style={ss.seeAllCircle}>
                      <Ionicons name="arrow-back" size={20} color={C.accent} />
                    </View>
                    <Text style={ss.seeAllCardText}>{t.seeAllShort}</Text>
                  </Pressable>
                ) : null}
              />
            </Rise>
          );
        })}

        {/* Banner ad at the end of the feed (no-op until configured) */}
        <AdBanner style={{ marginTop: S.xxl }} />

        <View style={{ height: insets.bottom + 100 }} />
      </ScrollView>

      {/* Episode tap → slide-up bottom sheet (watch directly or open anime page).
          Mounted only while open so the entrance animation fires each time. */}
      {episodePopup && <EpisodeActionSheet episode={episodePopup} onClose={closeEpisodePopup} />}
    </View>
  );
}

/* ── Episode tap sheet ──────────────────────── */

function EpisodeActionSheet({ episode, onClose }: { episode: EpisodeItem; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  // Slide-up + backdrop-fade. RN core Animated (Reanimated crashes over OTA).
  const translateY = useRef(new Animated.Value(reduced ? 0 : 520)).current;
  const backdrop = useRef(new Animated.Value(reduced ? 1 : 0)).current;

  useEffect(() => {
    if (reduced) return;
    Animated.parallel([
      Animated.timing(translateY, { toValue: 0, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(backdrop, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
  }, []);

  // Animated dismiss — only for the backdrop/cancel affordances. The action
  // buttons keep their exact original onPress (they navigate away, so an exit
  // animation would just delay the transition).
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
        <Pressable style={ABSOLUTE_FILL} onPress={animateClose}>
          <Animated.View style={[ABSOLUTE_FILL, ss.sheetBackdrop, { opacity: backdrop }]} />
        </Pressable>
        <View style={ss.sheetAnchor} pointerEvents="box-none">
          <Animated.View
            style={[ss.sheetPanel, { paddingBottom: insets.bottom + 16, transform: [{ translateY }] }]}
            onStartShouldSetResponder={() => true}
          >
            <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 10 }}>
            <View style={ss.sheetGrabber} />
            {episode.image ? (
              <Image source={{ uri: episode.image }} style={ss.sheetImage} contentFit="cover" />
            ) : (
              <View style={[ss.sheetImage, { alignItems: "center", justifyContent: "center" }]}>
                <Ionicons name="film-outline" size={32} color={C.textMuted} />
              </View>
            )}
            <Text style={ss.sheetTitle} numberOfLines={2}>{episode.title}</Text>
            {episode.animeTitle ? <Text style={ss.sheetSub} numberOfLines={1}>{episode.animeTitle}</Text> : null}

            <Pressable
              style={ss.sheetBtnPrimary}
              onPress={() => {
                onClose();
                const params: Record<string, string> = {};
                if (episode.image) params.img = encodeURIComponent(episode.image);
                if (episode.animeTitle) params.animeTitle = episode.animeTitle;
                const epNum = episodeNumberFromUrl(episode.href);
                if (epNum != null) params.epNum = String(epNum);
                // Pass animeHref so the watch screen can compute prev/next.
                const rawAnime = episode.animeHref || episode.href;
                const animeUrl = rawAnime && rawAnime.includes('/anime/')
                  ? rawAnime
                  : (toAnimeUrl(rawAnime) ?? '');
                if (animeUrl) params.anime = animeUrl;
                // Defer one frame so the modal-close + button feedback paint
                // before the heavy watch-screen mount blocks the JS thread.
                requestAnimationFrame(() => router.push({
                  pathname: `/watch/${encodeURIComponent(episode.href)}`,
                  params,
                }));
              }}
            >
              <Ionicons name="play" size={16} color={C.textOnAccent} />
              <Text style={ss.sheetBtnPrimaryText}>{t.watchEpisode}</Text>
            </Pressable>

            <Pressable
              style={ss.sheetBtnSecondary}
              onPress={() => {
                onClose();
                // Cached payloads sometimes have an episode URL in animeHref.
                // Normalize so we always navigate to the real anime page.
                const raw = episode.animeHref || episode.href;
                const animeUrl = raw && raw.includes('/anime/') ? raw : (toAnimeUrl(raw) ?? raw);
                if (animeUrl) router.push(`/anime/${encodeURIComponent(animeUrl)}`);
              }}
              disabled={!episode.animeHref && !episode.href}
            >
              <Ionicons name="information-circle-outline" size={16} color={C.text} />
              <Text style={ss.sheetBtnSecondaryText}>{t.openAnimePage}</Text>
            </Pressable>

            <Pressable style={ss.sheetCancel} onPress={animateClose}>
              <Text style={ss.sheetCancelText}>{t.cancel}</Text>
            </Pressable>
            </ScrollView>
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

/* ── Anime Card (cinematic) ──────────────────── */

const AnimeCardView = memo(function AnimeCardView({ item, rank }: { item: AnimeItem; rank?: number }) {
  const card = (
    <PosterCard
      image={item.image}
      title={item.title}
      onPress={() => router.push(`/anime/${encodeURIComponent(item.href)}`)}
      width={CARD_W}
      newBadge={item.isNew}
      recyclingKey={item.href}
      titleLines={1}
      topRight={<MalCardBadge title={item.title} />}
      bottomRight={<CompletionBadge hrefs={[item.href, ...Object.values(item.sourceHrefs || {})]} titles={[item.title]} />}
    />
  );
  if (rank == null) return card;
  // "Most watched" rails: a big chart numeral tucked behind the poster's right
  // edge (the leading edge in Arabic), so the rank reads before the art.
  return (
    <View style={{ width: CARD_W + (rank >= 10 ? RANK_W2 : RANK_W1), height: CARD_W * 1.5 }}>
      <Text style={ss.rankNum} accessibilityElementsHidden importantForAccessibility="no">{rank}</Text>
      <View style={ss.rankPoster}>{card}</View>
    </View>
  );
});

/* ── For You (recommendations) ──
   Personalised rail seeded by the WHOLE watch history: every distinct anime is
   weighted by episodes watched + recency (lib/recommend pickTasteSeeds), the
   top 6 are resolved against AniList, and their community recommendations are
   merged with per-seed normalisation so no single anime owns the rail.
   Tapping a card resolves it to a source page via the shared
   AniListPosterCard. Hidden entirely when there's nothing to show. */
const seedKeyOf = (e: { animeTitle: string; animeHref: string }) =>
  normAnimeKey(e.animeHref) || animeTitleKey(e.animeTitle);
const FOR_YOU_SEEDS = 6;

const ForYouRail = memo(function ForYouRail({ history, width }: { history: WatchEntry[]; width: number }) {
  const [items, setItems] = useState<RankedRec[]>([]);
  // Full per-anime history (not just Continue Watching, which hides finished
  // and dismissed anime). Re-read when the continue list changes — that is
  // the signal something new was watched.
  const [groups, setGroups] = useState<AnimeHistoryGroup[]>([]);
  useEffect(() => {
    let alive = true;
    getHistoryByAnime().then((g) => { if (alive) setGroups(g); }).catch(() => {});
    return () => { alive = false; };
  }, [history]);

  const seeds = useMemo(
    () => pickTasteSeeds(groups.map((g) => ({ animeTitle: g.animeTitle, animeHref: g.animeHref, watched: g.watched, updatedAt: g.updatedAt })), seedKeyOf, FOR_YOU_SEEDS),
    [groups],
  );
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  // Refetch only when the seed SET changes — not on every progress tick.
  const seedKey = seeds.map((s) => s.animeTitle).join("|");
  const seedsRef = useRef(seeds);
  seedsRef.current = seeds;

  useFocusEffect(useCallback(() => {
    const picked = seedsRef.current;
    if (picked.length === 0) { setItems([]); return; }
    let alive = true;
    const timer = setTimeout(() => { void (async () => {
      const [batches, favorites] = await Promise.all([
        Promise.all(picked.map((s) => fetchAnimeRecommendations(s.animeTitle, s.animeHref).catch(() => [] as RecItem[]))),
        getFavorites().catch(() => []),
      ]);
      if (!alive) return;
      // Nothing the user already watched / bookmarked may come back as a rec.
      const keys = new Set<string>();
      const canons = new Set<string>();
      const remember = (title: string | null | undefined) => {
        if (!title) return;
        const k = animeTitleKey(title);
        if (k) keys.add(k);
        canons.add(canonTitle(title));
      };
      for (const g of groupsRef.current) remember(g.animeTitle);
      for (const f of favorites) remember(f.title);
      const excluded = (item: RecItem) =>
        [item.title, item.titleEnglish].some((title) => {
          if (!title) return false;
          return keys.has(animeTitleKey(title)) || canons.has(canonTitle(title));
        });
      const ranked = rankRecommendations(batches, { excluded, cap: 15, weights: picked.map((s) => s.weight) });
      if (alive) setItems(ranked);
    })().catch(() => {}); }, 5000);
    return () => { alive = false; clearTimeout(timer); };
  }, [seedKey]));

  if (items.length === 0) return null;
  return (
    <View style={ss.section}>
      <View style={ss.sectionHeader}>
        <View style={ss.sectionTitleRow}>
          <Ionicons name="sparkles" size={14} color={C.mint} />
          <Text style={ss.sectionTitle}>{t.recsForYou}</Text>
          <View style={ss.sectionTick} />
        </View>
      </View>
      <FlatList
        horizontal
        inverted
        showsHorizontalScrollIndicator={false}
        initialNumToRender={3}
        maxToRenderPerBatch={3}
        windowSize={3}
        data={items}
        keyExtractor={(item) => String(item.anilistId)}
        contentContainerStyle={{ paddingHorizontal: PAD, gap: 14 }}
        renderItem={({ item }) => (
          <AniListPosterCard
            key={item.anilistId}
            entry={item}
            width={width}
            topRight={<MalCardBadge title={item.title} />}
          />
        )}
      />
    </View>
  );
});

/* ── Episode Card (wide cinematic) ───────────── */

const EpisodeCardView = memo(function EpisodeCardView({ item, onPress }: { item: EpisodeItem; onPress: (item: EpisodeItem) => void }) {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const sized = posterUrl(item.image, EP_W);
  const uri = failedUri === sized ? item.image : sized;
  const epNum = episodeNumberFromUrl(item.href) ?? extractEpisodeNumber(item.title);
  return (
    <Pressable
      onPress={() => onPress(item)}
      style={({ pressed }) => ({ width: EP_W, opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}
    >
      <View style={ss.epCard}>
        {item.image ? (
          <Image source={{ uri }} style={ABSOLUTE_FILL} contentFit="cover" cachePolicy="memory-disk" recyclingKey={item.href} transition={0} priority="high" onError={() => { if (sized !== item.image) setFailedUri(sized ?? null); }} />
        ) : (
          <View style={[ABSOLUTE_FILL, { backgroundColor: C.surface, alignItems: "center", justifyContent: "center" }]}>
            <Ionicons name="film-outline" size={24} color={C.textMuted} />
          </View>
        )}
        {item.isNew && (
          <View style={ss.newBadge}>
            <Text style={ss.badgeText}>{t.newBadge}</Text>
          </View>
        )}
        <LinearGradient colors={["rgba(8,9,12,0)", "rgba(8,9,12,0.75)"]} style={ss.epScrim} pointerEvents="none" />
        <View style={ss.epPill} pointerEvents="none">
          <Ionicons name="play" size={11} color={C.textOnAccent} />
          {epNum != null ? <Text style={ss.epPillText}>{t.episode} {epNum}</Text> : null}
        </View>
        <CompletionBadge hrefs={[item.animeHref]} titles={[item.animeTitle]} />
      </View>
      <Text style={ss.epTitle} numberOfLines={1}>{item.animeTitle || item.title}</Text>
      {item.animeTitle && epNum == null ? <Text style={ss.epSub} numberOfLines={1}>{item.title}</Text> : null}
    </Pressable>
  );
});

/* ── Continue Watching Card ─────────────────────── */

function extractEpisodeNumber(title: string): number | null {
  if (!title) return null;
  // Arabic numerals
  const arMatch = title.match(/الحلقة[\s\-_]*([٠-٩]+)/);
  if (arMatch) {
    const ar = arMatch[1];
    let num = "";
    for (const ch of ar) {
      num += String(ch.codePointAt(0)! - 0x0660);
    }
    return parseInt(num, 10) || null;
  }
  // Western numerals. Require "حلقة" or "Ep"/"Episode" — a bare "E" matched too
  // many incidental letters and produced wrong numbers.
  const enMatch = title.match(/(?:حلقة|الحلقة)\s*(\d+)/) || title.match(/\bEp(?:isode)?[.\s]*\s*(\d+)/i);
  if (enMatch) return parseInt(enMatch[1], 10) || null;
  return null;
}

/**
 * Episode number for the Continue Watching badge. The episode URL is the
 * canonical source (witanime/anime4up carry …الحلقة-N, anime3rb carries
 * /episode/<slug>/<n>) and is always correct for the saved episode, so prefer
 * it over the scraped title — the title can lag during prev/next navigation
 * and mis-parses titles with numbers in the anime name.
 */
function episodeNumberFor(entry: WatchEntry): number | null {
  const href = entry.episodeHref || "";
  let s = href;
  try { s = decodeURIComponent(href); } catch {}
  const witMatch = s.match(/الحلقة[\s\-_]*(\d+)/);
  if (witMatch) return parseInt(witMatch[1], 10) || null;
  const a3rbMatch = s.match(/\/episode\/[^/]+\/(\d+)/);
  if (a3rbMatch) return parseInt(a3rbMatch[1], 10) || null;
  return extractEpisodeNumber(entry.episodeTitle);
}

const ContinueCard = memo(function ContinueCard({ entry, onRemove }: { entry: WatchEntry; onRemove: (href: string) => void }) {
  const pct = progressPercent(entry);
  const remainMs = entry.durationMs - entry.positionMs;
  const remainMin = Math.max(1, Math.round(remainMs / 60000));
  const epNum = episodeNumberFor(entry);
  // Old history rows (and some sources) stored the anime name as the episode
  // title, which made the card print the same string twice. Synthesize the
  // episode label from the number when that happens.
  const rawTitle = (entry.episodeTitle || "").trim();
  const animeName = (entry.animeTitle || "").trim();
  const epTitle = (!rawTitle || (animeName && rawTitle.toLowerCase() === animeName.toLowerCase()))
    ? (epNum !== null ? `${t.episode} ${epNum}` : "")
    : rawTitle;
  // Anime name leads; the episode + time left is the supporting line. When the
  // episode title already carries the anime name, it becomes the lead instead.
  const epHasName = !!epTitle && !!animeName && epTitle.toLowerCase().includes(animeName.toLowerCase());
  const lead = epHasName ? epTitle : (animeName || epTitle);
  const support = [epHasName ? "" : epTitle, t.minLeft(remainMin)].filter(Boolean).join(" · ");
  return (
    <Pressable
      onPress={() => {
        const params: Record<string, string> = {};
        if (entry.url4up) params.url4up = encodeURIComponent(entry.url4up);
        if (entry.image) params.img = encodeURIComponent(entry.image);
        if (entry.animeTitle) params.animeTitle = entry.animeTitle;
        if (epNum != null) params.epNum = String(epNum);
        // Pass anime URL so prev/next + back-to-anime work. Falls back
        // to slug-deriving from the episode URL if animeHref is missing
        // or points to an episode page (old cached entries).
        const rawAnime = entry.animeHref || entry.episodeHref;
        const animeUrl = rawAnime && rawAnime.includes('/anime/')
          ? rawAnime
          : (toAnimeUrl(rawAnime) ?? '');
        if (animeUrl) params.anime = animeUrl;
        router.push({
          pathname: `/watch/${encodeURIComponent(entry.episodeHref)}`,
          params,
        });
      }}
      style={({ pressed }) => ({ width: EP_W, opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}
    >
      <View style={ss.epCard}>
        {entry.image ? (
          <Image source={{ uri: posterUrl(entry.image, EP_W) }} style={ABSOLUTE_FILL} contentFit="cover" cachePolicy="memory-disk" recyclingKey={entry.episodeHref} transition={200} />
        ) : (
          <LinearGradient
            colors={[C.surface, C.surfaceLight]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={ABSOLUTE_FILL}
          />
        )}
        <LinearGradient colors={["rgba(8,9,12,0)", "rgba(8,9,12,0.75)"]} style={ss.epScrim} pointerEvents="none" />
        <View style={[ss.epPill, ss.epPillResume]} pointerEvents="none">
          <Ionicons name="play" size={11} color={C.textOnAccent} />
          <Text style={ss.epPillText}>{t.resume}</Text>
        </View>
        {/* Delete button */}
        <Pressable
          onPress={(e) => { e.stopPropagation?.(); onRemove(entry.episodeHref); }}
          style={ss.deleteBtn}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t.remove}
        >
          <Ionicons name="close" size={12} color={C.white} />
        </Pressable>
        {/* Progress bar */}
        <View style={ss.progressBarBg}>
          <View style={[ss.progressBarFill, { width: `${Math.round(pct * 100)}%` }]} />
        </View>
      </View>
      <Text style={ss.epTitle} numberOfLines={1}>{lead}</Text>
      <Text style={ss.epSub} numberOfLines={1}>{support}</Text>
    </Pressable>
  );
});

/* ── Empty / error state ──────────────────────── */

function HomeEmpty({
  insets, offline, onRetry, onMenu,
}: {
  insets: { top: number; bottom: number };
  offline: boolean;
  onRetry: () => void;
  onMenu: () => void;
}) {
  return (
    <View style={ss.root}>
      <View style={[ss.topBar, { paddingTop: insets.top + 8 }]}>
        <View style={ss.topBarInner}>
          <PantoufaWordmark />
          <Pressable onPress={onMenu} hitSlop={8}>
            <View style={ss.glassBtn}>
              <Ionicons name="menu" size={20} color={C.text} />
            </View>
          </Pressable>
        </View>
      </View>
      <StateView
        icon={offline ? "cloud-offline-outline" : "alert-circle-outline"}
        variant={offline ? "offline" : "error"}
        title={offline ? t.offlineTitle : t.homeEmptyTitle}
        message={offline ? t.offlineSub : t.homeEmptySub}
        primary={{ label: t.watchDownloads, onPress: () => router.push("/downloads"), icon: "download" }}
        secondary={{ label: t.retry, onPress: onRetry, icon: "refresh" }}
      />
    </View>
  );
}

/* ── Skeleton ─────────────────────────────────── */

function HomeSkeleton() {
  return (
    <View style={ss.root}>
      <Shimmer style={{ width: "100%", height: HERO_H }} borderRadius={0} />
      <View style={{ paddingHorizontal: PAD, marginTop: 28 }}>
        <Shimmer style={{ width: 160, height: 20, marginBottom: 16 }} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Shimmer key={i} style={{ width: CARD_W, height: CARD_H, marginRight: 14 }} borderRadius={R.lg} />
          ))}
        </ScrollView>
      </View>
      <View style={{ paddingHorizontal: PAD, marginTop: 28 }}>
        <Shimmer style={{ width: 190, height: 20, marginBottom: 16 }} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Shimmer key={i} style={{ width: EP_W, height: EP_H, marginRight: 14 }} borderRadius={R.lg} />
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

/* ── Styles ───────────────────────────────────── */

const ss = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  // Top bar
  topBar: {
    zIndex: 50, backgroundColor: C.bg,
  },
  topBarInner: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: PAD, paddingBottom: 12,
  },
  // Standalone glass button — used by HomeEmpty's single menu control. 44px floor.
  glassBtn: {
    width: 44, height: 44, borderRadius: R.circle, overflow: "hidden",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: C.glassBorder,
  },
  // Frosted segmented action cluster — one connected control, three 44px segments.
  actionCluster: {
    flexDirection: "row", alignItems: "center", height: 48, paddingHorizontal: 4,
    borderRadius: R.pill, overflow: "hidden", backgroundColor: "rgba(20,22,28,0.85)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.10)",
  },
  clusterBtn: {
    width: 44, height: 48, alignItems: "center", justifyContent: "center",
  },
  clusterDivider: { width: 1, height: 22, backgroundColor: C.glassBorder },
  notifBadge: {
    position: "absolute", top: 5, right: 5,
    minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4,
    backgroundColor: C.accent, alignItems: "center", justifyContent: "center",
    borderWidth: 1.5, borderColor: C.bg,
  },
  notifBadgeText: {
    color: C.textOnAccent, fontSize: 9, fontWeight: "800", fontFamily: "Cairo_700Bold",
  },

  // Floating top bar over the hero
  topBarFloating: { position: "absolute", top: 0, left: 0, right: 0, backgroundColor: "transparent" },
  topBarSolid: { backgroundColor: C.bg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },

  // Hero — full-bleed art, text block anchored bottom-right (RTL).
  heroSlide: { backgroundColor: C.surface, overflow: "hidden" },
  heroTopScrim: { position: "absolute", top: 0, left: 0, right: 0, height: 150 },
  heroBottomScrim: { position: "absolute", left: 0, right: 0, bottom: 0 },
  heroContent: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    paddingHorizontal: PAD, paddingBottom: 48,
  },
  heroTrack: {
    position: "absolute", bottom: 20, left: 0, right: 0,
    flexDirection: "row", justifyContent: "center", gap: 6,
  },
  seg: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.32)" },
  segActive: { width: 22, backgroundColor: C.accent },
  heroGenres: {
    ...TAr.caption, fontSize: 12, color: C.mint, textAlign: "right", marginBottom: 6,
  },
  heroTitle: {
    ...TAr.display, fontSize: 30, lineHeight: 42,
    color: C.bone, textAlign: "right",
    textShadowColor: "rgba(0,0,0,0.5)", textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 10,
  },
  heroDesc: {
    ...TAr.body, color: C.textSoft, textAlign: "right", marginTop: 6,
  },
  // row-reverse puts the primary action on the right; margins, not gap.
  heroButtons: { flexDirection: "row-reverse", marginTop: 18 },
  heroPrimary: {
    flex: 1.35, flexDirection: "row-reverse", alignItems: "center", justifyContent: "center",
    height: 52, borderRadius: R.pill, backgroundColor: C.accent, marginLeft: 10,
    ...ELEVATION_GLOW,
  },
  heroPrimaryText: { ...TAr.label, color: C.textOnAccent, fontFamily: "Cairo_700Bold", marginRight: 8 },
  heroSecondary: {
    flex: 1, flexDirection: "row-reverse", alignItems: "center", justifyContent: "center",
    height: 52, borderRadius: R.pill,
    backgroundColor: "rgba(255,255,255,0.12)", borderWidth: 1, borderColor: "rgba(255,255,255,0.18)",
  },
  heroSecondaryText: { ...TAr.label, color: C.text, marginRight: 6 },
  pressedSoft: { opacity: 0.85, transform: [{ scale: 0.98 }] },

  // Resume shelf — frosted panel that sits cleanly below the hero (a small gap
  // keeps its rounded top reading as a distinct floating surface, not fused to
  // the hero art above it).
  shelf: {
    marginTop: 12, paddingTop: 12, paddingBottom: 4,
  },
  shelfHeader: {
    paddingHorizontal: PAD, marginBottom: 14,
  },

  // Sections
  section: { marginTop: 36 },
  sectionHeader: {
    flexDirection: "row-reverse", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: PAD, marginBottom: 14,
  },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 10 },
  // Editorial marginal rule — a crisp ember stroke leading the title.
  sectionTick: {
    width: 4, height: 20, borderRadius: 2, backgroundColor: C.accent,
  },
  sectionTitle: {
    ...TAr.h2, color: C.bone,
  },
  // "See all" stays ash — ember is reserved for the primary action.
  seeAllBtn: {
    flexDirection: "row", alignItems: "center", gap: 4, height: 32, paddingHorizontal: 12,
    borderRadius: R.pill, backgroundColor: C.accentSoft,
  },
  seeAllText: { color: C.accent, fontSize: 12, lineHeight: 18, fontWeight: "600", fontFamily: "Cairo_600SemiBold" },

  // "See All" tail card in horizontal list
  seeAllCard: {
    width: CARD_W, height: CARD_H, borderRadius: R.lg,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    alignItems: "center", justifyContent: "center", gap: 8,
  },
  seeAllCircle: {
    width: 44, height: 44, borderRadius: R.circle,
    backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.borderAccent,
    alignItems: "center", justifyContent: "center",
  },
  seeAllCardText: { color: C.accent, fontSize: 12, fontWeight: "600", fontFamily: "Cairo_600SemiBold" },

  // Chart numeral behind ranked posters
  rankNum: {
    position: "absolute", right: 0, bottom: -18,
    fontFamily: "Outfit_900Black", fontSize: 132, lineHeight: 150, letterSpacing: -8,
    color: "rgba(139,147,255,0.42)",
  },
  rankPoster: { position: "absolute", left: 0, top: 0 },

  // Progress bar (continue watching)
  progressBarBg: {
    position: "absolute", bottom: 0, left: 0, right: 0, height: 4,
    backgroundColor: "rgba(255,255,255,0.18)", alignItems: "flex-end", // fills from the right (RTL)
  },
  progressBarFill: {
    height: 4, backgroundColor: C.accent,
    borderTopLeftRadius: 2, borderBottomLeftRadius: 2,
  },
  deleteBtn: {
    position: "absolute", top: 6, right: 6,
    width: 32, height: 32, borderRadius: R.sm,
    backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center",
  },

  // Badges (used by EpisodeCardView + ContinueCard)
  newBadge: {
    position: "absolute", top: 8, left: 8, zIndex: 2,
    backgroundColor: C.ember, borderRadius: R.xs, paddingHorizontal: 7, paddingVertical: 3,
  },
  badgeText: {
    color: C.textOnAccent, fontSize: 9, fontWeight: "700", letterSpacing: 0.8,
    fontFamily: "Cairo_700Bold",
  },

  // Episode cards
  epCard: {
    width: EP_W, height: EP_H, borderRadius: R.lg, overflow: "hidden",
    backgroundColor: C.surface,
  },
  epScrim: { position: "absolute", left: 0, right: 0, bottom: 0, height: "55%" },
  // Small action pill, bottom-left (trailing edge in RTL): play + episode no.
  epPill: {
    position: "absolute", left: 8, bottom: 10,
    flexDirection: "row-reverse", alignItems: "center",
    height: 26, paddingHorizontal: 10, borderRadius: R.pill, backgroundColor: C.accent,
  },
  epPillResume: { bottom: 12 },
  epPillText: { color: C.textOnAccent, fontSize: 11, lineHeight: 16, fontFamily: "Cairo_700Bold", marginRight: 5 },
  epTitle: {
    color: C.text, fontSize: 13, fontWeight: "600", lineHeight: 21,
    marginTop: 10, width: EP_W, fontFamily: "Cairo_600SemiBold", textAlign: "right",
  },
  epSub: {
    color: C.textMuted, fontSize: 11, lineHeight: 18, marginTop: 2, width: EP_W, textAlign: "right",
    fontFamily: "Cairo_500Medium",
  },

  // Episode action bottom sheet
  sheetBackdrop: { backgroundColor: "rgba(0,0,0,0.72)" },
  sheetAnchor: { flex: 1, justifyContent: "flex-end", paddingTop: 24 },
  sheetPanel: {
    maxHeight: "100%",
    backgroundColor: C.playerSheet,
    borderTopLeftRadius: R.xxl, borderTopRightRadius: R.xxl,
    paddingHorizontal: 20, paddingTop: 12,
    borderTopWidth: 1, borderColor: C.border,
    gap: 10,
    ...ELEVATION_NAV,
  },
  sheetGrabber: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: C.controlDim,
    alignSelf: "center", marginBottom: 8,
  },
  sheetImage: {
    width: "100%", aspectRatio: 16 / 9, borderRadius: R.lg,
    backgroundColor: C.surface, marginBottom: 4,
  },
  sheetTitle: {
    color: C.text, fontSize: 16, fontWeight: "700",
    fontFamily: "Cairo_700Bold", textAlign: "center",
  },
  sheetSub: {
    color: C.textMuted, fontSize: 12, textAlign: "center",
    fontFamily: "Cairo_500Medium", marginBottom: 6,
  },
  sheetBtnPrimary: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: C.accent, paddingVertical: 14, borderRadius: R.pill,
  },
  sheetBtnPrimaryText: {
    color: C.textOnAccent, fontSize: 14, fontWeight: "700", fontFamily: "Cairo_600SemiBold",
  },
  sheetBtnSecondary: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    paddingVertical: 14, borderRadius: R.pill,
  },
  sheetBtnSecondaryText: {
    color: C.text, fontSize: 14, fontWeight: "700", fontFamily: "Cairo_600SemiBold",
  },
  sheetCancel: { paddingVertical: 10, alignItems: "center" },
  sheetCancelText: {
    color: C.textMuted, fontSize: 13, fontWeight: "600", fontFamily: "Cairo_500Medium",
  },
});

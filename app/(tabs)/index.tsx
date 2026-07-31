import { useEffect, useState, useCallback, useRef, useMemo, memo } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Dimensions,
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
import { addFavorite, isFavorite, toAnimeUrl } from "../../lib/favorites";
import { getContinueWatching, progressPercent, dismissFromContinue } from "../../lib/history";
import type { WatchEntry } from "../../lib/history";
import { syncEpisodeNotifications, reportRecentEpisodes, getUnreadCount } from "../../lib/notifications";
import { useSidebar } from "../../components/Sidebar";
import { Shimmer } from "../../components/Shimmer";
import { GlassFill } from "../../components/GlassFill";
import { SourceRail } from "../../components/SourceRail";
import { AdBanner } from "../../components/AdBanner";
import { MalCardBadge } from "../../components/MalRating";
import { CompletionBadge } from "../../components/CompletionBadge";
import { PosterCard } from "../../components/PosterCard";
import { StateView } from "../../components/StateView";
import { C, S, R, T, TAr, ELEVATION_CARD, ELEVATION_GLOW, ELEVATION_NAV } from "../../lib/theme";
import { t } from "../../lib/i18n";
import { checkOnline } from "../../lib/net";
import { remoteLog, errText } from "../../lib/remoteLog";
import { useReducedMotion } from "../../lib/motion";
import { posterUrl } from "../../lib/img";
import { Rise } from "../../components/Rise";

const { width: SW } = Dimensions.get("window");
const HERO_H = 460;
const CARD_W = 140;
const CARD_H = 200;
const EP_W = 200;
const EP_H = 112;
const PAD = S.paddingContent;

const SECTION_LABELS: Record<string, string> = {
  trending: "الأكثر رواجًا",
  recently_updated: "حلقات جديدة",
  tv_series: "مسلسلات",
  movies: "أفلام",
};

// Display order for the home sections: New Episodes first, then Most Popular,
// then everything else in the API's original order (stable sort). Continue
// Watching is rendered separately above and is unaffected.
const SECTION_ORDER = ["recently_updated", "trending"];
function sectionRank(id: string): number {
  const i = SECTION_ORDER.indexOf(id);
  return i === -1 ? SECTION_ORDER.length : i;
}

/* ── Hero Carousel (isolated) ──────────────────────────────────
   Owns its OWN paging index + 5s auto-advance timer, so a hero tick or swipe
   re-renders only the carousel — not the entire home feed (every rail +
   categories). Previously heroIndex lived on HomeScreen, so each 5s auto-advance
   reconciled the whole tree on the JS thread and stuttered an in-progress
   vertical scroll. Memoized: re-renders only when `featured` changes. */
const HeroCarousel = memo(function HeroCarousel({ featured }: { featured: FeaturedItem[] }) {
  const heroRef = useRef<ScrollView>(null);
  const [heroIndex, setHeroIndex] = useState(0);
  const heroTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Accessibility: honor the OS "Reduce Motion" switch. When on, the hero does
  // NOT auto-advance (self-moving carousels are a classic reduced-motion
  // offender) — the user pages it manually. Content is never gated on motion,
  // so every slide stays reachable.
  const reduced = useReducedMotion();

  const startAuto = useCallback(() => {
    if (heroTimer.current) clearInterval(heroTimer.current);
    if (featured.length <= 1) return;
    if (reduced) return;
    // Don't run the auto-advance while the app is backgrounded — a 5s timer that
    // keeps firing in the user's pocket wakes the JS thread and animates an
    // off-screen ScrollView for nothing. It restarts on foreground (below).
    if (AppState.currentState !== "active") return;
    heroTimer.current = setInterval(() => {
      setHeroIndex((prev) => {
        const next = (prev + 1) % featured.length;
        heroRef.current?.scrollTo({ x: next * SW, animated: true });
        return next;
      });
    }, 5000);
  }, [featured.length, reduced]);

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
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => { onHeroScroll(e); startAuto(); }}
        scrollEventThrottle={16}
      >
        {featured.map((item, i) => (
          <View key={i} style={ss.heroSlide}>
            {/* Mesh gradient background */}
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
            {item.image && (
              <Image source={{ uri: posterUrl(item.image, SW) }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" recyclingKey={item.href} transition={200} />
            )}
            {/* Protection scrim — deepened so the title / synopsis / CTAs always
                clear WCAG AA against the darkened plate, never against raw art. */}
            <LinearGradient
              colors={["transparent", "rgba(10,10,11,0.5)", "rgba(10,10,11,0.93)", C.bg]}
              locations={[0, 0.35, 0.72, 1]}
              style={StyleSheet.absoluteFill}
            />
            {/* Hero content */}
            <View style={ss.heroContent}>
              {/* Genre chips */}
              <View style={ss.chipRow}>
                {item.genres.slice(0, 3).map((g, gi) => (
                  <View key={gi} style={ss.chip}>
                    <GlassFill intensity={16} />
                    <Text style={ss.chipText}>{g}</Text>
                  </View>
                ))}
              </View>
              <Text style={ss.heroTitle} numberOfLines={2}>{item.title}</Text>
              {item.description && (
                <Text style={ss.heroDesc} numberOfLines={2}>{item.description}</Text>
              )}
              <View style={ss.heroButtons}>
                <Pressable
                  style={ss.btnPrimaryWrap}
                  onPress={() => {
                    if (!item.href) return;
                    if (item.href.includes("/episode/")) {
                      const animeUrl = toAnimeUrl(item.href);
                      // Defer a frame so the press feedback paints before
                      // the heavy watch-screen mount blocks the thread.
                      requestAnimationFrame(() => router.push({
                        pathname: `/watch/${encodeURIComponent(item.href)}`,
                        params: animeUrl ? { anime: animeUrl } : {},
                      }));
                    } else {
                      router.push(`/anime/${encodeURIComponent(item.href)}`);
                    }
                  }}
                >
                  <LinearGradient colors={[C.accent, C.mint]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={ss.btnPrimaryGrad}>
                    <Ionicons name="play" size={16} color={C.textOnAccent} />
                    <Text style={ss.btnPrimaryText}>{t.watchNow}</Text>
                  </LinearGradient>
                </Pressable>
                <Pressable
                  style={ss.btnGlass}
                  onPress={() => {
                    if (!item.href) return;
                    addFavorite({ title: item.title, href: item.href, image: item.image || "" });
                  }}
                >
                  <Ionicons name="heart-outline" size={18} color={C.text} />
                  <Text style={ss.btnGlassText}>{t.myList}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ))}
      </ScrollView>
      {/* Segmented position indicator — pinned bottom-center of the hero (the
          conventional carousel-indicator spot). Single source of truth is
          heroIndex; sits in the hero's lower padding, clear of the CTAs. */}
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

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { openSidebar } = useSidebar();
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
  const MAX_EMPTY_RETRIES = 5;
  const COLD_START_DEADLINE_MS = 25000;

  // Popup shown when tapping an episode card — choose Watch vs Anime page
  const [episodePopup, setEpisodePopup] = useState<EpisodeItem | null>(null);
  const openEpisodePopup = useCallback((ep: EpisodeItem) => setEpisodePopup(ep), []);
  const closeEpisodePopup = useCallback(() => setEpisodePopup(null), []);

  const load = useCallback(async () => {
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
            setFeatured(feat);
            setSections(secs);
          }
        }),
        getContinueWatching(),
      ]);
      setHistory(hist);
      const feat = res?.success ? (res.data.featured ?? []) : [];
      const secs = res?.success ? (res.data.sections ?? []) : [];
      const gotContent = feat.length > 0 || secs.length > 0;
      if (gotContent) {
        setFeatured(feat);
        setSections(secs);
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
    setLoading(false);
    setRefreshing(false);
  }, []);

  // Manual refresh / retry: clear the cold-start counters so a user-initiated
  // reload gets a fresh batch of attempts.
  const reload = useCallback(() => {
    emptyRetry.current = 0;
    coldStartDeadline.current = 0; // fresh deadline for a user-initiated retry
    if (retryTimer.current) clearTimeout(retryTimer.current);
    void load();
  }, [load]);

  useEffect(() => {
    load();
    return () => { if (retryTimer.current) clearTimeout(retryTimer.current); };
  }, [load]);

  // Detect new episodes → in-app notification center + report newly-available
  // episodes to the server for closed-app push (with image). Both run in the
  // background so they never block the home feed.
  useEffect(() => {
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
    run();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") run();
    });
    return () => sub.remove();
  }, []);

  // Refresh history + unread badge when the tab regains focus
  useFocusEffect(useCallback(() => {
    getContinueWatching().then(setHistory);
    getUnreadCount().then(setUnread).catch(() => {});
  }, []));

  // Filter + order the section rails once per `sections` change, not on every
  // re-render (focus history/unread updates) — keeps unrelated state changes off
  // the work of rebuilding the rail list.
  const visibleSections = useMemo(
    () => sections
      .filter((s) => s.id !== "tv_series")
      .sort((a, b) => sectionRank(a.id) - sectionRank(b.id)),
    [sections],
  );

  if (loading) return <HomeSkeleton />;

  // Genuinely nothing to show after the retries were exhausted — give the user
  // a clear retry affordance instead of a near-blank page.
  if (featured.length === 0 && sections.length === 0 && history.length === 0) {
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
      {/* ── Top Bar (floating glass) ────────── */}
      <View style={[ss.topBar, { paddingTop: insets.top + 8 }]}>
        <LinearGradient
          colors={[C.bg, "rgba(10,10,11,0.85)", "transparent"]}
          style={StyleSheet.absoluteFill}
        />
        <View style={ss.topBarInner}>
          <View style={ss.logoRow}>
            <View style={ss.logoDot} />
            <Text style={ss.logoText}>Pantoufa</Text>
          </View>
          {/* Actions consolidated into one frosted segmented cluster — a single
              premium control instead of three scattered circles. Each segment
              keeps its own 44px hit target + handler. */}
          <View style={ss.actionCluster}>
            <GlassFill intensity={20} />
            <Pressable style={ss.clusterBtn} onPress={() => router.push("/schedule")} hitSlop={8}>
              <Ionicons name="calendar-outline" size={18} color={C.text} />
            </Pressable>
            <View style={ss.clusterDivider} />
            <Pressable style={ss.clusterBtn} onPress={() => router.push("/notifications")} hitSlop={8}>
              <Ionicons name={unread > 0 ? "notifications" : "notifications-outline"} size={18} color={unread > 0 ? C.accent : C.text} />
              {unread > 0 && (
                <View style={ss.notifBadge}>
                  <Text style={ss.notifBadgeText}>{unread > 9 ? "9+" : unread}</Text>
                </View>
              )}
            </Pressable>
            <View style={ss.clusterDivider} />
            <Pressable style={ss.clusterBtn} onPress={openSidebar} hitSlop={8}>
              <Ionicons name="menu" size={20} color={C.text} />
            </Pressable>
          </View>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        removeClippedSubviews
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
        {featured.length > 0 && <HeroCarousel featured={featured} />}

        {/* ── Resume shelf (Continue Watching) ───────────────
            Promoted onto a frosted panel that OVERLAPS the hero's lower edge —
            the privileged "get back to it" surface floating over the cinematic
            plate. Same data + handlers as before, new hierarchy. */}
        {history.length > 0 && (
          <View style={ss.shelf}>
            <GlassFill intensity={26} />
            <View style={ss.shelfHeader}>
              <View style={ss.sectionTitleRow}>
                <View style={ss.sectionTick} />
                <Text style={ss.sectionTitle}>{t.continueWatching}</Text>
              </View>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: PAD, gap: 14, paddingBottom: 2 }}
            >
              {history.slice(0, 10).map((entry) => (
                <ContinueCard
                  key={entry.episodeHref}
                  entry={entry}
                  onRemove={(href) => {
                    dismissFromContinue(href).then(() => getContinueWatching().then(setHistory));
                  }}
                />
              ))}
            </ScrollView>
          </View>
        )}

        {/* ── Sections ─────────────────────── */}
        {visibleSections.map((section, si) => {
          const MAX_PREVIEW = 15;
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
                  <View style={ss.sectionTick} />
                  <Text style={ss.sectionTitle}>{SECTION_LABELS[section.id] || section.title}</Text>
                </View>
                <Pressable style={ss.seeAllBtn} onPress={openAll}>
                  <Text style={ss.seeAllText}>{t.seeAll(section.items.length)}</Text>
                  <Ionicons name="chevron-back" size={12} color={C.textSecondary} />
                </Pressable>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: PAD, gap: 14 }}
              >
                {section.type === "anime"
                  ? (previewItems as AnimeItem[]).map((item, i) => (
                      <AnimeCardView key={item.href || i} item={item} index={i} />
                    ))
                  : (previewItems as EpisodeItem[]).map((item, i) => (
                      <EpisodeCardView key={item.href || i} item={item} onPress={openEpisodePopup} />
                    ))}
                {hasMore && (
                  <Pressable style={ss.seeAllCard} onPress={openAll}>
                    <View style={ss.seeAllCircle}>
                      <Ionicons name="arrow-back" size={20} color={C.accent} />
                    </View>
                    <Text style={ss.seeAllCardText}>{t.seeAllShort}</Text>
                  </Pressable>
                )}
              </ScrollView>
            </Rise>
          );
        })}

        {/* ── Source-direct rails (scraped from our own sources, no AniList) ── */}
        <SourceRail kind="season" title={t.railThisSeason} order={0} />
        <SourceRail kind="movies" title={t.railMovies} order={1} />

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
        <Pressable style={StyleSheet.absoluteFill} onPress={animateClose}>
          <Animated.View style={[StyleSheet.absoluteFill, ss.sheetBackdrop, { opacity: backdrop }]} />
        </Pressable>
        <View style={ss.sheetAnchor} pointerEvents="box-none">
          <Animated.View
            style={[ss.sheetPanel, { paddingBottom: insets.bottom + 16, transform: [{ translateY }] }]}
            onStartShouldSetResponder={() => true}
          >
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
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

/* ── Anime Card (cinematic) ──────────────────── */

const AnimeCardView = memo(function AnimeCardView({ item, index }: { item: AnimeItem; index: number }) {
  return (
    <PosterCard
      image={item.image}
      title={item.title}
      subtitle={item.type || undefined}
      onPress={() => router.push(`/anime/${encodeURIComponent(item.href)}`)}
      width={CARD_W}
      rank={index + 1}
      newBadge={item.isNew}
      recyclingKey={item.href}
      titleLines={1}
      topRight={<MalCardBadge title={item.title} />}
      bottomRight={<CompletionBadge hrefs={[item.href, ...Object.values(item.sourceHrefs || {})]} titles={[item.title]} />}
    />
  );
});

/* ── Episode Card (wide cinematic) ───────────── */

const EpisodeCardView = memo(function EpisodeCardView({ item, onPress }: { item: EpisodeItem; onPress: (item: EpisodeItem) => void }) {
  return (
    <Pressable
      onPress={() => onPress(item)}
      style={({ pressed }) => ({ width: EP_W, opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}
    >
      <View style={ss.epCard}>
        {item.image ? (
          <Image source={{ uri: item.image }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" recyclingKey={item.href} transition={200} />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: C.surface, alignItems: "center", justifyContent: "center" }]}>
            <Ionicons name="film-outline" size={24} color={C.textMuted} />
          </View>
        )}
        {item.isNew && (
          <View style={ss.newBadge}>
            <Text style={ss.badgeText}>{t.newBadge}</Text>
          </View>
        )}
        {/* Play button overlay */}
        <View style={ss.epPlayOverlay}>
          <View style={ss.epPlayBtn}>
            <Ionicons name="play" size={14} color="#fff" />
          </View>
        </View>
        <CompletionBadge hrefs={[item.animeHref]} titles={[item.animeTitle]} />
      </View>
      <Text style={ss.epTitle} numberOfLines={1}>{item.title}</Text>
      <Text style={ss.epSub} numberOfLines={1}>{item.animeTitle}</Text>
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
  return (
    <Pressable
      onPress={() => {
        const params: Record<string, string> = {};
        if (entry.url4up) params.url4up = encodeURIComponent(entry.url4up);
        if (entry.image) params.img = encodeURIComponent(entry.image);
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
          <Image source={{ uri: entry.image }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" recyclingKey={entry.episodeHref} transition={200} />
        ) : (
          <LinearGradient
            colors={[C.surface, C.surfaceLight]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        )}
        <View style={ss.epPlayOverlay}>
          <View style={ss.epPlayBtn}>
            <Ionicons name="play" size={14} color="#fff" />
          </View>
        </View>
        {/* Episode number badge */}
        {epNum !== null && (
          <View style={ss.epNumBadge}>
            <Text style={ss.epNumBadgeText}>{epNum}</Text>
          </View>
        )}
        {/* Time remaining badge */}
        <View style={ss.timeBadge}>
          <Text style={ss.timeBadgeText}>{t.minLeft(remainMin)}</Text>
        </View>
        {/* Delete button */}
        <Pressable
          onPress={(e) => { e.stopPropagation?.(); onRemove(entry.episodeHref); }}
          style={ss.deleteBtn}
          hitSlop={6}
        >
          <Ionicons name="close" size={12} color={C.white} />
        </Pressable>
        {/* Progress bar */}
        <View style={ss.progressBarBg}>
          <View style={[ss.progressBarFill, { width: `${Math.round(pct * 100)}%` }]} />
        </View>
      </View>
      <Text style={ss.epTitle} numberOfLines={1}>{entry.episodeTitle || entry.animeTitle}</Text>
      <Text style={ss.epSub} numberOfLines={1}>{entry.animeTitle}</Text>
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
          <View style={ss.logoRow}>
            <View style={ss.logoDot} />
            <Text style={ss.logoText}>Pantoufa</Text>
          </View>
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
      <Shimmer style={{ width: SW, height: HERO_H }} borderRadius={0} />
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
    position: "absolute", top: 0, left: 0, right: 0, zIndex: 50,
  },
  topBarInner: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: PAD, paddingBottom: 12,
  },
  logoRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  // Editorial masthead: bone wordmark led by an ember spark mark.
  logoDot: {
    width: 7, height: 7, borderRadius: 1.5, backgroundColor: C.ember,
  },
  logoText: {
    ...T.display, fontSize: 23, letterSpacing: -0.9,
    color: C.bone,
  },
  // Standalone glass button — used by HomeEmpty's single menu control. 44px floor.
  glassBtn: {
    width: 44, height: 44, borderRadius: R.circle, overflow: "hidden",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: C.glassBorder,
  },
  // Frosted segmented action cluster — one connected control, three 44px segments.
  actionCluster: {
    flexDirection: "row", alignItems: "center", height: 44,
    borderRadius: R.circle, overflow: "hidden",
    borderWidth: 1, borderColor: C.glassBorder,
  },
  clusterBtn: {
    width: 44, height: 44, alignItems: "center", justifyContent: "center",
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

  // Hero
  heroSlide: { width: SW, height: HERO_H, backgroundColor: C.surface },
  meshBg: { ...StyleSheet.absoluteFillObject },
  heroContent: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    paddingHorizontal: PAD, paddingBottom: 58, gap: 14,
  },
  // Segmented position indicator — pinned to the hero's bottom-center, in the
  // lower padding zone below the CTAs (replaces the old dots).
  heroTrack: {
    position: "absolute", bottom: 18, left: 0, right: 0,
    flexDirection: "row", justifyContent: "center", gap: 6,
  },
  seg: { width: 16, height: 3, borderRadius: 2, backgroundColor: C.controlDim },
  segActive: { width: 28, backgroundColor: C.accent },
  chipRow: { flexDirection: "row", gap: 7 },
  // Editorial outline tags — hairline border, no fill.
  chip: {
    paddingHorizontal: 11, paddingVertical: 4, borderRadius: R.sm, overflow: "hidden",
    borderWidth: 1, borderColor: C.borderLight,
  },
  chipText: { color: C.textSecondary, fontSize: 10.5, fontWeight: "600", letterSpacing: 0.3, fontFamily: "Cairo_600SemiBold" },
  heroTitle: {
    ...TAr.display, fontSize: 36, lineHeight: 40,
    color: C.bone,
  },
  heroDesc: {
    ...TAr.body, color: C.textSecondary, maxWidth: 320,
  },
  heroButtons: { flexDirection: "row", gap: 10, marginTop: 6 },
  btnPrimaryWrap: {
    flex: 1, borderRadius: R.pill,
    ...ELEVATION_GLOW,
  },
  btnPrimaryGrad: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 15, borderRadius: R.pill, overflow: "hidden",
  },
  btnPrimaryText: { color: C.textOnAccent, fontSize: 14, fontWeight: "700", fontFamily: "Cairo_700Bold" },
  // Editorial ghost — hairline outline, bone label (no frosted glass).
  btnGlass: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    borderRadius: R.pill, paddingVertical: 15,
    backgroundColor: "transparent", borderWidth: 1, borderColor: C.borderLight,
  },
  btnGlassText: { color: C.bone, fontSize: 14, fontWeight: "600", fontFamily: "Cairo_600SemiBold" },

  // Resume shelf — frosted panel that sits cleanly below the hero (a small gap
  // keeps its rounded top reading as a distinct floating surface, not fused to
  // the hero art above it).
  shelf: {
    marginTop: S.md,
    borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl,
    overflow: "hidden", paddingTop: 18, paddingBottom: 16,
    borderTopWidth: 1, borderColor: C.glassBorder,
    ...ELEVATION_NAV,
  },
  shelfHeader: {
    paddingHorizontal: PAD, marginBottom: 14,
  },

  // Sections
  section: { marginTop: S.xxl },
  sectionHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: PAD, marginBottom: 14,
  },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  // Editorial marginal rule — a crisp ember stroke leading the title.
  sectionTick: {
    width: 3, height: 20, borderRadius: 0, backgroundColor: C.ember,
  },
  sectionTitle: {
    ...TAr.h2, color: C.bone,
  },
  // "See all" stays ash — ember is reserved for the primary action.
  seeAllBtn: { flexDirection: "row", alignItems: "center", gap: 3 },
  seeAllText: { color: C.textSecondary, fontSize: 11, fontWeight: "600", fontFamily: "Cairo_600SemiBold" },

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

  // Progress bar (continue watching)
  progressBarBg: {
    position: "absolute", bottom: 0, left: 0, right: 0, height: 3,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  progressBarFill: {
    height: 3, backgroundColor: C.accent,
    borderRadius: 2,
  },
  timeBadge: {
    position: "absolute", bottom: 8, left: 8,
    backgroundColor: "rgba(0,0,0,0.7)", borderRadius: 4,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  timeBadgeText: {
    color: C.white, fontSize: 9, fontWeight: "600", fontFamily: "Cairo_600SemiBold",
  },
  deleteBtn: {
    position: "absolute", top: 6, right: 6,
    width: 28, height: 28, borderRadius: R.circle,
    backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center",
  },

  // Badges (used by EpisodeCardView + ContinueCard)
  newBadge: {
    position: "absolute", top: 8, left: 8, zIndex: 2,
    backgroundColor: C.ember, borderRadius: R.xs, paddingHorizontal: 7, paddingVertical: 3,
  },
  badgeText: {
    color: C.textOnAccent, fontSize: 9, fontWeight: "700", letterSpacing: 0.8,
    fontFamily: "Outfit_700Bold",
  },
  epNumBadge: {
    position: "absolute", top: 8, left: 8, zIndex: 2,
    backgroundColor: C.ember, borderRadius: R.sm,
    paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.2)",
  },
  epNumBadgeText: {
    color: "#ffffff", fontSize: 10, fontWeight: "800", fontFamily: "Outfit_800ExtraBold", letterSpacing: 0.5,
  },

  // Episode cards
  epCard: {
    width: EP_W, height: EP_H, borderRadius: R.lg, overflow: "hidden",
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    ...ELEVATION_CARD,
  },
  epPlayOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center", justifyContent: "center",
    // Light veil only — the accent play button carries its own contrast now,
    // so the artwork stays bright instead of living under a permanent dim.
    backgroundColor: "rgba(0,0,0,0.15)",
  },
  epPlayBtn: {
    width: 38, height: 38, borderRadius: R.circle,
    backgroundColor: C.ember,
    alignItems: "center", justifyContent: "center",
    ...ELEVATION_GLOW,
  },
  epTitle: {
    color: C.text, fontSize: 11, fontWeight: "600", lineHeight: 14,
    marginTop: 8, width: EP_W, fontFamily: "Cairo_600SemiBold",
  },
  epSub: {
    color: C.textMuted, fontSize: 10, lineHeight: 13, marginTop: 2, width: EP_W,
    fontFamily: "Cairo_500Medium",
  },

  // Episode action bottom sheet
  sheetBackdrop: { backgroundColor: "rgba(0,0,0,0.72)" },
  sheetAnchor: { flex: 1, justifyContent: "flex-end" },
  sheetPanel: {
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

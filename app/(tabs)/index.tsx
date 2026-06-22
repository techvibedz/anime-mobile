import { useEffect, useState, useCallback, useRef, memo } from "react";
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
import { C, S, R, ELEVATION_CARD, ELEVATION_GLOW } from "../../lib/theme";
import { t } from "../../lib/i18n";

const { width: SW } = Dimensions.get("window");
const HERO_H = 440;
const CARD_W = 140;
const CARD_H = 200;
const EP_W = 200;
const EP_H = 112;
const PAD = S.paddingContent;

const CATEGORIES = [
  { name: "Action", label: "أكشن", icon: "flash", colors: [C.accent, "#FF6B3D"] as [string, string] },
  { name: "Romance", label: "رومانسي", icon: "heart", colors: ["#FF6B9D", C.accent] as [string, string] },
  { name: "Comedy", label: "كوميدي", icon: "happy", colors: ["#FFB800", "#FF8C00"] as [string, string] },
  { name: "Fantasy", label: "خيال", icon: "sparkles", colors: [C.violet, "#9B6BFF"] as [string, string] },
  { name: "Horror", label: "رعب", icon: "skull", colors: ["#6B2D5B", "#FF2D55"] as [string, string] },
  { name: "Sci-Fi", label: "خيال علمي", icon: "planet", colors: ["#00C6FF", C.violet] as [string, string] },
  { name: "Drama", label: "دراما", icon: "sad", colors: ["#667EEA", "#764BA2"] as [string, string] },
  { name: "Adventure", label: "مغامرة", icon: "compass", colors: ["#11998E", "#38EF7D"] as [string, string] },
];

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

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { openSidebar } = useSidebar();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [featured, setFeatured] = useState<FeaturedItem[]>([]);
  const [sections, setSections] = useState<HomeSection[]>([]);
  const [history, setHistory] = useState<WatchEntry[]>([]);
  const [unread, setUnread] = useState(0);

  const heroRef = useRef<ScrollView>(null);
  const [heroIndex, setHeroIndex] = useState(0);
  const heroTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cold-start resilience: the first scrape can come back empty while the
  // WebView is still warming up / clearing Cloudflare. Instead of dropping the
  // user on a blank home, keep the skeleton up and retry a few times.
  const emptyRetry = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasContent = useRef(false);
  const MAX_EMPTY_RETRIES = 5;

  // Popup shown when tapping an episode card — choose Watch vs Anime page
  const [episodePopup, setEpisodePopup] = useState<EpisodeItem | null>(null);
  const openEpisodePopup = useCallback((ep: EpisodeItem) => setEpisodePopup(ep), []);
  const closeEpisodePopup = useCallback(() => setEpisodePopup(null), []);

  const load = useCallback(async () => {
    try {
      const [res, hist] = await Promise.all([fetchHome(), getContinueWatching()]);
      setHistory(hist);
      const feat = res?.success ? (res.data.featured ?? []) : [];
      const secs = res?.success ? (res.data.sections ?? []) : [];
      const gotContent = feat.length > 0 || secs.length > 0;
      if (gotContent) {
        setFeatured(feat);
        setSections(secs);
        hasContent.current = true;
        emptyRetry.current = 0;
      } else if (!hasContent.current && emptyRetry.current < MAX_EMPTY_RETRIES) {
        // Empty scrape and nothing on screen yet — likely a cold WebView or an
        // un-cleared Cloudflare challenge. Keep the skeleton and retry shortly.
        emptyRetry.current += 1;
        retryTimer.current = setTimeout(() => { void load(); }, 3000);
        return; // don't drop out of the loading state
      }
    } catch (e) {
      console.error("Home load failed:", e);
      if (!hasContent.current && emptyRetry.current < MAX_EMPTY_RETRIES) {
        emptyRetry.current += 1;
        retryTimer.current = setTimeout(() => { void load(); }, 3000);
        return;
      }
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  // Manual refresh / retry: clear the cold-start counters so a user-initiated
  // reload gets a fresh batch of attempts.
  const reload = useCallback(() => {
    emptyRetry.current = 0;
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
    syncEpisodeNotifications()
      .then(() => getUnreadCount())
      .then(setUnread)
      .catch(() => {});
    reportRecentEpisodes().catch(() => {});
  }, []);

  // Refresh history + unread badge when the tab regains focus
  useFocusEffect(useCallback(() => {
    getContinueWatching().then(setHistory);
    getUnreadCount().then(setUnread).catch(() => {});
  }, []));

  useEffect(() => {
    if (featured.length <= 1) return;
    heroTimer.current = setInterval(() => {
      setHeroIndex((prev) => {
        const next = (prev + 1) % featured.length;
        heroRef.current?.scrollTo({ x: next * SW, animated: true });
        return next;
      });
    }, 5000);
    return () => { if (heroTimer.current) clearInterval(heroTimer.current); };
  }, [featured.length]);

  function onHeroScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const idx = Math.round(e.nativeEvent.contentOffset.x / SW);
    if (idx !== heroIndex) setHeroIndex(idx);
  }

  function resetAutoScroll() {
    if (heroTimer.current) clearInterval(heroTimer.current);
    heroTimer.current = setInterval(() => {
      setHeroIndex((prev) => {
        const next = (prev + 1) % featured.length;
        heroRef.current?.scrollTo({ x: next * SW, animated: true });
        return next;
      });
    }, 5000);
  }

  if (loading) return <HomeSkeleton />;

  // Genuinely nothing to show after the retries were exhausted — give the user
  // a clear retry affordance instead of a near-blank page.
  if (featured.length === 0 && sections.length === 0 && history.length === 0) {
    return (
      <HomeEmpty
        insets={insets}
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
          colors={[C.bg, "rgba(6,7,26,0.85)", "transparent"]}
          style={StyleSheet.absoluteFill}
        />
        <View style={ss.topBarInner}>
          <View style={ss.logoRow}>
            <View style={ss.logoDot} />
            <Text style={ss.logoText}>Pantoufa</Text>
          </View>
          <View style={ss.topBarActions}>
            <Pressable onPress={() => router.push("/schedule")} hitSlop={8}>
              <View style={ss.glassBtn}>
                <GlassFill intensity={20} />
                <Ionicons name="calendar-outline" size={18} color={C.text} />
              </View>
            </Pressable>

            <Pressable onPress={() => router.push("/notifications")} hitSlop={8}>
              <View>
                <View style={ss.glassBtn}>
                  <GlassFill intensity={20} />
                  <Ionicons name={unread > 0 ? "notifications" : "notifications-outline"} size={18} color={unread > 0 ? C.accent : C.text} />
                </View>
                {unread > 0 && (
                  <View style={ss.notifBadge}>
                    <Text style={ss.notifBadgeText}>{unread > 9 ? "9+" : unread}</Text>
                  </View>
                )}
              </View>
            </Pressable>

            <Pressable onPress={openSidebar} hitSlop={8}>
              <View style={ss.glassBtn}>
                <GlassFill intensity={20} />
                <Ionicons name="menu" size={20} color={C.text} />
              </View>
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
        {/* ── Hero Carousel ────────────────── */}
        {featured.length > 0 && (
          <View>
            <ScrollView
              ref={heroRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => { onHeroScroll(e); resetAutoScroll(); }}
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
                    <Image source={{ uri: item.image }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" recyclingKey={item.href} transition={200} />
                  )}
                  {/* Protection gradient */}
                  <LinearGradient
                    colors={["transparent", "rgba(6,7,26,0.3)", "rgba(6,7,26,0.85)", C.bg]}
                    locations={[0, 0.4, 0.7, 1]}
                    style={StyleSheet.absoluteFill}
                  />
                  {/* Hero content */}
                  <View style={ss.heroContent}>
                    {/* Genre chips */}
                    <View style={ss.chipRow}>
                      {item.genres.slice(0, 3).map((g, gi) => (
                        <View key={gi} style={ss.chip}>
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
                        style={ss.btnPrimary}
                        onPress={() => {
                          if (!item.href) return;
                          if (item.href.includes("/episode/")) {
                            const animeUrl = toAnimeUrl(item.href);
                            router.push({
                              pathname: `/watch/${encodeURIComponent(item.href)}`,
                              params: animeUrl ? { anime: animeUrl } : {},
                            });
                          } else {
                            router.push(`/anime/${encodeURIComponent(item.href)}`);
                          }
                        }}
                      >
                        <Ionicons name="play" size={16} color={C.textOnAccent} />
                        <Text style={ss.btnPrimaryText}>{t.watchNow}</Text>
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
            {/* Dot pagination */}
            {featured.length > 1 && (
              <View style={ss.dots}>
                {featured.map((_, i) => (
                  <View key={i} style={[ss.dot, i === heroIndex && ss.dotActive]} />
                ))}
              </View>
            )}
            {/* Accent glow line */}
            <View style={ss.glowLine} />
          </View>
        )}

        {/* ── Continue Watching ─────────────── */}
        {history.length > 0 && (
          <View style={ss.section}>
            <View style={ss.sectionHeader}>
              <View style={ss.sectionTitleRow}>
                <View style={ss.sectionTick} />
                <Text style={ss.sectionTitle}>{t.continueWatching}</Text>
              </View>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: PAD, gap: 14 }}
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
        {sections
          .filter(s => s.id !== "tv_series")
          .sort((a, b) => sectionRank(a.id) - sectionRank(b.id))
          .map((section, si) => {
          const MAX_PREVIEW = 15;
          const previewItems = section.items.slice(0, MAX_PREVIEW);
          const hasMore = section.items.length > MAX_PREVIEW;
          return (
            <View key={section.id} style={ss.section}>
              <View style={ss.sectionHeader}>
                <View style={ss.sectionTitleRow}>
                  <View style={ss.sectionTick} />
                  <Text style={ss.sectionTitle}>{SECTION_LABELS[section.id] || section.title}</Text>
                </View>
                <Pressable
                  style={ss.seeAllBtn}
                  onPress={() => {
                    const localized = SECTION_LABELS[section.id] || section.title;
                    router.push(`/see-all/${encodeURIComponent(section.id)}?title=${encodeURIComponent(localized)}&type=${section.type}`);
                  }}
                >
                  <Text style={ss.seeAllText}>{t.seeAll(section.items.length)}</Text>
                  <Ionicons name="chevron-back" size={12} color={C.accent} />
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
                  <Pressable
                    style={ss.seeAllCard}
                    onPress={() => {
                      const localized = SECTION_LABELS[section.id] || section.title;
                      router.push(`/see-all/${encodeURIComponent(section.id)}?title=${encodeURIComponent(localized)}&type=${section.type}`);
                    }}
                  >
                    <View style={ss.seeAllCircle}>
                      <Ionicons name="arrow-back" size={20} color={C.accent} />
                    </View>
                    <Text style={ss.seeAllCardText}>{t.seeAllShort}</Text>
                  </Pressable>
                )}
              </ScrollView>
            </View>
          );
        })}

        {/* ── Source-direct rails (scraped from our own sources, no AniList) ── */}
        <SourceRail kind="season" title={t.railThisSeason} order={0} />
        <SourceRail kind="movies" title={t.railMovies} order={1} />

        {/* ── Categories ──────────────────────── */}
        <View style={ss.section}>
          <View style={ss.sectionHeader}>
            <View style={ss.sectionTitleRow}>
              <View style={ss.sectionTick} />
              <Text style={ss.sectionTitle}>{t.categories}</Text>
            </View>
          </View>
          <View style={ss.catGrid}>
            {CATEGORIES.map((cat) => (
              <Pressable
                key={cat.name}
                style={({ pressed }) => [ss.catCard, { opacity: pressed ? 0.8 : 1 }]}
                onPress={() => router.push(`/(tabs)/search?genre=${encodeURIComponent(cat.name)}`)}
              >
                <LinearGradient
                  colors={cat.colors}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={ss.catGrad}
                >
                  <Ionicons name={cat.icon as any} size={20} color="rgba(255,255,255,0.7)" />
                  <Text style={ss.catName}>{cat.label}</Text>
                </LinearGradient>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Banner ad at the end of the feed (no-op until configured) */}
        <AdBanner style={{ marginTop: S.xxl }} />

        <View style={{ height: insets.bottom + 100 }} />
      </ScrollView>

      {/* Episode tap popup — watch directly or open anime page */}
      <EpisodeActionModal episode={episodePopup} onClose={closeEpisodePopup} />
    </View>
  );
}

/* ── Episode tap modal ──────────────────────── */

function EpisodeActionModal({ episode, onClose }: { episode: EpisodeItem | null; onClose: () => void }) {
  if (!episode) return null;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <Pressable style={ss.modalBackdrop} onPress={onClose}>
        <Pressable style={ss.modalSheet} onPress={() => {}}>
          {episode.image ? (
            <Image source={{ uri: episode.image }} style={ss.modalImage} contentFit="cover" />
          ) : (
            <View style={[ss.modalImage, { backgroundColor: C.surface, alignItems: "center", justifyContent: "center" }]}>
              <Ionicons name="film-outline" size={32} color={C.textMuted} />
            </View>
          )}
          <Text style={ss.modalTitle} numberOfLines={2}>{episode.title}</Text>
          {episode.animeTitle ? <Text style={ss.modalSub} numberOfLines={1}>{episode.animeTitle}</Text> : null}

          <Pressable
            style={ss.modalBtnPrimary}
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
              router.push({
                pathname: `/watch/${encodeURIComponent(episode.href)}`,
                params,
              });
            }}
          >
            <Ionicons name="play" size={16} color={C.textOnAccent} />
            <Text style={ss.modalBtnPrimaryText}>{t.watchEpisode}</Text>
          </Pressable>

          <Pressable
            style={ss.modalBtnSecondary}
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
            <Text style={ss.modalBtnSecondaryText}>{t.openAnimePage}</Text>
          </Pressable>

          <Pressable style={ss.modalCancel} onPress={onClose}>
            <Text style={ss.modalCancelText}>{t.cancel}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* ── Anime Card (cinematic) ──────────────────── */

const AnimeCardView = memo(function AnimeCardView({ item, index }: { item: AnimeItem; index: number }) {
  return (
    <Pressable
      onPress={() => router.push(`/anime/${encodeURIComponent(item.href)}`)}
      style={({ pressed }) => ({ width: CARD_W, opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}
    >
      <View style={ss.card}>
        {item.image ? (
          <Image source={{ uri: item.image }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" recyclingKey={item.href} transition={200} />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: C.surface, alignItems: "center", justifyContent: "center" }]}>
            <Ionicons name="image-outline" size={28} color={C.textMuted} />
          </View>
        )}
        {item.isNew && (
          <View style={ss.newBadge}>
            <Text style={ss.badgeText}>{t.newBadge}</Text>
          </View>
        )}
        <MalCardBadge title={item.title} />
        <LinearGradient colors={["transparent", "rgba(6,7,26,0.95)"]} style={ss.cardGrad} />
        {/* Rank number with accent stroke effect */}
        <Text style={ss.cardRank}>{index + 1}</Text>
        <CompletionBadge hrefs={[item.href, ...Object.values(item.sourceHrefs || {})]} titles={[item.title]} />
      </View>
      <Text style={ss.cardTitle} numberOfLines={1}>{item.title}</Text>
      {item.type && <Text style={ss.cardType}>{item.type}</Text>}
    </Pressable>
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
          <LinearGradient
            colors={[C.accent, C.violet]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={ss.epPlayBtn}
          >
            <Ionicons name="play" size={14} color="#fff" />
          </LinearGradient>
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
  const arMatch = title.match(/الحلقة[\s\-_]*([\u0660-\u0669]+)/);
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
          <LinearGradient
            colors={[C.accent, C.violet]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={ss.epPlayBtn}
          >
            <Ionicons name="play" size={14} color="#fff" />
          </LinearGradient>
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
  insets, onRetry, onMenu,
}: {
  insets: { top: number; bottom: number };
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
      <View style={ss.emptyWrap}>
        <View style={ss.emptyIcon}>
          <Ionicons name="cloud-offline-outline" size={40} color={C.accent} />
        </View>
        <Text style={ss.emptyTitle}>{t.homeEmptyTitle}</Text>
        <Text style={ss.emptyDesc}>{t.homeEmptySub}</Text>
        <Pressable style={ss.emptyBtn} onPress={onRetry}>
          <Ionicons name="refresh" size={16} color={C.textOnAccent} />
          <Text style={ss.emptyBtnText}>{t.retry}</Text>
        </Pressable>
      </View>
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

  // Empty / error state
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40, gap: 14 },
  emptyIcon: {
    width: 88, height: 88, borderRadius: R.circle,
    backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.borderAccent,
    alignItems: "center", justifyContent: "center", marginBottom: 6,
  },
  emptyTitle: {
    color: C.text, fontSize: 19, fontWeight: "800", fontFamily: "Cairo_700Bold", textAlign: "center",
  },
  emptyDesc: {
    color: C.textSecondary, fontSize: 14, lineHeight: 21, textAlign: "center",
    fontFamily: "Cairo_500Medium",
  },
  emptyBtn: {
    flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8,
    backgroundColor: C.accent, borderRadius: R.pill, paddingVertical: 13, paddingHorizontal: 28,
    ...ELEVATION_GLOW,
  },
  emptyBtnText: { color: C.textOnAccent, fontSize: 14, fontWeight: "700", fontFamily: "Cairo_700Bold" },

  // Top bar
  topBar: {
    position: "absolute", top: 0, left: 0, right: 0, zIndex: 50,
  },
  topBarInner: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: PAD, paddingBottom: 12,
  },
  logoRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  logoDot: {
    width: 8, height: 8, borderRadius: 2, backgroundColor: C.accent,
    shadowColor: C.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 8,
  },
  logoText: {
    fontSize: 24, fontWeight: "800", color: C.accent, letterSpacing: -0.7,
    fontFamily: "Outfit_800ExtraBold",
  },
  glassBtn: {
    width: 36, height: 36, borderRadius: R.circle, overflow: "hidden",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: C.glassBorder,
  },
  topBarActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  notifBadge: {
    position: "absolute", top: -3, right: -3,
    minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4,
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
    paddingHorizontal: PAD, paddingBottom: 44, gap: 14,
  },
  chipRow: { flexDirection: "row", gap: 6 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: R.pill,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
  },
  chipText: { color: C.textSecondary, fontSize: 11, fontWeight: "600", fontFamily: "Cairo_600SemiBold" },
  heroTitle: {
    color: C.text, fontSize: 32, fontWeight: "800", lineHeight: 36, letterSpacing: -0.6,
    fontFamily: "Cairo_700Bold",
  },
  heroDesc: {
    color: C.textSecondary, fontSize: 14, lineHeight: 22, fontFamily: "Cairo_500Medium",
    maxWidth: 300,
  },
  heroButtons: { flexDirection: "row", gap: 10, marginTop: 4 },
  btnPrimary: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: C.accent, borderRadius: R.pill, paddingVertical: 14,
    ...ELEVATION_GLOW,
  },
  btnPrimaryText: { color: C.textOnAccent, fontSize: 14, fontWeight: "600", fontFamily: "Cairo_600SemiBold" },
  btnGlass: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    borderRadius: R.pill, paddingVertical: 14,
    backgroundColor: C.surfaceGlass, borderWidth: 1, borderColor: C.glassBorder,
  },
  btnGlassText: { color: C.text, fontSize: 14, fontWeight: "600", fontFamily: "Cairo_600SemiBold" },

  // Dots
  dots: {
    position: "absolute", bottom: 16, left: 0, right: 0,
    flexDirection: "row", justifyContent: "center", gap: 6,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.2)" },
  dotActive: {
    width: 24, backgroundColor: C.accent,
    shadowColor: C.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 8,
  },

  // Glow line
  glowLine: {
    height: 1, marginHorizontal: "10%",
    backgroundColor: C.glowLine,
    shadowColor: C.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 8,
  },

  // Sections
  section: { marginTop: S.xxl },
  sectionHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: PAD, marginBottom: 14,
  },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  sectionTick: {
    width: 4, height: 18, borderRadius: 2, backgroundColor: C.accent,
    shadowColor: C.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 8,
  },
  sectionTitle: {
    color: C.text, fontSize: 20, fontWeight: "700", fontFamily: "Cairo_700Bold",
  },
  seeAllBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  seeAllText: { color: C.accent, fontSize: 11, fontWeight: "600", fontFamily: "Cairo_600SemiBold" },

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

  // Categories grid
  catGrid: {
    flexDirection: "row", flexWrap: "wrap", gap: 10,
    paddingHorizontal: PAD,
  },
  catCard: {
    width: (SW - PAD * 2 - 10) / 2, height: 64, borderRadius: R.lg, overflow: "hidden",
  },
  catGrad: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 16,
  },
  catName: {
    color: "#fff", fontSize: 14, fontWeight: "700", fontFamily: "Cairo_700Bold",
  },

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
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center",
  },

  // Anime cards
  card: {
    width: CARD_W, height: CARD_H, borderRadius: R.lg, overflow: "hidden",
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    ...ELEVATION_CARD,
  },
  cardGrad: { position: "absolute", bottom: 0, left: 0, right: 0, height: 80 },
  cardRank: {
    position: "absolute", bottom: -8, left: -4,
    fontSize: 48, fontWeight: "900", lineHeight: 48, letterSpacing: -1.5,
    color: "#ffffff", fontFamily: "Outfit_900Black",
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
    opacity: 0.95,
  },
  cardTitle: {
    color: C.text, fontSize: 11, fontWeight: "600", lineHeight: 14,
    marginTop: 10, width: CARD_W, fontFamily: "Cairo_600SemiBold",
  },
  cardType: {
    color: C.textMuted, fontSize: 10, lineHeight: 13, marginTop: 3, width: CARD_W,
    fontFamily: "Cairo_500Medium",
  },

  // Badges
  newBadge: {
    position: "absolute", top: 8, left: 8, zIndex: 2,
    backgroundColor: C.accent, borderRadius: R.xs, paddingHorizontal: 7, paddingVertical: 3,
    shadowColor: C.accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5, shadowRadius: 12,
  },
  badgeText: {
    color: C.textOnAccent, fontSize: 9, fontWeight: "700", letterSpacing: 0.8,
    fontFamily: "Outfit_700Bold",
  },
  epNumBadge: {
    position: "absolute", top: 8, left: 8, zIndex: 2,
    backgroundColor: C.accent, borderRadius: R.sm,
    paddingHorizontal: 8, paddingVertical: 4,
    shadowColor: C.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.2)",
  },
  epNumBadgeText: {
    color: "#ffffff", fontSize: 10, fontWeight: "800", fontFamily: "Outfit_800ExtraBold", letterSpacing: 0.5,
  },
  ratingBadge: {
    position: "absolute", top: 8, right: 8, zIndex: 2,
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: C.surfaceGlass, borderRadius: R.sm,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: C.glassBorder,
  },
  ratingText: { color: C.text, fontSize: 10, fontWeight: "700", fontFamily: "Outfit_700Bold" },

  // Episode cards
  epCard: {
    width: EP_W, height: EP_H, borderRadius: R.lg, overflow: "hidden",
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    ...ELEVATION_CARD,
  },
  epPlayOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.3)",
  },
  epPlayBtn: {
    width: 36, height: 36, borderRadius: R.circle,
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

  // Episode action modal
  modalBackdrop: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.75)",
    alignItems: "center", justifyContent: "center", padding: 24,
  },
  modalSheet: {
    width: "100%", maxWidth: 360,
    backgroundColor: C.bg, borderRadius: R.xl, padding: 20,
    borderWidth: 1, borderColor: C.border,
    alignItems: "stretch", gap: 10,
  },
  modalImage: {
    width: "100%", aspectRatio: 16 / 9, borderRadius: R.lg,
    backgroundColor: C.surface, marginBottom: 4,
  },
  modalTitle: {
    color: C.text, fontSize: 16, fontWeight: "700",
    fontFamily: "Cairo_700Bold", textAlign: "center",
  },
  modalSub: {
    color: C.textMuted, fontSize: 12, textAlign: "center",
    fontFamily: "Cairo_500Medium", marginBottom: 6,
  },
  modalBtnPrimary: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: C.accent, paddingVertical: 12, borderRadius: R.pill,
  },
  modalBtnPrimaryText: {
    color: C.textOnAccent, fontSize: 14, fontWeight: "700", fontFamily: "Cairo_600SemiBold",
  },
  modalBtnSecondary: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    paddingVertical: 12, borderRadius: R.pill,
  },
  modalBtnSecondaryText: {
    color: C.text, fontSize: 14, fontWeight: "700", fontFamily: "Cairo_600SemiBold",
  },
  modalCancel: { paddingVertical: 10, alignItems: "center" },
  modalCancelText: {
    color: C.textMuted, fontSize: 13, fontWeight: "600", fontFamily: "Cairo_500Medium",
  },
});

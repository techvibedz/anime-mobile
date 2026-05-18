import { useEffect, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Dimensions,
  StyleSheet,
  Modal,
  I18nManager,
} from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, router, useFocusEffect } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { fetchEpisodes } from "../../lib/api";
import type { AnimeDetail, RelatedAnime, Episode } from "../../lib/api";
import { addFavorite, removeFavorite, favoriteListOf } from "../../lib/favorites";
import type { FavoriteList } from "../../lib/favorites";
import { getWatchedHrefsForAnime, toggleWatched } from "../../lib/history";
import { Shimmer } from "../../components/Shimmer";
import { C, R, S, ELEVATION_CARD, ELEVATION_GLOW } from "../../lib/theme";
import { t } from "../../lib/i18n";

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
  const [merged, setMerged] = useState<{ anime4up: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [synopsisOpen, setSynopsisOpen] = useState(false);
  const [bookmarkList, setBookmarkList] = useState<FavoriteList | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("episodes");
  const [watchedHrefs, setWatchedHrefs] = useState<Set<string>>(new Set());
  const bookmarked = bookmarkList !== null;
  const animeHref = id ? decodeURIComponent(id) : "";

  useEffect(() => {
    if (!id) return;
    const url = decodeURIComponent(id);
    favoriteListOf(url).then(setBookmarkList);
    (async () => {
      try {
        const res = await fetchEpisodes(url);
        if (res.success) {
          setData(res.data);
          setEpisodes4up(res.data.episodes4up || []);
          setMerged(res.data.merged || null);
        }
        else setError(t.failedToLoad);
      } catch (e: any) {
        setError(e.message ?? t.failedToLoad);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  // Refresh watched flags when the screen regains focus (e.g. after watching).
  useFocusEffect(useCallback(() => {
    if (!animeHref) return;
    getWatchedHrefsForAnime(animeHref).then(setWatchedHrefs);
  }, [animeHref]));

  const handleToggleWatched = useCallback(async (ep: Episode) => {
    if (!data || !ep.href) return;
    const next = await toggleWatched(ep.href, {
      episodeTitle: ep.title || `${t.episode} ${ep.number}`,
      animeTitle: data.title,
      animeHref,
      image: data.poster,
    });
    setWatchedHrefs((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(ep.href!); else copy.delete(ep.href!);
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
    ...(data.relatedAnime.length > 0 ? [{ key: "related" as TabKey, label: t.tabRelated }] : []),
    { key: "info", label: t.tabInfo },
  ];

  return (
    <View style={ss.root}>
      <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
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
          <Text style={ss.title}>{data.title}</Text>

          {/* Quick meta */}
          <View style={ss.quickMeta}>
            {data.rating && (
              <View style={ss.ratingPill}>
                <Ionicons name="star" size={12} color={C.gold} />
                <Text style={ss.ratingText}>{data.rating}</Text>
              </View>
            )}
            {data.genres.slice(0, 3).map((g, i) => (
              <View key={i} style={ss.chip}>
                <Text style={ss.chipText}>{g}</Text>
              </View>
            ))}
          </View>

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
              merged={merged}
              poster={data.poster}
              watchedHrefs={watchedHrefs}
              onToggleWatched={handleToggleWatched}
            />
          )}
          {activeTab === "related" && <RelatedTab items={data.relatedAnime} />}
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
              <View style={[ss.pickerIcon, { backgroundColor: C.green + "22" }]}>
                <Ionicons name="play-circle" size={22} color={C.green} />
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
        <BlurView intensity={16} tint="dark" style={StyleSheet.absoluteFill}>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: C.surfaceGlass }]} />
        </BlurView>
        <Ionicons name={icon as any} size={20} color={color} />
      </View>
    </Pressable>
  );
}

/* ── Tab: Episodes ──────────────────────────── */

function EpisodesTab({
  episodes,
  episodes4up,
  merged,
  poster,
  watchedHrefs,
  onToggleWatched,
}: {
  episodes: AnimeDetail["episodes"];
  episodes4up: Episode[];
  merged: { anime4up: string } | null;
  poster: string;
  watchedHrefs: Set<string>;
  onToggleWatched: (ep: Episode) => void;
}) {
  const [sortDesc, setSortDesc] = useState(true); // true = newest first

  const mergedEps = episodes.map((ep) => {
    const match = episodes4up.find((e) => e.number === ep.number);
    return { ...ep, href4up: match?.href || null };
  });

  const sorted = [...mergedEps].sort((a, b) => {
    const an = a.number ?? 0;
    const bn = b.number ?? 0;
    return sortDesc ? bn - an : an - bn;
  });

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
          <Ionicons name="checkmark-circle" size={12} color={C.green} />
          <Text style={ss.sourceBadgeText}>{t.bothSourcesMerged}</Text>
        </View>
      )}

      <Text style={ss.hint}>{t.tapToToggleWatched}</Text>

      {/* Episode grid: 2 columns for thumbnail cards */}
      <View style={ss.epGrid}>
        {sorted.map((ep, i) => {
          const watched = ep.href ? watchedHrefs.has(ep.href) : false;
          return (
            <Pressable
              key={`${ep.number}-${i}`}
              disabled={!ep.href && !ep.href4up}
              onPress={() => {
                if (ep.href) {
                  router.push({
                    pathname: `/watch/${encodeURIComponent(ep.href)}`,
                    params: { url4up: ep.href4up || '', img: poster || '' },
                  });
                }
              }}
              onLongPress={() => onToggleWatched(ep as Episode)}
              delayLongPress={300}
              style={({ pressed }) => [ss.epCard, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}
            >
              <View style={[ss.epCardThumb, watched && ss.epCardThumbWatched]}>
                {ep.screenshot ? (
                  <Image source={{ uri: ep.screenshot }} style={StyleSheet.absoluteFill} contentFit="cover" />
                ) : poster ? (
                  <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" />
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
              </View>
              <Text style={[ss.epCardTitle, watched && { color: C.textMuted }]} numberOfLines={1}>
                {`${t.episode} ${ep.number ?? ''}`.trim()}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </>
  );
}

/* ── Tab: Related ───────────────────────────── */

function RelatedTab({ items }: { items: RelatedAnime[] }) {
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
      {items.map((item, i) => (
        <Pressable
          key={i}
          onPress={() => router.push(`/anime/${encodeURIComponent(item.href)}`)}
          style={({ pressed }) => [ss.relatedCard, { opacity: pressed ? 0.85 : 1 }]}
        >
          {item.image ? (
            <Image source={{ uri: item.image }} style={ss.relatedImage} contentFit="cover" />
          ) : (
            <View style={[ss.relatedImage, { alignItems: "center", justifyContent: "center" }]}>
              <Ionicons name="image-outline" size={24} color={C.textMuted} />
            </View>
          )}
          <Text style={ss.relatedTitle} numberOfLines={2}>{item.title}</Text>
          {item.type && <Text style={ss.relatedType}>{item.type}</Text>}
        </Pressable>
      ))}
    </View>
  );
}

/* ── Tab: Info ───────────────────────────────── */

function InfoTab({ data }: { data: AnimeDetail }) {
  return (
    <View>
      {Object.entries(data.metadata).map(([label, value], i) => (
        <View key={i} style={ss.infoRow}>
          <Text style={ss.infoLabel}>{label}</Text>
          <Text style={ss.infoValue}>{value}</Text>
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
    color: C.text, fontSize: 32, fontWeight: "800", lineHeight: 36, letterSpacing: -0.6,
    textAlign: "center", fontFamily: "Outfit_800ExtraBold",
  },
  quickMeta: {
    flexDirection: "row", flexWrap: "wrap", justifyContent: "center",
    gap: 6, marginTop: 14,
  },
  ratingPill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: C.goldSoft, borderRadius: R.pill,
    paddingHorizontal: 12, paddingVertical: 5,
  },
  ratingText: { color: C.gold, fontSize: 11, fontWeight: "600", fontFamily: "DMSans_600SemiBold" },

  // Actions
  actions: { flexDirection: "row", gap: 10, marginTop: 20 },
  btnPrimary: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: C.accent, borderRadius: R.pill, paddingVertical: 15,
    ...ELEVATION_GLOW,
  },
  btnPrimaryText: { color: C.textOnAccent, fontSize: 14, fontWeight: "600", fontFamily: "Outfit_600SemiBold" },
  btnGlass: {
    width: 52, alignItems: "center", justifyContent: "center",
    borderRadius: R.pill, backgroundColor: C.surfaceGlass,
    borderWidth: 1, borderColor: C.glassBorder,
  },

  // Synopsis
  synopsis: { color: C.textSecondary, fontSize: 14, lineHeight: 22, marginTop: 20, fontFamily: "DMSans_400Regular" },
  readMore: { color: C.accent, fontSize: 11, fontWeight: "600", marginTop: 6, fontFamily: "DMSans_600SemiBold" },

  // Chips
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 16 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: R.pill,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
  },
  chipText: { color: C.textSecondary, fontSize: 11, fontWeight: "600", fontFamily: "DMSans_600SemiBold" },

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
  tabText: { color: C.textMuted, fontSize: 14, fontWeight: "600", fontFamily: "Outfit_600SemiBold" },
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
  sortChipText: { color: C.textSecondary, fontSize: 12, fontWeight: "600", fontFamily: "DMSans_600SemiBold" },
  sortChipTextActive: { color: C.textOnAccent },
  epCount: { color: C.textMuted, fontSize: 12, fontFamily: "DMSans_500Medium" },

  sourceBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingVertical: 6, paddingHorizontal: 10, marginBottom: 10,
    backgroundColor: C.green + "1F", borderRadius: R.pill,
    alignSelf: "flex-start",
  },
  sourceBadgeText: { color: C.green, fontSize: 11, fontWeight: "700", fontFamily: "DMSans_600SemiBold" },

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
    backgroundColor: C.green,
  },
  epCardSourceText: { color: "#000", fontSize: 9, fontWeight: "800", fontFamily: "Outfit_700Bold" },
  hint: {
    color: C.textMuted, fontSize: 11, marginBottom: 10,
    fontFamily: "DMSans_500Medium", textAlign: "right", writingDirection: "rtl",
  },
  epCardThumbWatched: { borderColor: C.green },
  watchedDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  watchedBadge: {
    position: "absolute", top: 6, right: 6,
    flexDirection: "row", alignItems: "center", gap: 3,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: R.pill,
    backgroundColor: C.green,
  },
  watchedBadgeText: {
    color: "#fff", fontSize: 9, fontWeight: "800",
    fontFamily: "Outfit_700Bold",
  },
  epCardTitle: {
    color: C.textSecondary, fontSize: 11, fontWeight: "600",
    marginTop: 6, fontFamily: "DMSans_600SemiBold",
  },

  // Related
  relatedGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  relatedCard: { width: (SW - PAD * 2 - 24) / 3 },
  relatedImage: {
    width: "100%", aspectRatio: 2 / 3, borderRadius: R.lg, overflow: "hidden",
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  relatedTitle: { color: C.text, fontSize: 11, fontWeight: "600", marginTop: 6, fontFamily: "DMSans_600SemiBold" },
  relatedType: { color: C.textMuted, fontSize: 10, marginTop: 2, fontFamily: "DMSans_500Medium" },

  // Info
  infoRow: { flexDirection: "row", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.borderSoft },
  infoLabel: { color: C.textMuted, fontSize: 13, fontWeight: "500", width: 110, fontFamily: "DMSans_500Medium" },
  infoValue: { color: C.textSecondary, fontSize: 13, flex: 1, fontFamily: "DMSans_500Medium" },

  // Empty
  emptyTab: { alignItems: "center", paddingVertical: 48, gap: 12 },
  emptyTabText: { color: C.textMuted, fontSize: 14, fontFamily: "DMSans_400Regular" },

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
  errorMsg: { color: C.textMuted, fontSize: 16, marginBottom: 20, fontFamily: "DMSans_500Medium" },

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
    fontFamily: "Outfit_700Bold", textAlign: "center",
  },
  pickerSub: {
    color: C.textMuted, fontSize: 12, textAlign: "center",
    fontFamily: "DMSans_500Medium", marginBottom: 8,
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
    fontFamily: "DMSans_600SemiBold",
  },
  pickerOptSub: {
    color: C.textMuted, fontSize: 11, marginTop: 2,
    fontFamily: "DMSans_500Medium",
  },
  pickerCancel: { paddingVertical: 10, alignItems: "center", marginTop: 4 },
  pickerCancelText: {
    color: C.textMuted, fontSize: 13, fontWeight: "600",
    fontFamily: "DMSans_500Medium",
  },
});

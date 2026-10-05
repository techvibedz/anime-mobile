import { useEffect, useState, useCallback, useRef, memo } from "react";
import {
  View,
  Text,
  Pressable,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  Modal,
  ScrollView,
} from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { fetchHome, fetchRecent } from "../../lib/api";
import type { AnimeItem, EpisodeItem, HomeSection } from "../../lib/api";
import { MalCardBadge } from "../../components/MalRating";
import { CompletionBadge } from "../../components/CompletionBadge";
import { C, S, R, ELEVATION_CARD } from "../../lib/theme";
import { PosterCard, PosterPill, INLINE_POSTER_BADGE } from "../../components/PosterCard";
import { CardLayoutControl } from "../../components/CardLayoutControl";
import { useCardLayout, type CardLayout } from "../../lib/cardLayout";
import { dedupeRecentEpisodes } from "../../lib/homeSourceSelection";
import { ScreenHeader } from "../../components/ScreenChrome";
import { t } from "../../lib/i18n";

/**
 * Parses an episode number out of a title like "Anime - الحلقة 12" or
 * pulls it from the trailing digits of an episode URL.
 */
function episodeNumberFrom(item: EpisodeItem): number | null {
  // 1) explicit "الحلقة N" or "Episode N" in title
  const titleMatch = String(item.title || "").match(/الحلقة[\s-]*(\d+)|episode\s*(\d+)/i);
  if (titleMatch) return parseInt(titleMatch[1] || titleMatch[2], 10);
  // 2) try the URL
  if (item.href) {
    try {
      const decoded = decodeURIComponent(item.href);
      const arMatch = decoded.match(/الحلقة[\s-]*(\d+)/);
      if (arMatch) return parseInt(arMatch[1], 10);
      const tail = decoded.replace(/\/$/, "").match(/-(\d+)(?:[-/].*)?$/);
      if (tail) return parseInt(tail[1], 10);
    } catch {}
  }
  return null;
}

const PAD = S.paddingContent;
const GAP = S.gapRelaxed;

// Witanime serves a fixed batch, and dedup can discard repeated anime, so
// FILL_TARGET (≈4 rows) is the
// minimum number of *fresh* items we try to gather per fetch cycle; the loop
// over-fetches pages (bounded by MAX_PAGES_PER_FILL) until it's met. In the
// common case page 1 already clears the bar and only one network trip happens.
const FILL_TARGET = 16;
const MAX_PAGES_PER_FILL = 8;
const PAGES_PER_BATCH = 4;

/**
 * Fetches `recently updated` pages starting at `fromPage`, deduping against the
 * shared `seen` Set, until it has collected ~FILL_TARGET new items (or runs out
 * of pages). Returns the fresh items, the next unfetched page, and whether more
 * pages remain — so callers fill the screen in one cycle instead of trickling.
 */
async function fillRecent(fromPage: number, seen: Set<string>) {
  let page = fromPage;
  let more = true;
  const collected: EpisodeItem[] = [];
  let fetched = 0;
  while (fetched < MAX_PAGES_PER_FILL && more && collected.length < FILL_TARGET) {
    const count = Math.min(PAGES_PER_BATCH, MAX_PAGES_PER_FILL - fetched);
    const batch = await Promise.all(
      Array.from({ length: count }, (_, offset) => fetchRecent(page + offset).catch(() => null)),
    );
    for (const res of batch) {
      if (!res?.success) { more = false; break; }
      page += 1;
      fetched += 1;
      more = res.data.hasNext;
      for (const e of dedupeRecentEpisodes(res.data.episodes, seen)) collected.push(e);
      if (!more) break;
    }
  }
  return { collected, nextPage: page, more };
}

/* Memoized grid cell — keeps the whole grid from re-rendering its visible
 * rows every time the parent's pagination state (loadingMore/hasNext) flips. */
const GridCard = memo(function GridCard({
  item,
  isEpisodeType,
  onPressEpisode,
  width,
  layout,
}: {
  item: AnimeItem | EpisodeItem;
  isEpisodeType: boolean;
  onPressEpisode: (ep: EpisodeItem) => void;
  width: number;
  layout: CardLayout;
}) {
  const epNum = isEpisodeType ? episodeNumberFrom(item as EpisodeItem) : null;
  return (
    <PosterCard
      width={width}
      layout={layout}
      image={item.image}
      title={isEpisodeType ? (item as EpisodeItem).animeTitle || item.title : item.title}
      subtitle={isEpisodeType ? undefined : (item as AnimeItem).type || undefined}
      recyclingKey={item.href}
      onPress={() => {
        if (isEpisodeType) onPressEpisode(item as EpisodeItem);
        else router.push(`/anime/${encodeURIComponent(item.href)}`);
      }}
      topRight={isEpisodeType ? (epNum != null ? <PosterPill><Text style={s.episodeTag}>{t.episode} {epNum}</Text></PosterPill> : null) : <MalCardBadge title={item.title} style={INLINE_POSTER_BADGE} />}
      bottomRight={<CompletionBadge hrefs={[isEpisodeType ? (item as EpisodeItem).animeHref : item.href]} titles={[isEpisodeType ? (item as EpisodeItem).animeTitle : item.title]} style={INLINE_POSTER_BADGE} />}
    />
  );
});

export default function SeeAllScreen() {
  const cards = useCardLayout("see-all", GAP);
  const { section: sectionId, title, type } = useLocalSearchParams<{
    section: string;
    title: string;
    type: string;
  }>();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<(AnimeItem | EpisodeItem)[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasNext, setHasNext] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [episodePopup, setEpisodePopup] = useState<EpisodeItem | null>(null);
  const pageRef = useRef(1);
  const seenRef = useRef<Set<string>>(new Set());
  const isPaginated = sectionId === "recently_updated";
  const isEpisodeType = type === "episode";

  const loadFirst = useCallback(async () => {
    if (isPaginated) {
      const seen = new Set<string>();
      const { collected, nextPage, more } = await fillRecent(1, seen);
      seenRef.current = seen;
      setItems(collected);
      setHasNext(more);
      pageRef.current = nextPage - 1; // last page actually fetched
    } else {
      const res = await fetchHome();
      if (res.success) {
        const sec = res.data.sections.find((s: HomeSection) => s.id === sectionId);
        if (sec) setItems(sec.items);
      }
    }
  }, [sectionId, isPaginated]);

  useEffect(() => { loadFirst(); }, [loadFirst]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await loadFirst(); } finally { setRefreshing(false); }
  }, [loadFirst]);

  const loadMore = useCallback(async () => {
    if (!isPaginated || loadingMore || !hasNext) return;
    setLoadingMore(true);
    try {
      // Over-fetch pages until we've gathered ~a screenful of fresh items, so a
      // single trigger fills the grid instead of trickling one row at a time
      // (and the sparse-page case — a whole page deduped away — is absorbed here).
      const { collected, nextPage, more } = await fillRecent(pageRef.current + 1, seenRef.current);
      if (collected.length) setItems((prev) => [...prev, ...collected]);
      pageRef.current = nextPage - 1;
      setHasNext(more);
    } catch {}
    setLoadingMore(false);
  }, [isPaginated, loadingMore, hasNext]);

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <ScreenHeader title={title ? decodeURIComponent(title) : t.seeAllShort} right={<CardLayoutControl layout={cards.layout} onChange={cards.setLayout} />} />

      <FlatList
        key={`${cards.layout}-${cards.columns}`}
        data={items}
        numColumns={cards.columns}
        keyExtractor={(item, i) => item.href + i}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews
        initialNumToRender={12}
        maxToRenderPerBatch={9}
        windowSize={7}
        updateCellsBatchingPeriod={50}
        contentContainerStyle={{ padding: PAD, paddingBottom: insets.bottom + 20, rowGap: GAP }}
        columnWrapperStyle={cards.columns > 1 ? { gap: GAP } : undefined}
        onEndReached={loadMore}
        onEndReachedThreshold={1.5}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.accent}
            colors={[C.accent]}
            progressBackgroundColor={C.surface}
          />
        }
        ListHeaderComponent={<Text style={s.resultCount}>{isEpisodeType ? t.episodeCount(items.length) : t.scheduleCount(items.length)}</Text>}
        ListFooterComponent={loadingMore ? <ActivityIndicator color={C.accent} style={{ paddingVertical: 20 }} /> : null}
        renderItem={({ item }) => (
          <GridCard item={item} isEpisodeType={isEpisodeType} onPressEpisode={setEpisodePopup} width={cards.cardWidth} layout={cards.layout} />
        )}
      />

      {/* Episode tap popup */}
      {episodePopup && (
        <Modal transparent animationType="fade" visible onRequestClose={() => setEpisodePopup(null)}>
          <Pressable style={s.modalBackdrop} onPress={() => setEpisodePopup(null)}>
            <Pressable style={s.modalSheet} onPress={() => {}}>
              <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 10 }}>
              {episodePopup.image ? (
                <Image source={{ uri: episodePopup.image }} style={s.modalImage} contentFit="cover" />
              ) : null}
              <Text style={s.modalTitle} numberOfLines={2}>{episodePopup.title}</Text>
              {episodePopup.animeTitle ? (
                <Text style={s.modalSub} numberOfLines={1}>{episodePopup.animeTitle}</Text>
              ) : null}
              <Pressable
                style={s.modalBtnPrimary}
                onPress={() => {
                  const ep = episodePopup;
                  setEpisodePopup(null);
                  const params: Record<string, string> = {};
                  if (ep.image) params.img = encodeURIComponent(ep.image);
                  if (ep.animeTitle) params.animeTitle = ep.animeTitle;
                  const epNum = episodeNumberFrom(ep);
                  if (epNum != null) params.epNum = String(epNum);
                  router.push({ pathname: `/watch/${encodeURIComponent(ep.href)}`, params });
                }}
              >
                <Ionicons name="play" size={16} color={C.textOnAccent} />
                <Text style={s.modalBtnPrimaryText}>{t.watchEpisode}</Text>
              </Pressable>
              <Pressable
                style={s.modalBtnSecondary}
                disabled={!episodePopup.animeHref}
                onPress={() => {
                  const ep = episodePopup;
                  setEpisodePopup(null);
                  if (ep.animeHref) router.push(`/anime/${encodeURIComponent(ep.animeHref)}`);
                }}
              >
                <Ionicons name="information-circle-outline" size={16} color={C.white} />
                <Text style={s.modalBtnSecondaryText}>{t.openAnimePage}</Text>
              </Pressable>
              <Pressable style={s.modalCancel} onPress={() => setEpisodePopup(null)}>
                <Text style={s.modalCancelText}>{t.cancel}</Text>
              </Pressable>
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  resultCount: { fontFamily: "Cairo_500Medium", fontSize: 12, color: C.textMuted, textAlign: "right", marginBottom: 4 },
  episodeTag: { fontFamily: "Cairo_600SemiBold", fontSize: 10, color: C.text },

  // Episode action modal
  modalBackdrop: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.75)",
    alignItems: "center", justifyContent: "center", padding: 24,
  },
  modalSheet: {
    width: "100%", maxWidth: 360, maxHeight: "100%",
    backgroundColor: C.bg, borderRadius: R.xl, padding: 20,
    borderWidth: 1, borderColor: C.border,
    alignItems: "stretch", gap: 10,
  },
  modalImage: {
    width: "100%", aspectRatio: 16 / 9, borderRadius: R.lg,
    backgroundColor: C.surface, marginBottom: 4,
  },
  modalTitle: { fontFamily: "Cairo_700Bold", lineHeight: 26, color: C.white, fontSize: 16, fontWeight: "700", textAlign: "center" },
  modalSub: { fontFamily: "Cairo_500Medium", lineHeight: 21, color: C.textMuted, fontSize: 12, textAlign: "center", marginBottom: 6 },
  modalBtnPrimary: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: C.accent, paddingVertical: 12, borderRadius: R.pill,
  },
  modalBtnPrimaryText: { flexShrink: 1, textAlign: "center", fontFamily: "Cairo_600SemiBold", lineHeight: 24, color: C.textOnAccent, fontSize: 14, fontWeight: "700" },
  modalBtnSecondary: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    paddingVertical: 12, borderRadius: R.pill,
  },
  modalBtnSecondaryText: { flexShrink: 1, textAlign: "center", fontFamily: "Cairo_600SemiBold", lineHeight: 24, color: C.white, fontSize: 14, fontWeight: "700" },
  modalCancel: { paddingVertical: 10, alignItems: "center" },
  modalCancelText: { flexShrink: 1, textAlign: "center", fontFamily: "Cairo_600SemiBold", lineHeight: 24, color: C.textMuted, fontSize: 13, fontWeight: "600" },
});

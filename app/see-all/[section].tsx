import { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  Pressable,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  Dimensions,
  Modal,
  I18nManager,
} from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { fetchHome, fetchRecent } from "../../lib/api";
import type { AnimeItem, EpisodeItem, HomeSection } from "../../lib/api";
import { C, S, R, ELEVATION_CARD } from "../../lib/theme";
import { LinearGradient } from "expo-linear-gradient";
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

const { width: SCREEN_W } = Dimensions.get("window");
const PAD = S.paddingContent;
const GAP = S.gapRelaxed;
const NUM_COLS = 3;
const CARD_W = (SCREEN_W - PAD * 2 - GAP * (NUM_COLS - 1)) / NUM_COLS;

export default function SeeAllScreen() {
  const { section: sectionId, title, type } = useLocalSearchParams<{
    section: string;
    title: string;
    type: string;
  }>();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<(AnimeItem | EpisodeItem)[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasNext, setHasNext] = useState(false);
  const [episodePopup, setEpisodePopup] = useState<EpisodeItem | null>(null);
  const pageRef = useRef(1);
  const isPaginated = sectionId === "recently_updated";
  const isEpisodeType = type === "episode";

  useEffect(() => {
    if (isPaginated) {
      fetchRecent(1).then((res) => {
        if (res.success) {
          setItems(res.data.episodes);
          setHasNext(res.data.hasNext);
          pageRef.current = 1;
        }
      });
    } else {
      fetchHome().then((res) => {
        if (res.success) {
          const sec = res.data.sections.find((s: HomeSection) => s.id === sectionId);
          if (sec) setItems(sec.items);
        }
      });
    }
  }, [sectionId, isPaginated]);

  const loadMore = useCallback(async () => {
    if (!isPaginated || loadingMore || !hasNext) return;
    setLoadingMore(true);
    const nextPage = pageRef.current + 1;
    try {
      const res = await fetchRecent(nextPage);
      if (res.success) {
        setItems((prev) => [...prev, ...res.data.episodes]);
        setHasNext(res.data.hasNext);
        pageRef.current = nextPage;
      }
    } catch {}
    setLoadingMore(false);
  }, [isPaginated, loadingMore, hasNext]);

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name={I18nManager.isRTL ? "chevron-forward" : "chevron-back"} size={22} color={C.white} />
        </Pressable>
        <Text style={s.heading} numberOfLines={1}>
          {title ? decodeURIComponent(title) : t.seeAllShort}
        </Text>
        <View style={s.countPill}>
          <Text style={s.count}>{items.length}</Text>
        </View>
      </View>

      <FlatList
        data={items}
        numColumns={NUM_COLS}
        keyExtractor={(item, i) => item.href + i}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews
        contentContainerStyle={{ padding: PAD, paddingBottom: insets.bottom + 20 }}
        columnWrapperStyle={{ gap: GAP, marginBottom: GAP }}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListFooterComponent={loadingMore ? <ActivityIndicator color={C.accent} style={{ paddingVertical: 20 }} /> : null}
        renderItem={({ item }) => {
          const epNum = isEpisodeType ? episodeNumberFrom(item as EpisodeItem) : null;
          return (
            <Pressable
              onPress={() => {
                if (isEpisodeType) {
                  setEpisodePopup(item as EpisodeItem);
                } else {
                  router.push(`/anime/${encodeURIComponent(item.href)}`);
                }
              }}
              style={{ width: CARD_W }}
            >
              <View style={s.imageWrap}>
                {item.image ? (
                  <Image
                    source={{ uri: item.image }}
                    style={s.image}
                    contentFit="cover"
                    recyclingKey={item.href}
                    transition={200}
                  />
                ) : (
                  <View style={[s.image, { alignItems: "center", justifyContent: "center" }]}>
                    <Ionicons name="image-outline" size={24} color={C.textMuted} />
                  </View>
                )}
                {isEpisodeType && epNum != null && (
                  <View style={s.epBadgeWrap} pointerEvents="none">
                    <LinearGradient
                      colors={["transparent", "rgba(0,0,0,0.85)"]}
                      style={s.epBadgeGradient}
                    />
                    <View style={s.epBadge}>
                      <Text style={s.epBadgeText}>{t.episode} {epNum}</Text>
                    </View>
                  </View>
                )}
              </View>
              <Text style={s.title} numberOfLines={2}>
                {isEpisodeType ? (item as EpisodeItem).animeTitle || item.title : item.title}
              </Text>
            </Pressable>
          );
        }}
      />

      {/* Episode tap popup */}
      {episodePopup && (
        <Modal transparent animationType="fade" visible onRequestClose={() => setEpisodePopup(null)}>
          <Pressable style={s.modalBackdrop} onPress={() => setEpisodePopup(null)}>
            <Pressable style={s.modalSheet} onPress={() => {}}>
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
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: PAD,
    paddingVertical: 12,
    gap: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.glass,
    borderWidth: 1,
    borderColor: C.glassBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  heading: {
    color: C.text,
    fontSize: 22,
    fontWeight: "800",
    flex: 1,
    fontFamily: "Outfit_800ExtraBold",
    letterSpacing: -0.4,
  },
  countPill: {
    backgroundColor: C.accentSoft,
    borderWidth: 1,
    borderColor: C.borderAccent,
    borderRadius: R.pill,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  count: {
    color: C.accent,
    fontSize: 12,
    fontWeight: "700",
    fontFamily: "Outfit_700Bold",
  },
  imageWrap: {
    width: CARD_W,
    aspectRatio: 2 / 3,
    borderRadius: R.lg,
    overflow: "hidden",
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    ...ELEVATION_CARD,
  },
  image: {
    width: CARD_W,
    aspectRatio: 2 / 3,
    borderRadius: R.lg,
    backgroundColor: C.surface,
  },
  epBadgeWrap: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    height: 56, justifyContent: "flex-end", padding: 6,
  },
  epBadgeGradient: { ...StyleSheet.absoluteFillObject },
  epBadge: {
    backgroundColor: C.accent, alignSelf: "flex-start",
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: R.pill,
  },
  epBadgeText: {
    color: "#fff", fontSize: 10, fontWeight: "800",
    fontFamily: "Outfit_700Bold",
  },
  title: {
    color: C.text,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
    marginTop: 6,
    width: CARD_W,
    fontFamily: "DMSans_600SemiBold",
  },
  sub: {
    color: C.textMuted,
    fontSize: 11,
    lineHeight: 14,
    marginTop: 2,
    width: CARD_W,
    fontFamily: "DMSans_500Medium",
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
  modalTitle: { color: C.white, fontSize: 16, fontWeight: "700", textAlign: "center" },
  modalSub: { color: C.textMuted, fontSize: 12, textAlign: "center", marginBottom: 6 },
  modalBtnPrimary: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: C.accent, paddingVertical: 12, borderRadius: R.pill,
  },
  modalBtnPrimaryText: { color: C.textOnAccent, fontSize: 14, fontWeight: "700" },
  modalBtnSecondary: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    paddingVertical: 12, borderRadius: R.pill,
  },
  modalBtnSecondaryText: { color: C.white, fontSize: 14, fontWeight: "700" },
  modalCancel: { paddingVertical: 10, alignItems: "center" },
  modalCancelText: { color: C.textMuted, fontSize: 13, fontWeight: "600" },
});

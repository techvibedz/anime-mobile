// AniList title detail — used for Upcoming anime (and their relations), which
// aren't on our sources yet, so everything here comes from AniList: banner,
// synopsis, trailer, studios, air date, genres and the relation graph. Tapping
// "ابحث في مصادرنا" jumps to Discover pre-searched (useful once it airs), and a
// related card opens that title's own AniList detail.

import { useEffect, useState, useCallback } from "react";
import {
  View, Text, ScrollView, Pressable, Dimensions, StyleSheet, Linking, ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { fetchAniListDetail, type AniListDetail } from "../../lib/seasons";
import { translateToArabic } from "../../lib/translate";
import { arGenre, arFormat } from "../../lib/anilistLabels";
import { GlassFill } from "../../components/GlassFill";
import { MalBadge, MalCardBadge, useMalRating } from "../../components/MalRating";
import { C, R, S, ELEVATION_CARD, ELEVATION_GLOW } from "../../lib/theme";
import { t } from "../../lib/i18n";

const { width: SW } = Dimensions.get("window");
const BANNER_H = 300;
const PAD = S.paddingContent;

const STATUS_AR: Record<string, string> = {
  RELEASING: t.statusReleasing,
  FINISHED: t.statusFinished,
  NOT_YET_RELEASED: t.statusNotYet,
  CANCELLED: t.statusCancelled,
  HIATUS: t.statusHiatus,
};

function fmtDate(startAt: number | null): string | null {
  if (!startAt) return null;
  const d = new Date(startAt * 1000);
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

export default function TitleDetailScreen() {
  const { id, title: titleParam, img, banner: bannerParam } = useLocalSearchParams<{
    id: string; title?: string; img?: string; banner?: string;
  }>();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<AniListDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [synopsisOpen, setSynopsisOpen] = useState(false);
  // AniList synopses are English; translate to Arabic so the page is fully
  // Arabic. `null` = not translated yet (show a "translating" hint).
  const [synopsisAr, setSynopsisAr] = useState<string | null>(null);

  const anilistId = id ? parseInt(id, 10) : 0;
  const fallbackTitle = titleParam ? decodeURIComponent(titleParam) : "";
  const fallbackImg = img ? decodeURIComponent(img) : "";
  const fallbackBanner = bannerParam ? decodeURIComponent(bannerParam) : "";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchAniListDetail(anilistId)
      .then((d) => { if (!cancelled) setData(d); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [anilistId]);

  // Translate the (English) AniList synopsis to Arabic once it's loaded.
  useEffect(() => {
    const desc = data?.description;
    if (!desc) { setSynopsisAr(""); return; }
    let cancelled = false;
    setSynopsisAr(null);
    translateToArabic(desc)
      .then((ar) => { if (!cancelled) setSynopsisAr(ar); })
      .catch(() => { if (!cancelled) setSynopsisAr(desc); });
    return () => { cancelled = true; };
  }, [data?.description]);

  const openTrailer = useCallback(() => {
    if (data?.trailerYoutube) Linking.openURL(`https://www.youtube.com/watch?v=${data.trailerYoutube}`).catch(() => {});
  }, [data?.trailerYoutube]);

  const searchOnSources = useCallback(() => {
    const q = data?.title || fallbackTitle;
    if (q) router.push(`/(tabs)/search?q=${encodeURIComponent(q)}`);
  }, [data?.title, fallbackTitle]);

  const title = data?.title || fallbackTitle;
  const malScore = useMalRating(title);
  const banner = data?.banner || data?.cover || fallbackBanner || fallbackImg;
  const status = data?.status ? STATUS_AR[data.status] || data.status : null;
  const airDate = fmtDate(data?.startAt ?? null);

  const infoRows: { label: string; value: string }[] = [];
  if (data) {
    if (status) infoRows.push({ label: t.titleStatus, value: status });
    if (data.format) infoRows.push({ label: t.titleFormat, value: arFormat(data.format)! });
    if (data.episodes) infoRows.push({ label: "عدد الحلقات", value: String(data.episodes) });
    if (data.duration) infoRows.push({ label: "المدة", value: t.titleDuration(data.duration) });
    if (airDate) infoRows.push({ label: t.titleAirDate, value: airDate });
    if (data.studios.length) infoRows.push({ label: t.titleStudio, value: data.studios.join("، ") });
  }

  return (
    <View style={ss.root}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
        {/* Banner */}
        <View style={ss.banner}>
          {banner ? (
            <Image source={{ uri: banner }} style={{ width: SW, height: BANNER_H }} contentFit="cover" cachePolicy="memory-disk" transition={200} />
          ) : (
            <View style={[{ width: SW, height: BANNER_H }, { backgroundColor: C.surface }]} />
          )}
          <LinearGradient
            colors={["rgba(0,0,0,0.25)", "transparent", "rgba(10,10,11,0.6)", C.bg]}
            locations={[0, 0.3, 0.7, 1]}
            style={StyleSheet.absoluteFill}
          />
        </View>

        <View style={ss.body}>
          {/* Title + soon badge */}
          <Text style={ss.title}>{title}</Text>
          {data?.status === "NOT_YET_RELEASED" && (
            <View style={ss.soonPill}>
              <Ionicons name="sparkles" size={11} color={C.accent} />
              <Text style={ss.soonText}>{airDate ? t.titleAirsOn(airDate) : t.titleNotReleased}</Text>
            </View>
          )}

          {/* Quick meta */}
          <View style={ss.metaRow}>
            <MalBadge score={malScore} />
            {malScore == null && data?.score != null && (
              <View style={ss.scorePill}>
                <Ionicons name="star" size={12} color={C.gold} />
                <Text style={ss.scoreText}>{(data.score / 10).toFixed(1)}</Text>
              </View>
            )}
            {data?.format && <Text style={ss.metaText}>{arFormat(data.format)}</Text>}
            {data?.episodes != null && <Text style={ss.metaText}>{t.titleEpisodes(data.episodes)}</Text>}
          </View>

          {/* Actions */}
          <View style={ss.actions}>
            {data?.trailerYoutube ? (
              <Pressable style={ss.btnPrimary} onPress={openTrailer}>
                <Ionicons name="logo-youtube" size={17} color={C.textOnAccent} />
                <Text style={ss.btnPrimaryText}>{t.watchTrailer}</Text>
              </Pressable>
            ) : (
              <Pressable style={ss.btnPrimary} onPress={searchOnSources}>
                <Ionicons name="search" size={16} color={C.textOnAccent} />
                <Text style={ss.btnPrimaryText}>{t.searchOnSources}</Text>
              </Pressable>
            )}
            {data?.trailerYoutube && (
              <Pressable style={ss.btnGlass} onPress={searchOnSources}>
                <Ionicons name="search" size={18} color={C.text} />
              </Pressable>
            )}
          </View>

          {loading && !data ? (
            <ActivityIndicator color={C.accent} style={{ marginTop: 28 }} />
          ) : null}

          {/* Synopsis (translated to Arabic) */}
          {data?.description ? (
            <View style={ss.section}>
              <Text style={ss.sectionTitle}>{t.titleStory}</Text>
              {synopsisAr === null ? (
                <View style={ss.translating}>
                  <ActivityIndicator size="small" color={C.accent} />
                  <Text style={ss.translatingText}>{t.translating}</Text>
                </View>
              ) : (
                <Pressable onPress={() => setSynopsisOpen((v) => !v)}>
                  <Text style={ss.synopsis} numberOfLines={synopsisOpen ? undefined : 4}>{synopsisAr}</Text>
                  <Text style={ss.readMore}>{synopsisOpen ? t.showLess : t.readMore}</Text>
                </Pressable>
              )}
            </View>
          ) : null}

          {/* Genres */}
          {data && data.genres.length > 0 && (
            <View style={ss.chipRow}>
              {data.genres.map((g, i) => (
                <View key={i} style={ss.chip}><Text style={ss.chipText}>{arGenre(g)}</Text></View>
              ))}
            </View>
          )}

          {/* Details */}
          {infoRows.length > 0 && (
            <View style={ss.section}>
              <Text style={ss.sectionTitle}>{t.titleDetails}</Text>
              {infoRows.map((row, i) => (
                <View key={i} style={ss.infoRow}>
                  <Text style={ss.infoLabel}>{row.label}</Text>
                  <Text style={ss.infoValue}>{row.value}</Text>
                </View>
              ))}
            </View>
          )}

          {/* External links / news */}
          {data && data.externalLinks.length > 0 && (
            <View style={ss.section}>
              <Text style={ss.sectionTitle}>{t.titleLinks}</Text>
              <View style={ss.chipRow}>
                {data.externalLinks.slice(0, 8).map((l, i) => (
                  <Pressable key={i} style={ss.linkChip} onPress={() => Linking.openURL(l.url).catch(() => {})}>
                    <Ionicons name="open-outline" size={12} color={C.accent} />
                    <Text style={ss.linkChipText} numberOfLines={1}>{/official\s*site/i.test(l.site) ? "الموقع الرسمي" : l.site}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {/* Related */}
          {data && data.relations.length > 0 && (
            <View style={ss.section}>
              <Text style={ss.sectionTitle}>{t.titleRelated}</Text>
              <View style={ss.relGrid}>
                {data.relations.map((r) => (
                  <Pressable
                    key={r.id}
                    style={ss.relCard}
                    onPress={() => router.push({ pathname: `/title/${r.id}`, params: { title: encodeURIComponent(r.title), img: r.image ? encodeURIComponent(r.image) : "" } })}
                  >
                    <View style={ss.relImgWrap}>
                      {r.image ? (
                        <Image source={{ uri: r.image }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" recyclingKey={String(r.id)} transition={200} />
                      ) : (
                        <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
                          <Ionicons name="image-outline" size={22} color={C.textMuted} />
                        </View>
                      )}
                      <MalCardBadge title={r.title} />
                    </View>
                    <Text style={ss.relTitle} numberOfLines={2}>{r.title}</Text>
                    {r.format ? <Text style={ss.relFmt}>{arFormat(r.format)}</Text> : null}
                  </Pressable>
                ))}
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Floating back button */}
      <View style={[ss.topBar, { top: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()}>
          <View style={ss.glassCircle}>
            <GlassFill intensity={16} />
            <Ionicons name="chevron-back" size={20} color={C.text} />
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const ss = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  banner: { width: SW, height: BANNER_H, backgroundColor: C.surface, overflow: "hidden" },
  body: { paddingHorizontal: PAD, marginTop: -40 },

  title: { color: C.text, fontSize: 22, lineHeight: 30, fontFamily: "Cairo_700Bold", textAlign: "center" },
  soonPill: {
    flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "center", marginTop: 10,
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: R.pill,
    backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.borderAccent,
  },
  soonText: { color: C.accent, fontSize: 11, fontFamily: "Cairo_700Bold" },

  metaRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 12 },
  scorePill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: C.goldSoft, borderRadius: R.pill, paddingHorizontal: 10, paddingVertical: 4 },
  scoreText: { color: C.gold, fontSize: 12, fontWeight: "800", fontFamily: "Outfit_700Bold" },
  metaText: { color: C.textSecondary, fontSize: 12, fontFamily: "Cairo_500Medium" },

  actions: { flexDirection: "row", gap: 10, marginTop: 18 },
  btnPrimary: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: C.accent, borderRadius: R.pill, paddingVertical: 14, ...ELEVATION_GLOW,
  },
  btnPrimaryText: { color: C.textOnAccent, fontSize: 14, fontFamily: "Cairo_700Bold" },
  btnGlass: {
    width: 52, alignItems: "center", justifyContent: "center", borderRadius: R.pill,
    backgroundColor: C.surfaceGlass, borderWidth: 1, borderColor: C.glassBorder,
  },

  section: { marginTop: 24 },
  sectionTitle: { color: C.text, fontSize: 16, fontFamily: "Cairo_700Bold", textAlign: "right", marginBottom: 10 },
  synopsis: { color: C.textSecondary, fontSize: 14, lineHeight: 23, fontFamily: "Cairo_500Medium", textAlign: "right", writingDirection: "rtl" },
  readMore: { color: C.accent, fontSize: 11, fontFamily: "Cairo_600SemiBold", marginTop: 6, textAlign: "right" },
  translating: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8, paddingVertical: 6 },
  translatingText: { color: C.textMuted, fontSize: 12, fontFamily: "Cairo_500Medium" },

  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 16, justifyContent: "flex-end" },
  chip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: R.pill, backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder },
  chipText: { color: C.textSecondary, fontSize: 11, fontFamily: "Cairo_600SemiBold" },

  linkChip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: R.pill,
    backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.borderAccent,
  },
  linkChipText: { color: C.accent, fontSize: 11, fontFamily: "Cairo_600SemiBold", maxWidth: 120 },

  infoRow: { flexDirection: "row-reverse", paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: C.borderSoft },
  infoLabel: { color: C.textMuted, fontSize: 13, width: 110, fontFamily: "Cairo_500Medium", textAlign: "right" },
  infoValue: { color: C.textSecondary, fontSize: 13, flex: 1, fontFamily: "Cairo_500Medium", textAlign: "left", writingDirection: "rtl" },

  relGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  relCard: { width: (SW - PAD * 2 - 24) / 3 },
  relImgWrap: { width: "100%", aspectRatio: 2 / 3, borderRadius: R.lg, overflow: "hidden", backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, ...ELEVATION_CARD },
  relTitle: { color: C.text, fontSize: 11, fontFamily: "Cairo_600SemiBold", marginTop: 6, textAlign: "right" },
  relFmt: { color: C.textMuted, fontSize: 10, fontFamily: "Cairo_500Medium", marginTop: 2, textAlign: "right" },

  topBar: { position: "absolute", left: PAD, right: PAD, flexDirection: "row", justifyContent: "space-between" },
  glassCircle: {
    width: 40, height: 40, borderRadius: R.circle, overflow: "hidden",
    alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.glassBorder,
  },
});

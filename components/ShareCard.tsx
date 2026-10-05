// Screenshot-able share card for an anime. Purely presentational — the backdrop
// is the banner under a subtle blur + scrim, the card carries the poster, title,
// score/episodes/genre pills, branding, and a Share/Close pair. Sharing uses RN
// core `Share`, so no native rebuild is needed. Every string is Arabic via `t`.

import { Modal, View, Text, Pressable, ScrollView, StyleSheet, Share } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Image } from "expo-image";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import { C, R, ELEVATION_CARD, ABSOLUTE_FILL } from "../lib/theme";
import { posterUrl } from "../lib/img";
import { t } from "../lib/i18n";

export interface ShareCardAnime {
  title: string;
  poster?: string | null;
  banner?: string | null;
  score?: string | null;
  genres?: string[];
  episodes?: number | null;
}

export function ShareCard({
  visible,
  onClose,
  anime,
}: {
  visible: boolean;
  onClose: () => void;
  anime: ShareCardAnime;
}) {
  const insets = useSafeAreaInsets();
  const { title, poster, banner, score, genres, episodes } = anime;
  const posterUri = posterUrl(poster, 240);
  const bannerUri = posterUrl(banner, 800, 1200);

  const share = () => {
    Share.share({
      message: score ? t.shareAnimeWithScore(title, score) : t.shareAnimePlain(title),
    }).catch(() => {});
  };

  return (
    <Modal visible={visible} animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={[ss.root, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
        {bannerUri ? (
          <Image
            source={{ uri: bannerUri }}
            style={ABSOLUTE_FILL}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={200}
          />
        ) : (
          <View style={[ABSOLUTE_FILL, { backgroundColor: C.bgDeep }]} />
        )}
        {bannerUri ? <BlurView intensity={22} tint="dark" style={ABSOLUTE_FILL} /> : null}
        <View style={[ABSOLUTE_FILL, ss.scrim]} />
        <Pressable
          style={ABSOLUTE_FILL}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t.shareCardClose}
        />

        <View style={ss.card}>
          <ScrollView style={ss.scroll}>
          <View style={ss.headerRow}>
            {posterUri ? (
              <Image
                source={{ uri: posterUri }}
                style={ss.poster}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={200}
              />
            ) : (
              <View style={[ss.poster, ss.posterFallback]}>
                <Ionicons name="image-outline" size={24} color={C.textMuted} />
              </View>
            )}

            <View style={ss.headerText}>
              <Text style={ss.title} numberOfLines={2} ellipsizeMode="tail">{title}</Text>

              <View style={ss.pillRow}>
                {score ? (
                  <View style={[ss.pill, ss.pillScore]}>
                    <Ionicons name="star" size={11} color={C.gold} />
                    <Text style={[ss.pillText, ss.pillScoreText]}>{score}</Text>
                  </View>
                ) : null}
                {episodes != null && episodes > 0 ? (
                  <View style={ss.pill}>
                    <Ionicons name="film-outline" size={11} color={C.textSecondary} />
                    <Text style={ss.pillText}>{t.episodeCount(episodes)}</Text>
                  </View>
                ) : null}
                {(genres ?? []).slice(0, 3).map((g, i) => (
                  <View key={`${g}-${i}`} style={[ss.pill, ss.pillGenre]}>
                    <Text style={[ss.pillText, ss.pillGenreText]} numberOfLines={1}>{g}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>

          <View style={ss.divider} />
          <Text style={ss.brand}>{t.shareCardBrand}</Text>
          <Text style={ss.url}>https://pantoufa.pages.dev/</Text>
          <Text style={ss.hint}>{t.shareCardHint}</Text>
          </ScrollView>

          <View style={ss.buttons}>
            <Pressable
              style={({ pressed }) => [ss.btnPrimary, pressed && { opacity: 0.88 }]}
              onPress={share}
              accessibilityRole="button"
              accessibilityLabel={t.shareCardShare}
            >
              <Ionicons name="share-social" size={18} color={C.textOnAccent} />
              <Text style={ss.btnPrimaryText}>{t.shareCardShare}</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [ss.btnSecondary, pressed && { opacity: 0.88 }]}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t.shareCardClose}
            >
              <Ionicons name="close" size={18} color={C.textSecondary} />
              <Text style={ss.btnSecondaryText}>{t.shareCardClose}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const ss = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  scrim: {
    backgroundColor: C.overlayMedium,
  },
  card: {
    maxHeight: "100%",
    backgroundColor: C.surface,
    borderRadius: R.xl,
    borderWidth: 1,
    borderColor: C.border,
    padding: 20,
    ...ELEVATION_CARD,
  },
  scroll: { flexShrink: 1 },

  headerRow: {
    flexDirection: "row",
    gap: 14,
  },
  poster: {
    width: 88,
    height: 132,
    borderRadius: R.lg,
    overflow: "hidden",
    backgroundColor: C.surfaceLight,
  },
  posterFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 20,
    lineHeight: 30,
    fontFamily: "Cairo_700Bold",
    fontWeight: "700",
    color: C.text,
    textAlign: "right",
    includeFontPadding: false,
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: 6,
    marginTop: 12,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: C.borderSoft,
    backgroundColor: C.surfaceLight,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  pillScore: {
    backgroundColor: C.goldSoft,
    borderColor: "rgba(255,206,92,0.35)",
  },
  pillGenre: {
    backgroundColor: C.accentSoft,
    borderColor: C.borderViolet,
  },
  pillText: {
    fontSize: 12,
    lineHeight: 21,
    fontFamily: "Cairo_600SemiBold",
    fontWeight: "600",
    color: C.textSecondary,
  },
  pillScoreText: { color: C.gold },
  pillGenreText: { color: C.accent },

  divider: {
    height: 1,
    backgroundColor: C.dividerWisp,
    marginTop: 18,
  },
  brand: {
    fontSize: 13,
    lineHeight: 20,
    fontFamily: "Cairo_700Bold",
    fontWeight: "700",
    color: C.textSecondary,
    textAlign: "right",
    marginTop: 14,
  },
  url: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "Cairo_500Medium",
    fontWeight: "500",
    color: C.textMuted,
    textAlign: "right",
  },
  hint: {
    fontSize: 11,
    lineHeight: 17,
    fontFamily: "Cairo_500Medium",
    fontWeight: "500",
    color: C.textFaint,
    textAlign: "right",
    marginTop: 2,
  },

  buttons: {
    flexShrink: 0,
    flexDirection: "row",
    gap: 10,
    marginTop: 18,
  },
  btnPrimary: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: C.accent,
    borderRadius: R.md,
    paddingVertical: 13,
  },
  btnPrimaryText: {
    flexShrink: 1,
    textAlign: "center",
    fontSize: 14,
    fontFamily: "Cairo_700Bold",
    fontWeight: "700",
    color: C.textOnAccent,
  },
  btnSecondary: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: C.surfaceLight,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.md,
    paddingVertical: 13,
  },
  btnSecondaryText: {
    flexShrink: 1,
    textAlign: "center",
    fontSize: 14,
    fontFamily: "Cairo_600SemiBold",
    fontWeight: "600",
    color: C.textSecondary,
  },
});

// Poster grid cell shared by the Upcoming and Seasons screens. Memoized so the
// grid doesn't re-render its visible cells when the parent's loading/selection
// state flips. Matches the see-all grid card's visual language (2:3 poster,
// glass border, soft elevation, Cairo title).

import { memo } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { C, R, ELEVATION_CARD } from "../lib/theme";
import { CompletionBadge } from "./CompletionBadge";

export interface CatalogCardData {
  id: number;
  title: string;
  image: string | null;
  score: number | null;
  /** Small pill text pinned to the poster's bottom (e.g. air date / format). */
  badge?: string | null;
  /** Resolved source URL — when set, the card can open the detail page directly. */
  href?: string | null;
}

export const CatalogCard = memo(function CatalogCard({
  item,
  width,
  onPress,
  loading,
}: {
  item: CatalogCardData;
  width: number;
  onPress: (item: CatalogCardData) => void;
  /** Shows a spinner overlay while the tap resolves the source URL. */
  loading?: boolean;
}) {
  return (
    <Pressable onPress={() => onPress(item)} style={({ pressed }) => [{ width }, pressed && { opacity: 0.85 }]}>
      <View style={[s.imageWrap, { width }]}>
        {item.image ? (
          <Image
            source={{ uri: item.image }}
            style={[s.image, { width }]}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={String(item.id)}
            transition={200}
          />
        ) : (
          <View style={[s.image, { width, alignItems: "center", justifyContent: "center" }]}>
            <Ionicons name="image-outline" size={24} color={C.textMuted} />
          </View>
        )}

        {item.score != null ? (
          <View style={s.scorePill}>
            <Ionicons name="star" size={9} color={C.gold} />
            <Text style={s.scoreText}>{(item.score / 10).toFixed(1)}</Text>
          </View>
        ) : null}

        {item.badge ? (
          <View style={s.badgeWrap} pointerEvents="none">
            <LinearGradient colors={["transparent", "rgba(0,0,0,0.85)"]} style={StyleSheet.absoluteFill} />
            <View style={s.badge}>
              <Text style={s.badgeText} numberOfLines={1}>{item.badge}</Text>
            </View>
          </View>
        ) : null}

        {loading ? (
          <View style={s.loadingOverlay} pointerEvents="none">
            <ActivityIndicator color="#fff" />
          </View>
        ) : null}

        <CompletionBadge hrefs={[item.href]} titles={[item.title]} />
      </View>
      <Text style={[s.title, { width }]} numberOfLines={2}>{item.title}</Text>
    </Pressable>
  );
});

const s = StyleSheet.create({
  imageWrap: {
    aspectRatio: 2 / 3, borderRadius: R.lg, overflow: "hidden",
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    ...ELEVATION_CARD,
  },
  image: { aspectRatio: 2 / 3, borderRadius: R.lg, backgroundColor: C.surface },

  scorePill: {
    position: "absolute", top: 6, right: 6,
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: "rgba(0,0,0,0.66)", borderRadius: R.pill,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  scoreText: { color: C.gold, fontSize: 10, fontWeight: "800", fontFamily: "Outfit_700Bold" },

  badgeWrap: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    height: 50, justifyContent: "flex-end", padding: 6,
  },
  badge: {
    alignSelf: "flex-start", backgroundColor: C.accent,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: R.pill,
  },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "800", fontFamily: "Outfit_700Bold" },

  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(6,7,26,0.55)",
  },

  title: {
    color: C.text, fontSize: 12, fontWeight: "600", lineHeight: 16,
    marginTop: 6, fontFamily: "Cairo_600SemiBold", textAlign: "right",
  },
});

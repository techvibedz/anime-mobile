/** @jsxImportSource nativewind */
// Poster grid cell shared by the Upcoming and Seasons screens. Now built on
// the unified <PosterCard> so it shares one anatomy with every other poster
// in the app. Memoized so the grid doesn't re-render its visible cells when
// the parent's loading/selection state flips.

import { memo } from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { C } from "../lib/theme";
import { PosterCard, PosterPill, INLINE_POSTER_BADGE } from "./PosterCard";
import type { CardLayout } from "../lib/cardLayout";
import { CompletionBadge } from "./CompletionBadge";
import { MalScoreBadge, useMalRating } from "./MalRating";

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

/**
 * Corner score for the grid: the MyAnimeList rating once it resolves
 * (fire-and-forget, cached), the AniList score pill as a fallback until then
 * so the card never sits bare. Never both at once — one corner, one pill.
 */
function ScoreCorner({ title, score }: { title: string; score: number | null }) {
  const mal = useMalRating(title);
  if (mal != null) return <MalScoreBadge score={mal} style={INLINE_POSTER_BADGE} />;
  if (score != null) {
    return (
      <PosterPill>
        <Ionicons name="star" size={9} color={C.gold} />
        <Text className="text-gold text-[10px] font-heading">{(score / 10).toFixed(1)}</Text>
      </PosterPill>
    );
  }
  return null;
}

export const CatalogCard = memo(function CatalogCard({
  item,
  width,
  onPress,
  loading,
  layout,
}: {
  item: CatalogCardData;
  width: number;
  onPress: (item: CatalogCardData) => void;
  /** Shows a spinner overlay while the tap resolves the source URL. */
  loading?: boolean;
  layout?: CardLayout;
}) {
  return (
    <PosterCard
      image={item.image}
      title={item.title}
      onPress={() => onPress(item)}
      width={width}
      layout={layout}
      loading={loading}
      recyclingKey={String(item.id)}
      titleLines={2}
      topRight={<ScoreCorner title={item.title} score={item.score} />}
      bottomRight={
        <>
          {item.badge ? (
            <View className="bg-ember rounded-pill px-2 py-[3px] mb-1" style={{ maxWidth: layout === "list" ? undefined : width - 16 }}>
              <Text className="text-on-accent text-[11px] font-ar-semi" numberOfLines={1}>{item.badge}</Text>
            </View>
          ) : null}
          <CompletionBadge hrefs={[item.href]} titles={[item.title]} style={INLINE_POSTER_BADGE} />
        </>
      }
    />
  );
});

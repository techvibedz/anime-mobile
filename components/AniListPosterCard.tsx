// AniList-sourced poster with open-on-tap — shared by the Related tab
// (app/anime/[id].tsx) and the home "مقترح لك" rail.
//
// AniList knows a title + artwork but not a playable source URL. A tap never
// waits for that lookup: an already-resolved card opens its source page
// directly, anything else opens the detail page AT ONCE on a placeholder href
// (lib/anilistResolve pendingAniListHref) and the page resolves the title
// behind its skeleton — showing "not found" there when no confident match
// exists. The resolve is kicked off here, before the push, so it runs during
// the screen transition. Rails warm their first cards with prewarmEntries.

import { useCallback, type ReactNode } from "react";
import { router } from "expo-router";
import { PosterCard } from "./PosterCard";
import { peekResolvedHrefSync, pendingAniListHref, resolveEntryToSource, type AniListResolveEntry } from "../lib/anilistResolve";
import type { CardLayout } from "../lib/cardLayout";

export interface AniListPosterCardProps {
  entry: AniListResolveEntry;
  width: number;
  layout?: CardLayout;
  titleLines?: number;
  topRight?: ReactNode;
  footer?: ReactNode;
}

export function AniListPosterCard({ entry, width, layout, titleLines = 2, topRight, footer }: AniListPosterCardProps) {
  const open = useCallback(() => {
    const cached = peekResolvedHrefSync(entry.anilistId);
    if (cached) {
      router.push(`/anime/${encodeURIComponent(cached)}`);
      return;
    }
    void resolveEntryToSource(entry);
    router.push(`/anime/${encodeURIComponent(pendingAniListHref(entry))}`);
  }, [entry]);

  return (
    <PosterCard
      image={entry.image}
      title={entry.title}
      subtitle={entry.format || undefined}
      onPress={open}
      width={width}
      layout={layout}
      recyclingKey={String(entry.anilistId)}
      titleLines={titleLines}
      topRight={topRight}
      footer={footer}
    />
  );
}

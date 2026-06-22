// Open a catalogue title (AniList-sourced) on the REAL anime detail page.
//
// When the title's source URL is already known (resolved during verification)
// we navigate straight to /anime/<href>. Otherwise we resolve it on tap
// (anime4up/anime3rb, cached) showing a brief per-card spinner, and only fall
// back to Discover-pre-searched if neither source carries it. This is what makes
// the "most popular" rails open the anime page directly instead of search.

import { useCallback, useState } from "react";
import { router } from "expo-router";
import { resolveSourceUrl } from "../lib/schedule";

export interface OpenableItem {
  id: number;
  title: string;
  sourceHref?: string | null;
}

export function useOpenSource() {
  const [resolvingId, setResolvingId] = useState<number | null>(null);

  const open = useCallback(async (item: OpenableItem) => {
    const href = item.sourceHref;
    if (href) {
      router.push(`/anime/${encodeURIComponent(href)}`);
      return;
    }
    if (resolvingId != null) return; // a resolution is already in flight
    setResolvingId(item.id);
    try {
      const url = await resolveSourceUrl(item.title).catch(() => null);
      if (url) router.push(`/anime/${encodeURIComponent(url)}`);
      else router.push(`/(tabs)/search?q=${encodeURIComponent(item.title)}`);
    } finally {
      setResolvingId(null);
    }
  }, [resolvingId]);

  return { open, resolvingId };
}

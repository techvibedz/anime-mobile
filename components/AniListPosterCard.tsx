// AniList-sourced poster with resolve-on-tap — shared by the Related tab
// (app/anime/[id].tsx) and the home "مقترح لك" rail.
//
// AniList knows a title + artwork but not a playable source URL. Tapping the
// card resolves the title against the sources (lib/anilistResolve, which is
// cache-first and Jikan-free on the critical path), then opens the found
// anime's detail page; a spinner shows while resolving and a "not found" hint
// when no confident match exists.

import { useCallback, useState, type ReactNode } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { PosterCard } from "./PosterCard";
import { ABSOLUTE_FILL } from "../lib/theme";
import { t } from "../lib/i18n";
import { peekResolvedHref, resolveEntryToSource, type AniListResolveEntry } from "../lib/anilistResolve";
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
  const [resolving, setResolving] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const open = useCallback(async () => {
    if (resolving) return;
    // Already resolved before (cache or an earlier tap) — open immediately,
    // no spinner and no network.
    const cached = await peekResolvedHref(entry.anilistId);
    if (cached) {
      router.push(`/anime/${encodeURIComponent(cached)}`);
      return;
    }
    setResolving(true);
    setNotFound(false);
    try {
      const href = await resolveEntryToSource(entry);
      if (href) {
        router.push(`/anime/${encodeURIComponent(href)}`);
      } else {
        setNotFound(true);
        setTimeout(() => setNotFound(false), 2500);
      }
    } finally {
      setResolving(false);
    }
  }, [resolving, entry]);

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
      centerOverlay={
        (resolving || notFound) ? (
          <View style={s.overlay}>
            {resolving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="search-outline" size={18} color="#fff" />
                <Text style={s.overlayText}>{t.notFound}</Text>
              </>
            )}
          </View>
        ) : null
      }
    />
  );
}

const s = StyleSheet.create({
  overlay: {
    ...ABSOLUTE_FILL,
    backgroundColor: "rgba(10,10,11,0.72)",
    alignItems: "center", justifyContent: "center", gap: 6,
  },
  overlayText: { color: "#fff", fontSize: 10, fontWeight: "600", fontFamily: "Cairo_600SemiBold" },
});

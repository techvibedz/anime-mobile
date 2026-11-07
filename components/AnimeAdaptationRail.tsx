// Manga detail: "adapted as anime" rail (reverse of the anime → manga bridge).

import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AniListPosterCard } from "./AniListPosterCard";
import { RtlRow } from "./RtlRow";
import { findAnimeAdaptations, type AnimeAdaptation } from "../lib/mangaAdaptations";
import { M, MT } from "../lib/manga/design";
import { t } from "../lib/i18n";

const W = 104;

export function AnimeAdaptationRail({ titles }: { titles: string[] }) {
  const [items, setItems] = useState<AnimeAdaptation[]>([]);
  const titlesKey = titles.join("|");
  useEffect(() => {
    let alive = true;
    (async () => {
      for (const title of titles) {
        const found = await findAnimeAdaptations(title);
        if (!alive) return;
        if (found.length) {
          setItems(found);
          return;
        }
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titlesKey]);

  if (!items.length) return null;
  return (
    <View style={ss.wrap}>
      <View style={ss.head}>
        <Ionicons name="tv-outline" size={15} color={M.accent} />
        <Text style={ss.label}>{t.adaptedAsAnime}</Text>
      </View>
      <RtlRow contentContainerStyle={ss.rail}>
        {items.map((it) => (
          <View key={it.anilistId} style={ss.col}>
            <AniListPosterCard entry={it} width={W} titleLines={2} />
            <Text style={ss.meta} numberOfLines={1}>
              {[it.year, it.episodes ? t.episodeCount(it.episodes) : null].filter(Boolean).join(" · ")}
            </Text>
            {it.endChapter ? <Text style={ss.chapter} numberOfLines={1}>{t.adaptationUpTo(it.endChapter)}</Text> : null}
          </View>
        ))}
      </RtlRow>
    </View>
  );
}

const ss = StyleSheet.create({
  wrap: { marginTop: 24 },
  head: { direction: "ltr", flexDirection: "row-reverse", alignItems: "center", marginBottom: 10 },
  label: { ...MT.body, color: M.ink, fontFamily: "Cairo_700Bold", marginRight: 6, textAlign: "right" },
  rail: { paddingRight: 0 },
  col: { width: W, marginLeft: 10 },
  meta: { color: M.muted, fontSize: 10, fontFamily: "Cairo_500Medium", textAlign: "right", marginTop: 4 },
  chapter: { color: M.accent, fontSize: 10, fontFamily: "Cairo_600SemiBold", textAlign: "right" },
});

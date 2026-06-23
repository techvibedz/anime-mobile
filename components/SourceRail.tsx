// A source-direct home rail ("this season" / "movies"). Reads the source's own
// listing (lib/sourceRails) in one cheap GET and renders a horizontal poster
// rail. Each card already carries its real source URL, so tapping opens the
// anime detail page DIRECTLY — no AniList, no per-tap resolution.
//
// Performance: the load is DEFERRED + STAGGERED (per `order`) so the rails never
// compete with the home feed's initial render — they pop in a moment later,
// below the fold. A warm 12h disk cache makes repeat opens instant. Nothing
// animates while waiting, so it adds no work to the launch path.

import { memo, useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { getRail, type RailItem, type RailKind } from "../lib/sourceRails";
import { CatalogCard, type CatalogCardData } from "./CatalogCard";
import { C, S, R } from "../lib/theme";
import { t } from "../lib/i18n";

const PAD = S.paddingContent;
const CARD_W = 118;
const RAIL_SHOW = 18;

function toCard(item: RailItem): CatalogCardData {
  return { id: item.id, title: item.title, image: item.image, score: null, badge: null, href: item.href };
}

function openItem(item: RailItem) {
  router.push(`/anime/${encodeURIComponent(item.href)}`);
}

export const SourceRail = memo(function SourceRail({
  kind,
  title,
  order = 0,
}: {
  kind: RailKind;
  title: string;
  /** Display order (0-based) — used to stagger the cold data load. */
  order?: number;
}) {
  const [items, setItems] = useState<RailItem[] | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const delay = 1200 + order * 1200;
    const timer = setTimeout(async () => {
      const data = await getRail(kind).catch(() => [] as RailItem[]);
      if (mounted.current) setItems(data);
    }, delay);
    return () => { mounted.current = false; clearTimeout(timer); };
  }, [kind, order]);

  // Nothing yet, or source down → render nothing (no dead row, no shimmer CPU).
  if (items === null || items.length === 0) return null;

  const goAll = () => router.push(`/popular/${kind}?title=${encodeURIComponent(title)}`);

  return (
    <View style={s.section}>
      <View style={s.header}>
        <View style={s.titleRow}>
          <View style={s.tick} />
          <Text style={s.title}>{title}</Text>
        </View>
        <Pressable style={s.seeAllBtn} onPress={goAll}>
          <Text style={s.seeAllText}>{t.seeAllShort}</Text>
          <Ionicons name="chevron-back" size={12} color={C.accent} />
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: PAD, gap: 12 }}>
        {items.slice(0, RAIL_SHOW).map((item) => (
          <CatalogCard key={item.id} item={toCard(item)} width={CARD_W} onPress={() => openItem(item)} />
        ))}
        <Pressable style={s.seeAllCard} onPress={goAll}>
          <View style={s.seeAllCircle}>
            <Ionicons name="arrow-back" size={20} color={C.accent} />
          </View>
          <Text style={s.seeAllCardText}>{t.seeAllShort}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
});

const s = StyleSheet.create({
  section: { marginTop: S.xxl },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: PAD, marginBottom: 14,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  tick: {
    width: 3, height: 16, borderRadius: 2, backgroundColor: C.accent,
  },
  title: { color: C.text, fontSize: 20, fontWeight: "700", fontFamily: "Cairo_700Bold" },
  seeAllBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  seeAllText: { color: C.accent, fontSize: 11, fontWeight: "600", fontFamily: "Cairo_600SemiBold" },
  seeAllCard: {
    width: CARD_W, height: CARD_W * 1.5, borderRadius: R.lg,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    alignItems: "center", justifyContent: "center", gap: 8,
  },
  seeAllCircle: {
    width: 44, height: 44, borderRadius: R.circle,
    backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.borderAccent,
    alignItems: "center", justifyContent: "center",
  },
  seeAllCardText: { color: C.accent, fontSize: 12, fontWeight: "600", fontFamily: "Cairo_600SemiBold" },
});

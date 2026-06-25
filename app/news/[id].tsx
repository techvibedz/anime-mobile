// Anime News — article detail. The headline/snippet come from the list's
// in-memory registry (already fetched + translated); the FULL body + inline
// images are scraped from the MAL news page and translated on open
// (fetchNewsArticle). No browser redirect — the article reads in-app, in Arabic.

import { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, Linking } from "react-native";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { getNewsItem, fetchNewsArticle, type ArticleBlock } from "../../lib/news";
import { C, R, S, AR } from "../../lib/theme";
import { t } from "../../lib/i18n";
import { Aurora } from "../../components/ScreenChrome";

export default function NewsDetailScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const item = useMemo(() => getNewsItem(Number(id)), [id]);

  // undefined = loading · null = couldn't load (fall back to excerpt) · [] none.
  const [blocks, setBlocks] = useState<ArticleBlock[] | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    fetchNewsArticle(Number(id))
      .then((b) => alive && setBlocks(b))
      .catch(() => alive && setBlocks(null));
    return () => { alive = false; };
  }, [id]);

  const BackBtn = (
    <Pressable
      onPress={() => router.back()}
      hitSlop={8}
      style={({ pressed }) => [s.backBtn, { top: insets.top + 8 }, pressed && s.backBtnPressed]}
    >
      <Ionicons name="chevron-back" size={22} color={C.bone} />
    </Pressable>
  );

  if (!item) {
    return (
      <View style={[s.root, s.center, { paddingTop: insets.top }]}>
        <Aurora />
        {BackBtn}
        <View style={s.missingIcon}>
          <Ionicons name="newspaper-outline" size={36} color={C.accent} />
        </View>
        <Text style={s.missingTitle}>{t.newsNotFound}</Text>
        <Text style={s.missingSub}>{t.newsNotFoundSub}</Text>
        <Pressable onPress={() => router.replace("/news")} style={({ pressed }) => [s.missingBtn, pressed && { opacity: 0.9 }]}>
          <Text style={s.missingBtnText}>{t.newsBackToList}</Text>
        </Pressable>
      </View>
    );
  }

  const hasBody = Array.isArray(blocks) && blocks.length > 0;

  return (
    <View style={s.root}>
      <Aurora />
      {BackBtn}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 36 }}
      >
        {item.image ? (
          <View style={s.hero}>
            <Image source={{ uri: item.image }} style={StyleSheet.absoluteFill} contentFit="cover" transition={180} />
            <LinearGradient
              colors={["rgba(10,10,11,0.45)", "transparent", C.bg]}
              locations={[0, 0.45, 1]}
              style={StyleSheet.absoluteFill}
            />
          </View>
        ) : (
          <View style={{ height: insets.top + 56 }} />
        )}

        <View style={s.body}>
          <View style={s.meta}>
            <Text style={s.metaTime}>{t.newsTimeAgo(item.date)}</Text>
            <View style={s.metaDot} />
            <Text style={s.metaSource} numberOfLines={1}>{t.newsSource(item.animeTitle)}</Text>
          </View>

          <Text style={s.headline}>{item.title}</Text>

          <View style={s.divider} />

          {/* Full body once scraped+translated; otherwise the excerpt holds the
              space (and a spinner shows while the article is still loading). */}
          {hasBody ? (
            blocks!.map((b, i) =>
              b.type === "image" ? (
                <BodyImage key={`img-${i}`} uri={b.value} />
              ) : (
                <Text key={`txt-${i}`} style={s.paragraph}>{b.value}</Text>
              ),
            )
          ) : (
            <>
              {item.excerpt ? <Text style={s.paragraph}>{item.excerpt}</Text> : null}
              {blocks === undefined ? (
                <View style={s.loadingRow}>
                  <ActivityIndicator color={C.accent} />
                  <Text style={s.loadingText}>{t.loading}</Text>
                </View>
              ) : null}
            </>
          )}

          {item.url ? (
            <Pressable
              onPress={() => Linking.openURL(item.url).catch(() => {})}
              style={({ pressed }) => [s.sourceBtn, pressed && { opacity: 0.88 }]}
            >
              <Ionicons name="open-outline" size={16} color={C.text} />
              <Text style={s.sourceBtnText}>{t.newsOpenSource}</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

/* Full-width body image that sizes itself once loaded (MAL body images carry no
 * dimensions in the HTML, so we read them from the decode and set aspectRatio). */
function BodyImage({ uri }: { uri: string }) {
  const [ratio, setRatio] = useState(16 / 9);
  return (
    <Image
      source={{ uri }}
      style={[s.bodyImage, { aspectRatio: ratio }]}
      contentFit="cover"
      transition={150}
      onLoad={(e) => {
        const w = e?.source?.width;
        const h = e?.source?.height;
        if (w && h) setRatio(w / h);
      }}
    />
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 10 },

  backBtn: {
    position: "absolute", left: S.paddingContent, zIndex: 20,
    width: 42, height: 42, borderRadius: R.circle,
    backgroundColor: C.overlayMedium, borderWidth: 1, borderColor: C.glassBorder,
    alignItems: "center", justifyContent: "center",
  },
  backBtnPressed: { backgroundColor: C.surfaceLight, transform: [{ scale: 0.94 }] },

  hero: { height: 300, backgroundColor: C.surfaceLight },

  body: { paddingHorizontal: S.paddingContent, marginTop: -8 },
  meta: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8, marginBottom: 12 },
  metaTime: { color: C.ember, fontSize: 12, fontFamily: AR.semibold },
  metaDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: C.textFaint },
  metaSource: { color: C.textMuted, fontSize: 12, fontFamily: AR.medium, flexShrink: 1 },

  headline: { color: C.bone, fontSize: 24, lineHeight: 34, fontFamily: AR.bold, textAlign: "right", letterSpacing: -0.3 },

  divider: { height: 1, backgroundColor: C.border, marginVertical: 18 },

  paragraph: { color: C.textSoft, fontSize: 15, lineHeight: 29, fontFamily: AR.medium, textAlign: "right", marginBottom: 14 },
  bodyImage: { width: "100%", borderRadius: R.lg, backgroundColor: C.surfaceLight, marginVertical: 8 },

  loadingRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 18 },
  loadingText: { color: C.textSecondary, fontSize: 13, fontFamily: AR.medium },

  sourceBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    marginTop: 26, paddingVertical: 13, borderRadius: R.pill,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
  },
  sourceBtnText: { color: C.text, fontSize: 13.5, fontFamily: AR.semibold },

  missingIcon: {
    width: 84, height: 84, borderRadius: 42, backgroundColor: C.glass,
    borderWidth: 1, borderColor: C.glassBorder, alignItems: "center", justifyContent: "center", marginBottom: 6,
  },
  missingTitle: { color: C.text, fontSize: 18, fontFamily: AR.bold, textAlign: "center" },
  missingSub: { color: C.textSecondary, fontSize: 13, lineHeight: 21, textAlign: "center", maxWidth: 300, fontFamily: AR.medium },
  missingBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: C.accent, borderRadius: R.pill, paddingHorizontal: 22, paddingVertical: 13, marginTop: 10,
  },
  missingBtnText: { color: C.textOnAccent, fontSize: 14, fontFamily: AR.bold },
});

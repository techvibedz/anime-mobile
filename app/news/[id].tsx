// Anime News — article detail. The headline/snippet come from the list's
// in-memory registry (already fetched + translated); the FULL body + inline
// images are scraped from the MAL news page and translated on open
// (fetchNewsArticle). No browser redirect — the article reads in-app, in Arabic.

import { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { WebView } from "react-native-webview";
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
            {item.tags ? (
              <>
                <View style={s.metaDot} />
                <Text style={s.metaSource} numberOfLines={1}>{item.tags}</Text>
              </>
            ) : null}
          </View>

          <Text style={s.headline}>{item.title}</Text>

          <View style={s.divider} />

          {/* Full body once scraped+translated — text, inline images and
              trailers all render in-app. A spinner shows while loading. */}
          {hasBody ? (
            blocks!.map((b, i) =>
              b.type === "image" ? (
                <BodyImage key={`img-${i}`} uri={b.value} />
              ) : b.type === "video" ? (
                <BodyVideo key={`vid-${i}`} uri={b.value} />
              ) : (
                <Text key={`txt-${i}`} style={s.paragraph}>{b.value}</Text>
              ),
            )
          ) : blocks === undefined ? (
            <View style={s.loadingRow}>
              <ActivityIndicator color={C.accent} />
              <Text style={s.loadingText}>{t.loading}</Text>
            </View>
          ) : (
            <Text style={s.paragraph}>{t.newsNotFoundSub}</Text>
          )}
        </View>
      </ScrollView>

      {/* Floating back button — rendered AFTER the ScrollView with a high
          zIndex/elevation so the hero image and the native WebView player can
          never paint over it (Android draws later, more-elevated siblings on
          top). The WebView itself is also zoom-locked + CSS-clipped so it
          can't escape its bounds and cover this button. */}
      {BackBtn}
    </View>
  );
}

/* In-app trailer player — the article's YouTube embed in a 16:9 WebView, so
 * the video plays inside the app instead of pushing the user out.
 *
 * The embed is wrapped in a tiny HTML page loaded with an https base URL:
 * loading the embed URL directly as the WebView's document sends NO Referer,
 * and YouTube rejects referrer-less embeds with "Video player configuration
 * error" (error 153). With a real https origin the iframe request carries a
 * Referer again and playback works.
 *
 * Three extra constraints keep the player healthy on Android:
 *  • referrerpolicy="strict-origin" — YouTube's current embed guidance; the
 *    cross-origin variant can trigger error 152 ("video unavailable").
 *  • A plain Chrome mobile userAgent — the stock WebView UA ("; wv)") is
 *    treated as an untrusted client and also fails with 152-x.
 *  • Zoom locked (viewport + setSupportZoom/scalesPageToFit off) — a zoomed
 *    WebView inside the rounded, clipped container escapes its bounds on
 *    Android and paints over sibling UI (it covered the floating back
 *    button). Overflow is hidden in CSS for the same reason. */
function BodyVideo({ uri }: { uri: string }) {
  // uri is built by parseArticle from a validated video id — safe to inline.
  const html = `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>html,body{margin:0;padding:0;background:#000;width:100%;height:100%;overflow:hidden}
iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:0}</style>
</head><body>
<iframe
  src="${uri}"
  allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
  referrerpolicy="strict-origin"
  allowfullscreen></iframe>
</body></html>`;
  return (
    <View style={s.bodyVideo}>
      <WebView
        source={{ html, baseUrl: "https://www.youtube-nocookie.com" }}
        style={s.bodyVideoInner}
        userAgent="Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"
        allowsFullscreenVideo
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled={false}
        setSupportZoom={false}
        scalesPageToFit={false}
      />
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
    position: "absolute", left: S.paddingContent, zIndex: 40, elevation: 40,
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
  bodyVideo: { width: "100%", aspectRatio: 16 / 9, borderRadius: R.lg, overflow: "hidden", backgroundColor: "#000", marginVertical: 8 },
  bodyVideoInner: { flex: 1, backgroundColor: "transparent" },

  loadingRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 18 },
  loadingText: { color: C.textSecondary, fontSize: 13, fontFamily: AR.medium },

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

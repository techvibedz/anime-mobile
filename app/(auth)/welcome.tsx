import { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { C, R, ABSOLUTE_FILL, ELEVATION_GLOW } from "../../lib/theme";
import { t } from "../../lib/i18n";
import { fetchHome } from "../../lib/api";
import { fetchPopularAnime } from "../../lib/seasons";
import { posterUrl } from "../../lib/img";

const APP_LOGO = require("../../assets/icon.png");
const WALL_COLS = 4;
const WALL_ROWS = 4;

/** Poster wall artwork: the most popular anime of all time (AniList, cached),
 *  so first-time visitors see titles they recognise. Falls back to the home
 *  feed's posters if AniList is unreachable. */
function useWallPosters(): string[] {
  const [posters, setPosters] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    const take = (urls: (string | null | undefined)[]) =>
      [...new Set(urls.filter((u): u is string => !!u))].slice(0, WALL_COLS * WALL_ROWS);
    fetchPopularAnime("all_time")
      .then((items) => take(items.map((i) => i.image)))
      .catch(() => [] as string[])
      .then(async (urls) => {
        if (urls.length >= WALL_COLS * 2) return urls;
        const res = await fetchHome().catch(() => null);
        return res?.success ? take((res.data.sections ?? []).flatMap((s) => s.items.map((i) => i.image))) : urls;
      })
      .then((urls) => { if (alive) setPosters(urls); });
    return () => { alive = false; };
  }, []);
  return posters;
}

export default function Welcome() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const posters = useWallPosters();
  const tileW = width / 3.9;
  const wallH = height * 0.56;

  return (
    <View style={ss.root}>
      {/* Poster wall — real artwork, tilted, fading into the canvas. */}
      <View style={[ss.wall, { height: wallH }]} pointerEvents="none">
        <View style={[ss.wallGrid, { width: (tileW + 10) * WALL_COLS + 2, left: -tileW * 0.3, top: -tileW * 0.6 }]}>
          {posters.map((uri, i) => (
            <Image
              key={uri}
              source={{ uri: posterUrl(uri, tileW) }}
              style={[ss.tile, { width: tileW, height: tileW * 1.5, marginTop: i % 2 ? tileW * 0.4 : 0 }]}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={400}
            />
          ))}
        </View>
        <LinearGradient
          colors={["rgba(8,9,12,0.35)", "rgba(8,9,12,0.55)", C.bg]}
          locations={[0, 0.55, 1]}
          style={ABSOLUTE_FILL}
        />
        <LinearGradient
          colors={["rgba(139,147,255,0.24)", "rgba(139,147,255,0)"]}
          locations={[0, 0.7]}
          style={ABSOLUTE_FILL}
        />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[ss.content, { paddingTop: wallH - 150, paddingBottom: insets.bottom + 24 }]}
      >
        {/* Brand */}
        <View style={ss.brand}>
          <Image source={APP_LOGO} style={ss.logo} contentFit="cover" accessibilityLabel={t.appName} />
          <Text style={ss.wordmark}>Pantoufa</Text>
          <Text style={ss.tagline}>{t.welcomeTagline}</Text>
        </View>

        {/* Feature chips */}
        <View style={ss.features}>
          {[
            { icon: "cloud-done" as const, text: t.feature1 },
            { icon: "heart" as const, text: t.feature2 },
            { icon: "shield-checkmark" as const, text: t.feature3 },
          ].map((f) => (
            <View key={f.text} style={ss.featureRow}>
              <View style={ss.featureIcon}>
                <Ionicons name={f.icon} size={16} color={C.accent} />
              </View>
              <Text style={ss.featureText}>{f.text}</Text>
            </View>
          ))}
        </View>

        {/* CTAs */}
        <View style={ss.cta}>
          <Pressable
            style={({ pressed }) => [ss.btnPrimary, pressed && ss.pressed]}
            onPress={() => router.push("/(auth)/register")}
            accessibilityRole="button"
          >
            <Text style={ss.btnPrimaryText}>{t.ctaCreate}</Text>
            <Ionicons name="arrow-back" size={20} color={C.textOnAccent} />
          </Pressable>

          <Pressable
            style={({ pressed }) => [ss.btnSecondary, pressed && ss.pressed]}
            onPress={() => router.push("/(auth)/login")}
            accessibilityRole="button"
          >
            <Text style={ss.btnSecondaryText}>{t.ctaHaveAccount}</Text>
            <Ionicons name="log-in-outline" size={18} color={C.bone} />
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const ss = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: { flexGrow: 1, paddingHorizontal: 28, justifyContent: "flex-end" },

  wall: { position: "absolute", top: 0, left: 0, right: 0, overflow: "hidden" },
  wallGrid: {
    position: "absolute", flexDirection: "row", flexWrap: "wrap",
    transform: [{ rotate: "-10deg" }],
  },
  tile: { borderRadius: R.lg, margin: 5, backgroundColor: C.surface },

  brand: { alignItems: "flex-end", marginBottom: 28 },
  logo: {
    width: 76, height: 76, borderRadius: 22, marginBottom: 18,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.14)",
    ...ELEVATION_GLOW,
  },
  wordmark: {
    color: C.bone, fontSize: 44, lineHeight: 52, letterSpacing: -1.5,
    fontFamily: "Outfit_900Black",
  },
  tagline: {
    color: C.textSecondary, fontSize: 18, lineHeight: 30, marginTop: 4,
    fontFamily: "Cairo_600SemiBold", textAlign: "right",
  },

  features: { marginBottom: 32, gap: 12 },
  // row-reverse: icon on the right (reading edge); margins, not gap.
  featureRow: { flexDirection: "row-reverse", alignItems: "center" },
  featureIcon: {
    width: 34, height: 34, borderRadius: R.circle, marginLeft: 12,
    alignItems: "center", justifyContent: "center",
    backgroundColor: C.accentSoft,
  },
  featureText: {
    color: C.textSoft, fontSize: 14, lineHeight: 24, flex: 1,
    fontFamily: "Cairo_500Medium", textAlign: "right",
  },

  cta: { gap: 12 },
  btnPrimary: {
    flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 8,
    minHeight: 56, borderRadius: R.pill, backgroundColor: C.accent,
    ...ELEVATION_GLOW,
  },
  btnPrimaryText: { color: C.textOnAccent, fontSize: 16, lineHeight: 26, fontFamily: "Cairo_700Bold" },
  btnSecondary: {
    flexDirection: "row-reverse", alignItems: "center", justifyContent: "center", gap: 8,
    minHeight: 56, borderRadius: R.pill,
    backgroundColor: "rgba(255,255,255,0.07)", borderWidth: 1, borderColor: "rgba(255,255,255,0.14)",
  },
  btnSecondaryText: { color: C.bone, fontSize: 15, fontFamily: "Cairo_600SemiBold" },
  pressed: { opacity: 0.88, transform: [{ scale: 0.98 }] },
});

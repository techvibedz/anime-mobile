// The shareable Pantoufa Wrapped card (9:16 story format). Rendered in the
// /wrapped screen and captured as a PNG for sharing; the web share page
// (landing/functions/w) mirrors this layout from the published payload.

import { forwardRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { C } from "../lib/theme";
import { t } from "../lib/i18n";
import { posterUrl } from "../lib/img";
import { GENRE_AR } from "../lib/wrapped";
import type { WrappedStats } from "../lib/wrappedCore";

export const PERSONALITY_GLYPH: Record<string, string> = {
  night_owl: "🦉", marathoner: "🏃", completer: "🏆", explorer: "🧭", loyal: "💞", weekend: "🎉", fan: "✨",
};

export const WrappedCard = forwardRef<View, {
  stats: WrappedStats;
  name: string;
  genres: string[];
  width: number;
}>(function WrappedCard({ stats, name, genres, width }, ref) {
  const height = Math.round(width * 16 / 9);
  const hours = Math.floor(stats.minutes / 60);
  const maxMonth = Math.max(1, ...stats.months);
  const p = stats.personality;
  const s = width / 360; // scale everything off a 360-wide design
  return (
    <View ref={ref} collapsable={false} style={[ss.card, { width, height, borderRadius: 26 * s }]}>
      <LinearGradient
        colors={["#191B3A", "#0C0D18", "#08090C"]}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={[ss.glow, { width: 260 * s, height: 260 * s, borderRadius: 130 * s, top: -70 * s, right: -60 * s }]} />
      <View style={[ss.glowMint, { width: 200 * s, height: 200 * s, borderRadius: 100 * s, bottom: 40 * s, left: -70 * s }]} />

      <View style={{ padding: 20 * s, flex: 1 }}>
        <Text style={[ss.kicker, { fontSize: 11 * s }]}>PANTOUFA WRAPPED · {stats.year}</Text>
        <Text style={[ss.name, { fontSize: 15 * s, marginTop: 2 * s }]} numberOfLines={1}>{name || t.wrappedYou}</Text>

        <View style={{ marginTop: 12 * s, alignItems: "flex-end" }}>
          <Text style={[ss.big, { fontSize: 56 * s, lineHeight: 62 * s }]}>{hours > 0 ? hours : stats.minutes}</Text>
          <Text style={[ss.bigLabel, { fontSize: 15 * s }]}>{hours > 0 ? t.wrappedHours : t.wrappedMinutes}</Text>
        </View>

        <View style={[ss.statRow, { marginTop: 12 * s }]}>
          <Stat n={stats.episodes} label={t.wrappedEpisodes} s={s} />
          <Stat n={stats.animeCount} label={t.wrappedAnime} s={s} />
          <Stat n={stats.completedAnime} label={t.wrappedCompleted} s={s} />
          <Stat n={stats.longestStreak} label={t.wrappedStreak} s={s} />
        </View>

        <View style={[ss.persona, { marginTop: 12 * s, padding: 10 * s, borderRadius: 18 * s }]}>
          <Text style={{ fontSize: 30 * s, marginLeft: 10 * s }}>{PERSONALITY_GLYPH[p] ?? "✨"}</Text>
          <View style={{ flex: 1, alignItems: "flex-end" }}>
            <Text style={[ss.personaTitle, { fontSize: 17 * s }]}>{t.wrappedPersonality[p] ?? t.wrappedPersonality.fan}</Text>
            <Text style={[ss.personaDesc, { fontSize: 11.5 * s }]} numberOfLines={2}>{t.wrappedPersonalityDesc(p, stats)}</Text>
          </View>
        </View>

        {stats.top.length > 0 && (
          <View style={{ marginTop: 12 * s }}>
            <Text style={[ss.section, { fontSize: 12 * s }]}>{t.wrappedTop}</Text>
            {stats.top.slice(0, 3).map((a, i) => (
              <View key={a.href || a.title} style={[ss.topRow, { marginTop: 6 * s }]}>
                <Text style={[ss.rank, { fontSize: 18 * s, width: 22 * s }]}>{i + 1}</Text>
                {a.image ? (
                  <Image
                    source={{ uri: posterUrl(a.image, 90) }}
                    style={{ width: 30 * s, height: 42 * s, borderRadius: 6 * s, marginLeft: 10 * s }}
                    contentFit="cover"
                  />
                ) : null}
                <View style={{ flex: 1, alignItems: "flex-end" }}>
                  <Text style={[ss.topTitle, { fontSize: 13 * s }]} numberOfLines={1}>{a.title}</Text>
                  <Text style={[ss.topMeta, { fontSize: 10.5 * s }]}>{t.episodeCount(a.episodes)}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {genres.length > 0 && (
          <View style={[ss.genres, { marginTop: 10 * s }]}>
            {genres.map((g) => (
              <View key={g} style={[ss.genre, { paddingHorizontal: 10 * s, paddingVertical: 4 * s, borderRadius: 20 * s, marginLeft: 6 * s }]}>
                <Text style={[ss.genreText, { fontSize: 11 * s }]}>{GENRE_AR[g] ?? g}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={{ flex: 1 }} />

        <View style={[ss.months, { height: 34 * s, marginTop: 8 * s }]}>
          {stats.months.map((m, i) => (
            <View key={i} style={{ flex: 1, alignItems: "center", justifyContent: "flex-end" }}>
              <View
                style={{
                  width: "62%",
                  height: Math.max(2 * s, (m / maxMonth) * 30 * s),
                  borderRadius: 3 * s,
                  backgroundColor: i === stats.topMonth ? C.mint : "rgba(139,147,255,0.55)",
                }}
              />
            </View>
          ))}
        </View>
        <View style={[ss.footer, { marginTop: 10 * s }]}>
          <Text style={[ss.brand, { fontSize: 14 * s }]}>بانتوفة</Text>
          <Text style={[ss.site, { fontSize: 10 * s }]}>pantoufa-join.pages.dev</Text>
        </View>
      </View>
    </View>
  );
});

function Stat({ n, label, s }: { n: number; label: string; s: number }) {
  return (
    <View style={{ flex: 1, alignItems: "center" }}>
      <Text style={[ss.statN, { fontSize: 22 * s }]}>{n}</Text>
      <Text style={[ss.statLabel, { fontSize: 10 * s }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const ss = StyleSheet.create({
  card: { overflow: "hidden", backgroundColor: "#08090C" },
  glow: { position: "absolute", backgroundColor: "rgba(139,147,255,0.22)" },
  glowMint: { position: "absolute", backgroundColor: "rgba(94,234,212,0.12)" },
  kicker: { color: C.mint, fontFamily: "Outfit_700Bold", letterSpacing: 1.5, textAlign: "right" },
  name: { color: "rgba(255,255,255,0.75)", fontFamily: "Cairo_600SemiBold", textAlign: "right" },
  big: { color: "#FFFFFF", fontFamily: "Outfit_900Black", textAlign: "right" },
  bigLabel: { color: "#C9CCFF", fontFamily: "Cairo_700Bold", textAlign: "right" },
  statRow: { direction: "ltr", flexDirection: "row-reverse" },
  statN: { color: "#FFFFFF", fontFamily: "Outfit_800ExtraBold" },
  statLabel: { color: "rgba(255,255,255,0.6)", fontFamily: "Cairo_600SemiBold" },
  persona: {
    direction: "ltr", flexDirection: "row-reverse", alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)",
  },
  personaTitle: { color: "#FFFFFF", fontFamily: "Cairo_700Bold", textAlign: "right" },
  personaDesc: { color: "rgba(255,255,255,0.65)", fontFamily: "Cairo_500Medium", textAlign: "right" },
  section: { color: "rgba(255,255,255,0.55)", fontFamily: "Cairo_700Bold", textAlign: "right" },
  topRow: { direction: "ltr", flexDirection: "row-reverse", alignItems: "center" },
  rank: { color: C.mint, fontFamily: "Outfit_900Black", textAlign: "center" },
  topTitle: { color: "#FFFFFF", fontFamily: "Cairo_700Bold", textAlign: "right" },
  topMeta: { color: "rgba(255,255,255,0.55)", fontFamily: "Cairo_500Medium", textAlign: "right" },
  genres: { direction: "ltr", flexDirection: "row-reverse", flexWrap: "wrap" },
  genre: { backgroundColor: "rgba(139,147,255,0.18)", borderWidth: 1, borderColor: "rgba(139,147,255,0.35)" },
  genreText: { color: "#D9DBFF", fontFamily: "Cairo_600SemiBold" },
  months: { direction: "ltr", flexDirection: "row", alignItems: "flex-end" },
  footer: { direction: "ltr", flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between" },
  brand: { color: "#FFFFFF", fontFamily: "Cairo_700Bold" },
  site: { color: "rgba(255,255,255,0.45)", fontFamily: "Outfit_600SemiBold" },
});

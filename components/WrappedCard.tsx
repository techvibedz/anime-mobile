// The shareable Pantoufa Wrapped card. Rendered in the /wrapped screen and
// captured as a PNG for sharing; the web share page (landing/functions/w)
// renders the same data from the published payload.
//
// Layout is content-driven (min 9:16, grows when titles/names run long) so
// nothing is ever clipped, and every row is built RTL-safe: direction "ltr" +
// row-reverse with margins — never `gap` with row-reverse (RN 0.81 Yoga bug).

import { forwardRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { C } from "../lib/theme";
import { t } from "../lib/i18n";
import { posterUrl } from "../lib/img";
import { GENRE_AR } from "../lib/wrapped";
import type { WrappedStats } from "../lib/wrappedCore";

export const PERSONALITY_GLYPH: Record<string, string> = {
  night_owl: "🦉", marathoner: "🏃", completer: "🏆", explorer: "🧭", loyal: "💞", weekend: "🎉", fan: "✨",
};

const AR_MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const PERI = "#8B93FF";
const MINT = "#5EEAD4";

type IconName = keyof typeof Ionicons.glyphMap;

export const WrappedCard = forwardRef<View, {
  stats: WrappedStats;
  name: string;
  genres: string[];
  width: number;
}>(function WrappedCard({ stats, name, genres, width }, ref) {
  const s = width / 360; // everything scales off a 360-wide design
  const minHeight = Math.round(width * 16 / 9);
  const hours = Math.floor(stats.minutes / 60);
  const showHours = hours > 0;
  const maxMonth = Math.max(1, ...stats.months);
  const p = stats.personality;
  const top = stats.top.slice(0, 3);
  const backdrop = top.find((a) => a.image)?.image;
  const pad = 20 * s;
  const posterW = Math.floor((width - pad * 2 - 2 * 10 * s) / 3);

  return (
    <View ref={ref} collapsable={false} style={[ss.card, { width, minHeight, borderRadius: 28 * s }]}>
      {/* Backdrop: the year's #1 anime, blurred into a colour wash. */}
      {backdrop ? (
        <Image
          source={{ uri: posterUrl(backdrop, 200) }}
          style={[StyleSheet.absoluteFill, { opacity: 0.55 }]}
          contentFit="cover"
          blurRadius={28}
        />
      ) : null}
      <LinearGradient
        colors={["rgba(24,26,58,0.35)", "rgba(10,11,22,0.85)", "#08090C", "#08090C"]}
        locations={[0, 0.32, 0.62, 1]}
        style={StyleSheet.absoluteFill}
      />

      <View style={{ padding: pad, flexGrow: 1 }}>
        {/* Header */}
        <View style={ss.rowRev}>
          <View style={[ss.yearChip, { paddingHorizontal: 10 * s, paddingVertical: 4 * s, borderRadius: 20 * s }]}>
            <Text style={[ss.yearChipText, { fontSize: 11 * s }]}>WRAPPED {stats.year}</Text>
          </View>
          <View style={{ flex: 1 }} />
          <Text style={[ss.brandTop, { fontSize: 15 * s }]}>بانتوفة</Text>
        </View>
        <Text style={[ss.name, { fontSize: 14 * s, marginTop: 14 * s }]} numberOfLines={1}>
          {name ? `سنة ${name} في الأنمي` : t.wrappedTitle}
        </Text>

        {/* Hero number */}
        <View style={{ alignItems: "flex-end", marginTop: 2 * s }}>
          <Text style={[ss.big, { fontSize: 88 * s, lineHeight: 96 * s }]} numberOfLines={1} adjustsFontSizeToFit>
            {showHours ? hours : Math.round(stats.minutes)}
          </Text>
          <Text style={[ss.bigLabel, { fontSize: 17 * s, lineHeight: 26 * s }]}>
            {showHours ? t.wrappedHours : t.wrappedMinutes}
          </Text>
        </View>

        {/* Stats 2×2 */}
        <View style={[ss.rowRev, { marginTop: 16 * s }]}>
          <Tile icon="play" n={stats.episodes} label={t.wrappedEpisodes} s={s} tint={PERI} />
          <View style={{ width: 10 * s }} />
          <Tile icon="albums" n={stats.animeCount} label={t.wrappedAnime} s={s} tint={MINT} />
        </View>
        <View style={[ss.rowRev, { marginTop: 10 * s }]}>
          <Tile icon="checkmark-done" n={stats.completedAnime} label={t.wrappedCompleted} s={s} tint="#7CE38B" />
          <View style={{ width: 10 * s }} />
          <Tile icon="flame" n={stats.longestStreak} label={t.wrappedStreak} s={s} tint="#FFB86B" />
        </View>

        {/* Personality */}
        <View style={[ss.persona, { marginTop: 14 * s, padding: 12 * s, borderRadius: 20 * s }]}>
          <View style={[ss.glyphWrap, { width: 48 * s, height: 48 * s, borderRadius: 16 * s, marginLeft: 12 * s }]}>
            <Text style={{ fontSize: 26 * s, lineHeight: 34 * s }}>{PERSONALITY_GLYPH[p] ?? "✨"}</Text>
          </View>
          <View style={{ flex: 1, alignItems: "flex-end" }}>
            <Text style={[ss.personaKicker, { fontSize: 10.5 * s }]}>شخصيتك كمشاهد</Text>
            <Text style={[ss.personaTitle, { fontSize: 18 * s, lineHeight: 28 * s }]} numberOfLines={1}>
              {t.wrappedPersonality[p] ?? t.wrappedPersonality.fan}
            </Text>
            <Text style={[ss.personaDesc, { fontSize: 11.5 * s, lineHeight: 18 * s }]} numberOfLines={2}>
              {t.wrappedPersonalityDesc(p, stats)}
            </Text>
          </View>
        </View>

        {/* Top 3 — poster podium, #1 on the right (reading start) */}
        {top.length > 0 && (
          <View style={{ marginTop: 16 * s }}>
            <Text style={[ss.section, { fontSize: 12.5 * s, marginBottom: 8 * s }]}>{t.wrappedTop}</Text>
            <View style={ss.rowRev}>
              {top.map((a, i) => (
                <View key={a.href || a.title} style={{ width: posterW, marginLeft: i < top.length - 1 ? 10 * s : 0 }}>
                  <View style={[ss.poster, { width: posterW, height: posterW * 1.42, borderRadius: 14 * s }, i === 0 && ss.posterFirst]}>
                    {a.image ? (
                      <Image source={{ uri: posterUrl(a.image, posterW) }} style={StyleSheet.absoluteFill} contentFit="cover" />
                    ) : (
                      <View style={[StyleSheet.absoluteFill, ss.posterFallback]}>
                        <Ionicons name="film-outline" size={22 * s} color="rgba(255,255,255,0.4)" />
                      </View>
                    )}
                    <LinearGradient colors={["transparent", "rgba(0,0,0,0.75)"]} style={ss.posterScrim} />
                    <View style={[ss.rankBadge, { width: 24 * s, height: 24 * s, borderRadius: 12 * s, top: 6 * s, right: 6 * s }, i === 0 && ss.rankBadgeFirst]}>
                      <Text style={[ss.rankText, { fontSize: 12 * s }]}>{i + 1}</Text>
                    </View>
                    <Text style={[ss.posterEps, { fontSize: 10 * s, bottom: 6 * s, left: 8 * s, right: 8 * s }]} numberOfLines={1}>
                      {t.episodeCount(a.episodes)}
                    </Text>
                  </View>
                  <Text style={[ss.topTitle, { fontSize: 11.5 * s, lineHeight: 17 * s, marginTop: 6 * s }]} numberOfLines={2}>
                    {a.title}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Genres */}
        {genres.length > 0 && (
          <View style={[ss.genres, { marginTop: 12 * s }]}>
            {genres.slice(0, 4).map((g) => (
              <View key={g} style={[ss.genre, { paddingHorizontal: 11 * s, paddingVertical: 3 * s, borderRadius: 20 * s, marginLeft: 6 * s, marginTop: 6 * s }]}>
                <Text style={[ss.genreText, { fontSize: 11 * s, lineHeight: 18 * s }]}>{GENRE_AR[g] ?? g}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={{ flexGrow: 1, minHeight: 12 * s }} />

        {/* Month activity */}
        <View style={[ss.chartBox, { padding: 12 * s, borderRadius: 18 * s }]}>
          <View style={[ss.rowRev, { alignItems: "center", marginBottom: 8 * s }]}>
            <Text style={[ss.section, { fontSize: 12 * s }]}>نشاطك على مدار السنة</Text>
            <View style={{ flex: 1 }} />
            {stats.topMonth != null ? (
              <Text style={[ss.peak, { fontSize: 11 * s }]} numberOfLines={1}>الذروة: {AR_MONTHS[stats.topMonth]}</Text>
            ) : null}
          </View>
          <View style={[ss.bars, { height: 44 * s }]}>
            {stats.months.map((m, i) => {
              const peak = i === stats.topMonth;
              return (
                <View key={i} style={ss.barCol}>
                  <View
                    style={{
                      width: "58%",
                      height: m > 0 ? Math.max(5 * s, (m / maxMonth) * 44 * s) : 3 * s,
                      borderRadius: 4 * s,
                      backgroundColor: peak ? MINT : m > 0 ? "rgba(139,147,255,0.7)" : "rgba(255,255,255,0.10)",
                    }}
                  />
                </View>
              );
            })}
          </View>
          <View style={[ss.bars, { marginTop: 4 * s }]}>
            {stats.months.map((_, i) => (
              <Text key={i} style={[ss.monthNum, { fontSize: 9 * s }, i === stats.topMonth && { color: MINT }]}>{i + 1}</Text>
            ))}
          </View>
        </View>

        {/* Footer */}
        <View style={[ss.rowRev, { alignItems: "center", marginTop: 12 * s }]}>
          <Text style={[ss.footBrand, { fontSize: 12 * s }]}>شاهد معنا على بانتوفة</Text>
          <View style={{ flex: 1 }} />
          <Text style={[ss.site, { fontSize: 10 * s }]}>pantoufa-join.pages.dev</Text>
        </View>
      </View>
    </View>
  );
});

function Tile({ icon, n, label, s, tint }: { icon: IconName; n: number; label: string; s: number; tint: string }) {
  return (
    <View style={[ss.tile, { padding: 10 * s, borderRadius: 16 * s }]}>
      <View style={[ss.tileIcon, { width: 34 * s, height: 34 * s, borderRadius: 11 * s, marginLeft: 10 * s, backgroundColor: tint + "26" }]}>
        <Ionicons name={icon} size={17 * s} color={tint} />
      </View>
      <View style={{ flex: 1, alignItems: "flex-end" }}>
        <Text style={[ss.tileN, { fontSize: 22 * s, lineHeight: 26 * s }]} numberOfLines={1} adjustsFontSizeToFit>{n}</Text>
        <Text style={[ss.tileLabel, { fontSize: 11 * s, lineHeight: 17 * s }]} numberOfLines={1}>{label}</Text>
      </View>
    </View>
  );
}

const ss = StyleSheet.create({
  card: { overflow: "hidden", backgroundColor: "#08090C" },
  rowRev: { direction: "ltr", flexDirection: "row-reverse", alignItems: "flex-start" },
  yearChip: { backgroundColor: "rgba(94,234,212,0.14)", borderWidth: 1, borderColor: "rgba(94,234,212,0.35)" },
  yearChipText: { color: MINT, fontFamily: "Outfit_700Bold", letterSpacing: 1.6 },
  brandTop: { color: "#FFFFFF", fontFamily: "Cairo_700Bold" },
  name: { color: "rgba(255,255,255,0.72)", fontFamily: "Cairo_600SemiBold", textAlign: "right" },
  big: { color: "#FFFFFF", fontFamily: "Outfit_900Black", textAlign: "right", includeFontPadding: false },
  bigLabel: { color: "#C9CCFF", fontFamily: "Cairo_700Bold", textAlign: "right" },
  tile: {
    flex: 1, direction: "ltr", flexDirection: "row-reverse", alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.09)",
  },
  tileIcon: { alignItems: "center", justifyContent: "center" },
  tileN: { color: "#FFFFFF", fontFamily: "Outfit_800ExtraBold", textAlign: "right" },
  tileLabel: { color: "rgba(255,255,255,0.6)", fontFamily: "Cairo_600SemiBold", textAlign: "right" },
  persona: {
    direction: "ltr", flexDirection: "row-reverse", alignItems: "center",
    backgroundColor: "rgba(139,147,255,0.12)", borderWidth: 1, borderColor: "rgba(139,147,255,0.32)",
  },
  glyphWrap: { alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)" },
  personaKicker: { color: MINT, fontFamily: "Cairo_700Bold", textAlign: "right" },
  personaTitle: { color: "#FFFFFF", fontFamily: "Cairo_700Bold", textAlign: "right" },
  personaDesc: { color: "rgba(255,255,255,0.68)", fontFamily: "Cairo_500Medium", textAlign: "right" },
  section: { color: "rgba(255,255,255,0.6)", fontFamily: "Cairo_700Bold", textAlign: "right" },
  poster: { overflow: "hidden", backgroundColor: "#15161D", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" },
  posterFirst: { borderColor: MINT, borderWidth: 1.5 },
  posterFallback: { alignItems: "center", justifyContent: "center" },
  posterScrim: { position: "absolute", left: 0, right: 0, bottom: 0, height: "45%" },
  rankBadge: { position: "absolute", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(8,9,12,0.8)" },
  rankBadgeFirst: { backgroundColor: MINT },
  rankText: { color: "#FFFFFF", fontFamily: "Outfit_900Black", includeFontPadding: false },
  posterEps: { position: "absolute", color: "#FFFFFF", fontFamily: "Cairo_600SemiBold", textAlign: "right" },
  topTitle: { color: "#FFFFFF", fontFamily: "Cairo_700Bold", textAlign: "right" },
  genres: { direction: "ltr", flexDirection: "row-reverse", flexWrap: "wrap" },
  genre: { backgroundColor: "rgba(139,147,255,0.16)", borderWidth: 1, borderColor: "rgba(139,147,255,0.32)" },
  genreText: { color: "#D9DBFF", fontFamily: "Cairo_600SemiBold" },
  chartBox: { backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  peak: { color: MINT, fontFamily: "Cairo_700Bold" },
  // Months run right→left (January at the reading start).
  bars: { direction: "ltr", flexDirection: "row-reverse", alignItems: "flex-end" },
  barCol: { flex: 1, alignItems: "center", justifyContent: "flex-end", height: "100%" },
  monthNum: { flex: 1, textAlign: "center", color: "rgba(255,255,255,0.4)", fontFamily: "Outfit_600SemiBold" },
  footBrand: { color: "rgba(255,255,255,0.85)", fontFamily: "Cairo_700Bold" },
  site: { color: "rgba(255,255,255,0.45)", fontFamily: "Outfit_600SemiBold" },
});

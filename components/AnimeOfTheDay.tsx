// "أنمي اليوم" — a deterministic daily pick from the current season's AniList
// catalogue, verified against its source page BEFORE it is shown. When no
// seasonal candidate verifies (new season not yet on the sources), it falls
// back to an anime taken straight from the sources' own top list, so the card
// never just disappears. Tapping always opens a pre-resolved source href.

import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Share, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Rise } from "./Rise";
import { C, R, TAr } from "../lib/theme";
import { t } from "../lib/i18n";
import { currentSeason, fetchSeasonAnime, type CatalogAnime } from "../lib/seasons";
import { localDayKey, orderDailyPool, pickIndexOfTheDay } from "../lib/dailyPick";
import { peekResolvedHref, resolveEntryToSource, forgetResolvedHref } from "../lib/anilistResolve";
import {
  fetchEpisodes,
  fetchHome,
  type AnimeDetail,
  type AnimeItem,
  type EpisodeItem,
} from "../lib/api";
import { posterUrl } from "../lib/img";

const POSTER_W = 110;
const POSTER_H = 165;
// Kept apart from anilistResolve's 10-day cache: that one may hold UNVERIFIED
// hrefs, only a source page that actually loaded belongs in this one. A single
// fixed key (payload carries its dayKey) so old days can never pile up.
const VERIFIED_KEY = "@daily_pick_verified_v1";
// Fallback candidates within the popular pool; each one is a "try a new one".
const MAX_CANDIDATES = 8;
// Total verification budget before the source-native fallback takes over.
const SCAN_DEADLINE_MS = 40_000;

type DailyPick = {
  id: string | number;
  title: string;
  poster?: string | null;
  score?: number | null;
  episodes?: number | null;
  genres: string[];
  href: string;
};

function toSeasonalPick(anime: CatalogAnime, detail: AnimeDetail, href: string): DailyPick {
  return {
    id: anime.id,
    title: detail.title,
    // Source poster only when absolute — a relative/garbage string renders
    // blank in expo-image, so fall back to the AniList image then.
    poster: /^https?:\/\//i.test(detail.poster || "") ? detail.poster : anime.image,
    score: anime.score,
    episodes: detail.totalEpisodes || anime.episodes,
    genres: detail.genres?.length ? detail.genres : anime.genres,
    href,
  };
}

function parseScore(raw?: string | null): number | null {
  const n = parseFloat(String(raw ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function AnimeOfTheDay() {
  const [pick, setPick] = useState<DailyPick | null>(null);
  const [dayKey, setDayKey] = useState(() => localDayKey());
  const lastPushRef = useRef(0); // synchronous navigation double-push guard

  // A tab left mounted (or the app resumed the next day) must not keep showing
  // yesterday's pick — recompute the day whenever the home screen regains focus.
  useFocusEffect(
    useCallback(() => {
      const today = localDayKey();
      setDayKey((prev) => (prev === today ? prev : today));
    }, []),
  );

  useEffect(() => {
    let alive = true;
    setPick(null);
    const { season, year } = currentSeason();

    const verifyHref = async (href: string): Promise<AnimeDetail | null> => {
      const res = await fetchEpisodes(href).catch(() => null);
      // Verification means playable, not merely parseable: a www redirect to
      // the anime3rb homepage passes the marker/title check but has no
      // episodes, so a title alone must never count as verified.
      return res?.success && res.data.title && res.data.episodes.length > 0 ? res.data : null;
    };

    const run = async () => {
      // Watchable seasonal entries, most popular first — the same shared pool
      // the daily notification uses, so both name the same anime.
      const pool = orderDailyPool(
        await fetchSeasonAnime(season, year).catch(() => [] as CatalogAnime[]),
      );
      if (!alive) return;

      const deadline = Date.now() + SCAN_DEADLINE_MS;
      // Soft deadline: a single slow scrape must not blow the whole budget.
      // The underlying scrape job can't be cancelled, but we stop waiting.
      const raceDeadline = <T,>(p: Promise<T>): Promise<T | null> => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        return Promise.race([
          p.finally(() => { if (timer) clearTimeout(timer); }),
          new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), Math.max(0, deadline - Date.now()));
          }),
        ]);
      };

      // 1) Today's already-verified pick — re-verify, then show with no search.
      if (pool.length > 0) {
        try {
          const raw = await AsyncStorage.getItem(VERIFIED_KEY);
          if (raw) {
            const cached = JSON.parse(raw) as { dayKey?: string; anilistId?: number; href?: string };
            if (cached.dayKey === dayKey && typeof cached.anilistId === "number" && cached.href) {
              const detail = await raceDeadline(verifyHref(cached.href));
              if (!alive) return;
              const anime = pool.find((a) => a.id === cached.anilistId);
              if (detail && anime) {
                setPick(toSeasonalPick(anime, detail, cached.href));
                return;
              }
            }
            // Stale day, corrupt entry, or no longer verifiable → drop and search.
            await AsyncStorage.removeItem(VERIFIED_KEY).catch(() => {});
          }
        } catch {
          await AsyncStorage.removeItem(VERIFIED_KEY).catch(() => {});
        }

        // 2) Scan the popular pool. Starting at the day index and walking
        // BACKWARD reaches the most popular end first (then wraps around), so
        // retries are likelier to exist in the sources than the initial pick.
        const n = pool.length;
        const start = pickIndexOfTheDay(n, dayKey);
        const count = Math.min(MAX_CANDIDATES, n);
        for (let i = 0; i < count; i++) {
          if (!alive || Date.now() > deadline) break;
          const candidate = pool[(start - i + n) % n];
          const cachedHref = await peekResolvedHref(candidate.id);
          const href =
            cachedHref ??
            (await raceDeadline(
              resolveEntryToSource({
                anilistId: candidate.id,
                title: candidate.title,
                format: candidate.format,
                image: candidate.image,
              }).catch(() => null),
            ));
          if (!alive) return;
          if (!href) continue;
          const detail = await raceDeadline(verifyHref(href));
          if (!alive) return;
          if (!detail) {
            // A cached href that no longer loads is poisoned cache data — drop
            // it so the next mount resolves fresh instead of retrying it.
            if (cachedHref) void forgetResolvedHref(candidate.id);
            continue;
          }
          setPick(toSeasonalPick(candidate, detail, href));
          AsyncStorage.setItem(
            VERIFIED_KEY,
            JSON.stringify({ dayKey, anilistId: candidate.id, href }),
          ).catch(() => {});
          return;
        }
      }

      // 3) Guaranteed fallback: an anime taken straight from the sources' own
      // home feed. It already lives on the sources, so no verification is
      // needed — the card shows something watchable no matter how new the
      // season is on AniList or which rail survived the scrape.
      if (!alive) return;
      const home = await fetchHome().catch(() => null);
      if (!alive || !home?.data) return;
      const sections = home.data.sections ?? [];
      const absoluteImage = (src?: string | null) =>
        /^https?:\/\//i.test(src || "") ? src! : null;

      // 3a) A source-native ANIME card (top list preferred).
      const animeSection =
        sections.find((sec) => sec.type === "anime" && /top[_-]?anime/i.test(sec.id)) ??
        sections.find((sec) => sec.type === "anime");
      const animeItem = animeSection?.items.find(
        (it): it is AnimeItem =>
          !!it && !("animeHref" in it) &&
          typeof (it as AnimeItem).href === "string" && (it as AnimeItem).href.length > 0,
      );
      if (animeItem) {
        setPick({
          id: `source:${animeItem.href}`,
          title: animeItem.title,
          poster: absoluteImage(animeItem.image),
          score: parseScore(animeItem.rating),
          episodes: null,
          genres: [],
          href: animeItem.href,
        });
        return;
      }

      // 3b) Episode-only home (witanime scrape failed, anime4up recent feed
      // survived): open the episode's parent anime page instead.
      for (const sec of sections) {
        const ep = sec.items.find(
          (it): it is EpisodeItem =>
            !!it && typeof (it as EpisodeItem).animeHref === "string" &&
            (it as EpisodeItem).animeHref.length > 0,
        );
        if (!ep) continue;
        setPick({
          id: `source:${ep.animeHref}`,
          title: ep.animeTitle || ep.title,
          poster: absoluteImage(ep.image),
          score: null,
          episodes: null,
          genres: [],
          href: ep.animeHref,
        });
        return;
      }

      // 3c) Last resort: the featured hero.
      const featured = home.data.featured?.[0];
      if (featured?.href) {
        setPick({
          id: `source:${featured.href}`,
          title: featured.title,
          poster: absoluteImage(featured.image),
          score: null,
          episodes: null,
          genres: featured.genres ?? [],
          href: featured.href,
        });
      }
    };

    run().catch(() => {});
    return () => {
      alive = false;
    };
  }, [dayKey]);

  const openWatch = useCallback(() => {
    if (!pick) return;
    const now = Date.now();
    if (now - lastPushRef.current < 600) return;
    lastPushRef.current = now;
    router.push(`/anime/${encodeURIComponent(pick.href)}`);
  }, [pick]);

  const share = useCallback(() => {
    if (!pick) return;
    Share.share({ message: t.shareAnimePlain(pick.title) }).catch(() => {});
  }, [pick]);

  if (!pick) return null;

  return (
    <Rise style={s.section}>
      <View style={s.header}>
        <View style={s.titleRow}>
          <Ionicons name="sunny-outline" size={14} color={C.accent} />
          <Text style={s.title}>{t.dailyTitle}</Text>
        </View>
        <Text style={s.sub}>{t.dailySub}</Text>
      </View>

      <View style={s.card}>
        {pick.poster ? (
          <Image
            source={{ uri: posterUrl(pick.poster, POSTER_W) }}
            style={s.poster}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={String(pick.id)}
            transition={200}
          />
        ) : (
          <View style={[s.poster, s.posterFallback]}>
            <Ionicons name="film-outline" size={22} color={C.textMuted} />
          </View>
        )}

        <View style={s.info}>
          <Text style={s.animeTitle} numberOfLines={2}>{pick.title}</Text>

          <View style={s.metaRow}>
            {pick.score != null && (
              <View style={s.scorePill}>
                <Ionicons name="star" size={9} color={C.gold} />
                <Text style={s.scoreText}>{pick.score}</Text>
              </View>
            )}
            {pick.episodes != null && <Text style={s.metaText}>{t.episodeCount(pick.episodes)}</Text>}
          </View>

          {pick.genres.length > 0 && (
            <View style={s.genreRow}>
              {pick.genres.slice(0, 3).map((g) => (
                <View key={g} style={s.chip}>
                  <Text style={s.chipText}>{g}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={s.actions}>
            <Pressable
              style={s.cta}
              onPress={openWatch}
              accessibilityRole="button"
              accessibilityLabel={t.dailyWatch}
            >
              <Ionicons name="play" size={14} color={C.textOnAccent} />
              <Text style={s.ctaText}>{t.dailyWatch}</Text>
            </Pressable>
            <Pressable
              style={s.shareBtn}
              onPress={share}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t.dailyShare}
            >
              <Ionicons name="share-social-outline" size={16} color={C.text} />
            </Pressable>
          </View>
        </View>
      </View>
    </Rise>
  );
}

const s = StyleSheet.create({
  section: { marginTop: 36 },
  header: { paddingHorizontal: 20, marginBottom: 14 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { ...TAr.h2, color: C.bone, textAlign: "right" },
  sub: { ...TAr.caption, color: C.textMuted, textAlign: "right", marginTop: 2 },

  card: {
    flexDirection: "row", gap: 12,
    marginHorizontal: 20, padding: 12,
    borderRadius: R.lg, backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.borderSoft,
  },
  poster: { width: POSTER_W, height: POSTER_H, borderRadius: R.md, backgroundColor: C.surfaceLight },
  posterFallback: { alignItems: "center", justifyContent: "center" },
  info: { flex: 1, justifyContent: "space-between", gap: 8 },
  animeTitle: { ...TAr.h3, color: C.text, textAlign: "right" },

  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 },
  scorePill: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: C.goldSoft, borderRadius: R.xs, paddingHorizontal: 6, paddingVertical: 2,
  },
  scoreText: { color: C.gold, fontSize: 11, fontFamily: "Cairo_700Bold" },
  metaText: { color: C.textMuted, fontSize: 11, fontFamily: "Cairo_500Medium" },

  genreRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 6 },
  chip: { backgroundColor: C.surfaceLight, borderRadius: R.xs, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { color: C.textSecondary, fontSize: 10, fontFamily: "Cairo_600SemiBold" },

  actions: { flexDirection: "row", alignItems: "center", gap: 8 },
  cta: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    minHeight: 40, borderRadius: R.md, backgroundColor: C.accent,
  },
  ctaText: { color: C.textOnAccent, fontSize: 13, fontFamily: "Cairo_700Bold" },
  shareBtn: {
    width: 40, height: 40, borderRadius: R.md,
    alignItems: "center", justifyContent: "center",
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
  },
});

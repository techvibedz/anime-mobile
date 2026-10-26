// "أنمي اليوم" — one great anime a day from an all-time best-of pool
// (lib/dailyPool: finished, highly rated, widely watched first entries).
// The order is a no-repeat daily shuffle (lib/dailyPick), so a title only
// returns after the whole pool has been shown, and every install names the
// same anime on the same day.
//
// Speed: the card is built from AniList data alone, so it shows as soon as
// the cached pool is read — no source search or scrape on the critical path,
// and today's pick is kept in memory + on disk (a refocus does no work). The
// source page is resolved in the background (paused while scrolling); a tap
// before that finishes opens the detail page at once on a placeholder href
// that resolves behind its skeleton. A pick the sources don't carry is
// replaced by the next day's candidate.

import { useCallback, useRef, useState } from "react";
import { Pressable, Share, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Rise } from "./Rise";
import { C, R, TAr } from "../lib/theme";
import { t } from "../lib/i18n";
import { dailyCandidates, localDayKey, localDayNumber } from "../lib/dailyPick";
import { getDailyPool, type DailyAnime } from "../lib/dailyPool";
import { arGenre } from "../lib/anilistLabels";
import {
  pendingAniListHref,
  peekResolvedHrefSync,
  resolveEntryToSource,
  type AniListResolveEntry,
} from "../lib/anilistResolve";
import { fetchEpisodes, hasFreshEpisodes } from "../lib/api";
import { whenScrollIdle } from "../lib/scrollIdle";
import { checkOnline } from "../lib/net";
import { posterUrl } from "../lib/img";

const POSTER_W = 110;
const POSTER_H = 165;
// Today's pick (display data + resolved href). One fixed key; the payload
// carries its dayKey so old days never pile up.
const PICK_KEY = "@daily_pick_v2";
// How many candidates (today's, then the following days') to try when the
// sources don't carry a pick.
const MAX_CANDIDATES = 6;
// Background resolve starts after the feed has settled.
const RESOLVE_DELAY_MS = 2500;

type DailyPick = {
  id: number;
  title: string;
  titleEnglish: string | null;
  format: string | null;
  poster: string | null;
  /** 0–10, one decimal. */
  score: number | null;
  episodes: number | null;
  genres: string[];
  /** Source page once resolved; null while pending. */
  href: string | null;
  /** Remaining fallback candidate ids, in order. */
  next: number[];
};

type StoredPick = { dayKey: string; pick: DailyPick };
let memPick: StoredPick | null = null;

function toPick(a: DailyAnime, next: number[]): DailyPick {
  return {
    id: a.id,
    title: a.title,
    titleEnglish: a.titleEnglish,
    format: a.format,
    poster: a.image,
    score: a.score != null ? Math.round(a.score) / 10 : null,
    episodes: a.episodes,
    genres: a.genres.slice(0, 3).map(arGenre),
    href: peekResolvedHrefSync(a.id),
    next,
  };
}

const entryOf = (p: DailyPick): AniListResolveEntry => ({
  anilistId: p.id,
  title: p.title,
  titleEnglish: p.titleEnglish,
  format: p.format,
  image: p.poster,
});

function store(dayKey: string, pick: DailyPick) {
  memPick = { dayKey, pick };
  AsyncStorage.setItem(PICK_KEY, JSON.stringify(memPick)).catch(() => {});
}

export function AnimeOfTheDay() {
  const [pick, setPick] = useState<DailyPick | null>(() => (memPick?.dayKey === localDayKey() ? memPick.pick : null));
  const lastPushRef = useRef(0); // synchronous navigation double-push guard

  useFocusEffect(useCallback(() => {
    let alive = true;
    // Recomputed on every focus, so an app left open overnight rolls over.
    const dayKey = localDayKey();

    const show = (p: DailyPick) => {
      if (!alive) return;
      store(dayKey, p);
      setPick(p);
    };

    // Background: make sure today's pick opens on the sources; fall through
    // to the next candidate when it doesn't. Warms the detail page too.
    const ensurePlayable = async (start: DailyPick) => {
      let cur: DailyPick | null = start;
      while (alive && cur) {
        if (!cur.href) {
          await whenScrollIdle();
          if (!alive) return;
          const href = await resolveEntryToSource(entryOf(cur)).catch(() => null);
          if (!alive) return;
          if (!href) {
            // Offline / sources down is not "not on the sources": keep today's
            // pick (a tap resolves it on the detail page) instead of burning
            // through the next days' candidates.
            if (!(await checkOnline())) return;
            if (!alive) return;
            const nextId: number | undefined = cur.next[0];
            const pool: DailyAnime[] = nextId != null ? await getDailyPool() : [];
            const a: DailyAnime | undefined = pool.find((x) => x.id === nextId);
            cur = a ? toPick(a, cur.next.slice(1)) : null;
            if (cur) show(cur);
            continue;
          }
          cur = { ...cur, href };
          show(cur);
        }
        await whenScrollIdle();
        if (alive && cur.href && !(await hasFreshEpisodes(cur.href))) await fetchEpisodes(cur.href).catch(() => null);
        return;
      }
    };

    const run = async () => {
      let today = memPick?.dayKey === dayKey ? memPick.pick : null;
      if (!today) {
        try {
          const raw = await AsyncStorage.getItem(PICK_KEY);
          const saved = raw ? (JSON.parse(raw) as StoredPick) : null;
          if (saved?.dayKey === dayKey && saved.pick?.id) today = saved.pick;
        } catch {}
      }
      if (!today) {
        const pool = await getDailyPool();
        if (!alive || pool.length === 0) return;
        const ids = dailyCandidates(pool.length, localDayNumber(), MAX_CANDIDATES).map((i) => pool[i].id);
        today = toPick(pool.find((x) => x.id === ids[0])!, ids.slice(1));
      }
      if (!alive) return;
      show(today);
      await new Promise((r) => setTimeout(r, RESOLVE_DELAY_MS));
      if (alive) await ensurePlayable(today);
    };

    // Same day and already resolved: nothing to do on a refocus.
    if (memPick?.dayKey === dayKey && memPick.pick.href) {
      setPick(memPick.pick);
      return () => { alive = false; };
    }
    void run().catch(() => {});
    return () => { alive = false; };
  }, []));

  const openWatch = useCallback(() => {
    if (!pick) return;
    const now = Date.now();
    if (now - lastPushRef.current < 600) return;
    lastPushRef.current = now;
    const href = pick.href ?? peekResolvedHrefSync(pick.id);
    if (href) {
      router.push(`/anime/${encodeURIComponent(href)}`);
      return;
    }
    const entry = entryOf(pick);
    void resolveEntryToSource(entry);
    router.push(`/anime/${encodeURIComponent(pendingAniListHref(entry))}`);
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
          <Ionicons name="sunny" size={15} color={C.gold} />
          <Text style={s.title}>{t.dailyTitle}</Text>
          <View style={s.tick} />
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
                <Text style={s.scoreText}>{pick.score.toFixed(1)}</Text>
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
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 10 },
  tick: { width: 4, height: 20, borderRadius: 2, backgroundColor: C.accent },
  title: { ...TAr.h2, color: C.bone, textAlign: "right" },
  sub: { ...TAr.caption, color: C.textMuted, textAlign: "right", marginTop: 2 },

  card: {
    flexDirection: "row-reverse", gap: 14, // poster on the right (RTL)
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

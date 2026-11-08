// MyAnimeList rating badges, backed by lib/animeInfo (Jikan).
//
// • <MalCardBadge> — compact corner pill for poster cards ("MAL ★ 8.74").
// • <MalBadge>     — larger inline badge for the anime detail header.
//
// Both fetch lazily by title and render nothing until (and unless) a score is
// available, so they're safe to drop onto any card without reserving layout.

import { useEffect, useState } from "react";
import { View, Text, StyleSheet, type ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getMalRating, peekMalRating } from "../lib/animeInfo";
import { whenScrollIdle } from "../lib/scrollIdle";
import { C, R } from "../lib/theme";

const MAL_BLUE = "#2e51a2";

function fmt(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(2).replace(/0$/, "");
}

/* ── Scroll-aware badge resolver ──
 * A screenful of posters mounts dozens of badges at once (home fills ~10 rails),
 * and each lookup used to do its own disk read, network fetch and re-render
 * the moment it settled — usually mid-fling, which is exactly the "rows feel
 * laggy" stutter. Lookups now START only while nothing is scrolling, and
 * settled scores are handed to their badges together in ONE batched render
 * once the scroll is idle. */
type ScoreCb = (score: number | null) => void;
const waiters = new Map<string, Set<ScoreCb>>();
const started = new Set<string>();
const settled = new Map<string, number | null>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let startQueued = false;

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    await whenScrollIdle(250);
    flushTimer = null;
    const done = [...settled];
    settled.clear();
    // setState calls in one task are batched by React 18 → a single commit.
    for (const [title, score] of done) {
      const cbs = waiters.get(title);
      waiters.delete(title);
      started.delete(title);
      if (cbs) for (const cb of cbs) cb(score);
    }
  }, 120);
}

function startPending(): void {
  if (startQueued) return;
  startQueued = true;
  void whenScrollIdle(350).then(() => {
    startQueued = false;
    for (const title of waiters.keys()) {
      if (started.has(title)) continue;
      started.add(title);
      getMalRating(title)
        .catch(() => null)
        .then((s) => {
          settled.set(title, s);
          scheduleFlush();
        });
    }
  });
}

function requestMalScore(title: string, cb: ScoreCb): () => void {
  let set = waiters.get(title);
  if (!set) waiters.set(title, (set = new Set()));
  set.add(cb);
  startPending();
  return () => {
    const s = waiters.get(title);
    if (!s) return;
    s.delete(cb);
    // Nobody is waiting and it never started: drop it (scrolled past).
    if (!s.size && !started.has(title)) waiters.delete(title);
  };
}

/** Resolve a title's MAL score; null while loading or when there's no match. */
export function useMalRating(title: string | null | undefined): number | null {
  // Seed from the synchronous in-memory cache so an already-resolved score
  // paints on the first render instead of flashing in seconds later.
  const [score, setScore] = useState<number | null>(() => {
    const p = peekMalRating(title);
    return p === undefined ? null : p;
  });
  useEffect(() => {
    if (!title) { setScore(null); return; }
    const p = peekMalRating(title);
    if (p !== undefined) { setScore(p); return; } // already known — no fetch
    setScore(null);
    return requestMalScore(title, setScore);
  }, [title]);
  return score;
}

/** Corner badge for poster cards. */
export function MalCardBadge({ title, style }: { title?: string | null; style?: ViewStyle }) {
  const score = useMalRating(title);
  return <MalScoreBadge score={score} style={style} />;
}

export function MalScoreBadge({ score, style }: { score: number | null; style?: ViewStyle }) {
  if (score == null) return null;
  return (
    <View style={[styles.cardBadge, style]}>
      <Text style={styles.cardTag}>MAL</Text>
      <Ionicons name="star" size={9} color={C.gold} />
      <Text style={styles.cardScore}>{fmt(score)}</Text>
    </View>
  );
}

/** Inline badge for the detail header. Pass the score you already resolved. */
export function MalBadge({ score }: { score: number | null }) {
  if (score == null) return null;
  return (
    <View style={styles.detailBadge}>
      <Text style={styles.detailTag}>MAL</Text>
      <Ionicons name="star" size={12} color={C.gold} />
      <Text style={styles.detailScore}>{fmt(score)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cardBadge: {
    position: "absolute", top: 8, right: 8, zIndex: 2,
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: "rgba(10,10,11,0.82)", borderRadius: R.sm,
    paddingHorizontal: 7, paddingVertical: 3,
    borderWidth: 1, borderColor: C.glassBorder,
  },
  cardTag: {
    color: "#fff", fontSize: 8, fontWeight: "800", letterSpacing: 0.3,
    backgroundColor: MAL_BLUE, borderRadius: 3,
    paddingHorizontal: 3, paddingVertical: 1, overflow: "hidden",
    fontFamily: "Outfit_700Bold",
  },
  cardScore: { color: "#fff", fontSize: 10, fontWeight: "700", fontFamily: "Outfit_700Bold" },

  detailBadge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: C.surfaceGlass, borderRadius: R.pill,
    paddingHorizontal: 11, paddingVertical: 5,
    borderWidth: 1, borderColor: C.glassBorder,
  },
  detailTag: {
    color: "#fff", fontSize: 9, fontWeight: "800", letterSpacing: 0.4,
    backgroundColor: MAL_BLUE, borderRadius: 3,
    paddingHorizontal: 4, paddingVertical: 1, overflow: "hidden",
    fontFamily: "Outfit_700Bold",
  },
  detailScore: { color: C.text, fontSize: 12, fontWeight: "700", fontFamily: "Outfit_700Bold" },
});

// Continue-watching grouping tests — the dismiss bug made cards reappear.
// Run:  npx tsx lib/continueWatching.test.ts

import assert from "node:assert";
import { groupContinueWatching } from "./continueWatching";
import { mergeHistory } from "./historyMerge";
import type { WatchEntry } from "./history";

const entry = (over: Partial<WatchEntry>): WatchEntry => ({
  episodeHref: "https://witanime.site/watch/x/1",
  episodeTitle: "الحلقة 1",
  animeTitle: "X",
  animeHref: "https://witanime.site/anime/x",
  image: "",
  positionMs: 1000,
  durationMs: 10000,
  updatedAt: Date.now(),
  ...over,
});

// One card per anime, newest first.
const list = [
  entry({ episodeHref: "ep3", animeTitle: "X", updatedAt: 3 }),
  entry({ episodeHref: "ep2", animeTitle: "X", updatedAt: 2 }),
  entry({ episodeHref: "ep1", animeTitle: "Y", animeHref: "https://witanime.site/anime/y", updatedAt: 1 }),
];
assert.deepEqual(groupContinueWatching(list).map((e) => e.episodeHref), ["ep3", "ep1"]);

// Dismissing the card hides the WHOLE anime — the previous episode must NOT
// take its place (the "can't close the card" bug). dismissFromContinue marks
// every entry of the series, so that's the realistic post-dismissal state.
const dismissed = [
  entry({ episodeHref: "ep3", animeTitle: "X", updatedAt: 3, dismissed: true }),
  entry({ episodeHref: "ep2", animeTitle: "X", updatedAt: 2, dismissed: true }),
  entry({ episodeHref: "ep1", animeTitle: "Y", animeHref: "https://witanime.site/anime/y", updatedAt: 1 }),
];
assert.deepEqual(groupContinueWatching(dismissed).map((e) => e.episodeHref), ["ep1"]);

// Same-millisecond tie: a dismissed entry must never beat a re-watched one.
const tie = [
  entry({ episodeHref: "ep4", animeTitle: "X", updatedAt: 1000, dismissed: true }),
  entry({ episodeHref: "ep5", animeTitle: "X", updatedAt: 1000, dismissed: false }),
];
assert.deepEqual(groupContinueWatching(tie).map((e) => e.episodeHref), ["ep5"]);

// Older-but-visible entry still shows when the newest one was dismissed
// (partial dismissal can't hide a series the user is actively watching).
const partial = [
  entry({ episodeHref: "new", animeTitle: "X", updatedAt: 5, dismissed: true }),
  entry({ episodeHref: "old", animeTitle: "X", updatedAt: 2, dismissed: false }),
];
assert.deepEqual(groupContinueWatching(partial).map((e) => e.episodeHref), ["old"]);

// Distinct anime with the same title key still group by href.
const sameTitle = [
  entry({ episodeHref: "a1", animeTitle: "Same", animeHref: "https://x/anime/a", updatedAt: 2 }),
  entry({ episodeHref: "b1", animeTitle: "Same", animeHref: "https://x/anime/b", updatedAt: 1 }),
];
assert.equal(groupContinueWatching(sameTitle).length, 2);

// ── Cloud merge ────────────────────────────────────────────────────────────
// A failed/empty push must NEVER erase local progress on the next cold start.
const localOnly = [entry({ episodeHref: "local", updatedAt: 5, epNum: 3 })];
assert.deepEqual(mergeHistory(localOnly, []).map((e) => e.episodeHref), ["local"]);

// Newer cloud row wins; local-only epNum survives when the cloud lacks it.
const localRow = entry({ episodeHref: "shared", updatedAt: 1, positionMs: 1000, epNum: 7 });
const cloudRow = entry({ episodeHref: "shared", updatedAt: 2, positionMs: 9000, epNum: undefined });
const merged = mergeHistory([localRow], [cloudRow]);
assert.equal(merged.length, 1);
assert.equal(merged[0].positionMs, 9000, "newer cloud position wins");
assert.equal(merged[0].epNum, 7, "local-only epNum preserved");

// Newer LOCAL row is not clobbered by a stale cloud copy (the wipe bug).
const staleCloud = entry({ episodeHref: "shared", updatedAt: 1, positionMs: 1000 });
const newerLocal = entry({ episodeHref: "shared", updatedAt: 5, positionMs: 8000 });
assert.equal(mergeHistory([newerLocal], [staleCloud])[0].positionMs, 8000);

// Sorted newest-first and capped.
const many = Array.from({ length: 5 }, (_, i) => entry({ episodeHref: `e${i}`, updatedAt: i }));
assert.deepEqual(mergeHistory(many, [], 3).map((e) => e.episodeHref), ["e4", "e3", "e2"]);

console.log("continue watching tests passed");

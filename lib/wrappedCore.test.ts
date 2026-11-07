import assert from "node:assert";
import { computeWrapped, countsAsWatched, longestStreak, topGenres, watchedMinutes, type WrappedEntry } from "./wrappedCore";

const at = (iso: string) => Date.parse(iso);
const ep = (anime: string, iso: string, pos = 22, dur = 24, extra: Partial<WrappedEntry> = {}): WrappedEntry => ({
  animeKey: anime.toLowerCase(), animeTitle: anime, animeHref: `https://x/${anime}`, image: `https://img/${anime}.jpg`,
  episodeHref: `https://x/${anime}/${iso}`, positionMs: pos * 60_000, durationMs: dur * 60_000, updatedAt: at(iso), ...extra,
});

assert.equal(countsAsWatched(ep("A", "2026-01-01T10:00:00Z", 13, 24)), true);
assert.equal(countsAsWatched(ep("A", "2026-01-01T10:00:00Z", 5, 24)), false);
assert.equal(countsAsWatched(ep("A", "2026-01-01T10:00:00Z", 0, 0, { completed: true })), true);
assert.equal(watchedMinutes(ep("A", "2026-01-01T10:00:00Z", 0, 0, { completed: true })), 23);
assert.equal(watchedMinutes(ep("A", "2026-01-01T10:00:00Z", 30, 24)), 24, "capped at duration");

assert.equal(longestStreak(["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-05", "2026-03-02"]), 3);
assert.equal(longestStreak([]), 0);

const entries: WrappedEntry[] = [
  // Frieren binge: 9 episodes in one night (01:00-03:00 UTC)
  ...Array.from({ length: 9 }, (_, i) => ep("Frieren", `2026-03-14T0${1 + Math.floor(i / 4)}:${String((i * 13) % 60).padStart(2, "0")}:00Z`)),
  ep("Frieren", "2026-03-15T21:00:00Z"),
  ep("Dandadan", "2026-07-02T20:00:00Z"),
  ep("Dandadan", "2026-07-03T20:00:00Z"),
  ep("Dandadan", "2026-07-03T20:30:00Z", 3, 24), // not watched (12%)
  ep("Old", "2025-12-31T20:00:00Z"), // other year
];
const w = computeWrapped(entries, { year: 2026, completedAnime: 2, mangaTitles: 3, mangaChapters: 40 });
assert.equal(w.episodes, 12);
assert.equal(w.animeCount, 2);
assert.equal(w.top[0].title, "Frieren");
assert.equal(w.top[0].episodes, 10);
assert.equal(w.bestDay?.date, "2026-03-14");
assert.equal(w.bestDay?.episodes, 9);
assert.equal(w.months[2], 10);
assert.equal(w.months[6], 2);
assert.equal(w.topMonth, 2);
assert.equal(w.longestStreak, 2);
assert.equal(w.nightPct, 75);
assert.equal(w.personality, "night_owl");
assert.equal(w.mangaChapters, 40);
assert.ok(w.minutes >= 12 * 22 && w.minutes <= 12 * 22 + 4);

// Timezone shifts the day/hour buckets (UTC+1 → offset -60).
const tzw = computeWrapped([ep("A", "2026-05-01T23:30:00Z")], { year: 2026, tzOffsetMin: -60 });
assert.equal(tzw.bestDay?.date, "2026-05-02");
assert.equal(tzw.peakHour, 0);

// Empty year.
const empty = computeWrapped([], { year: 2026 });
assert.equal(empty.episodes, 0);
assert.equal(empty.personality, "fan");
assert.equal(empty.bestDay, null);
assert.equal(empty.topMonth, null);

// Marathoner (big day, not at night).
const marathon = computeWrapped(
  Array.from({ length: 8 }, (_, i) => ep("One Piece", `2026-08-08T1${i}:00:00Z`)),
  { year: 2026 },
);
assert.equal(marathon.personality, "marathoner");

assert.deepEqual(
  topGenres(new Map([["Frieren", ["Fantasy", "Adventure"]], ["Dandadan", ["Action", "Comedy", "Fantasy"]]]), w.top),
  ["Fantasy", "Adventure", "Action"],
);

console.log("wrapped core tests passed");

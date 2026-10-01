// Unit tests for the pure For You rail logic in ./recommend.
// Run:  npx tsx lib/recommend.test.ts
//
// Covers the three surfaces the home "مقترح لك" rail depends on:
//   • pickSeeds — distinct, newest-first anime seeds from watch history
//   • parseRecommendations — AniList node shaping (anime only, dedupe, labels)
//   • rankRecommendations — cross-seed merge, exclusion, cap, tie-break

import assert from "node:assert";
import {
  pickSeeds,
  parseRecommendations,
  rankRecommendations,
  type RecItem,
} from "./recommend";

let passed = 0;
let failed = 0;
const queue: { name: string; fn: () => void }[] = [];
function test(name: string, fn: () => void) { queue.push({ name, fn }); }
function runAll() {
  for (const { name, fn } of queue) {
    try { fn(); passed++; console.log(`  ok  ${name}`); }
    catch (e: any) { failed++; console.error(`FAIL  ${name}\n      ${e?.message || e}`); }
  }
}

const item = (over: Partial<RecItem> = {}): RecItem => ({
  anilistId: 1, title: "Title", titleEnglish: null, image: null,
  format: "مسلسل", seasonYear: 2020, rating: 10, ...over,
});

/* ── pickSeeds ── */

test("pickSeeds keeps the newest entry per anime and caps the list", () => {
  const history = [
    { animeTitle: "Naruto", animeHref: "https://witanime.you/anime/naruto" },
    { animeTitle: "Naruto", animeHref: "https://witanime.you/anime/naruto" }, // dupe
    { animeTitle: "Bleach", animeHref: "https://witanime.you/anime/bleach" },
    { animeTitle: "One Piece", animeHref: "https://witanime.you/anime/one-piece" },
    { animeTitle: "Gintama", animeHref: "https://witanime.you/anime/gintama" },
  ];
  const seeds = pickSeeds(history, (e) => e.animeHref, 3);
  assert.deepEqual(seeds.map((s) => s.animeTitle), ["Naruto", "Bleach", "One Piece"]);
});

test("pickSeeds bridges sources through keyOf so one anime seeds once", () => {
  const history = [
    { animeTitle: "Sousou no Frieren", animeHref: "https://witanime.you/anime/frieren" },
    { animeTitle: "Frieren", animeHref: "https://anime4up.tv/anime/frieren" },
  ];
  const seeds = pickSeeds(history, () => "frieren", 3);
  assert.equal(seeds.length, 1);
  assert.equal(seeds[0].animeHref, "https://witanime.you/anime/frieren");
});

test("pickSeeds skips titleless entries", () => {
  const history = [
    { animeTitle: "", animeHref: "https://x/anime/1" },
    { animeTitle: "  ", animeHref: "https://x/anime/2" },
    { animeTitle: "Real", animeHref: "https://x/anime/3" },
  ];
  assert.deepEqual(
    pickSeeds(history, (e) => e.animeHref),
    [{ animeTitle: "Real", animeHref: "https://x/anime/3" }],
  );
});

/* ── parseRecommendations ── */

test("parseRecommendations keeps anime only, maps formats, dedupes by id", () => {
  const nodes = [
    { rating: 50, mediaRecommendation: { id: 1, type: "ANIME", format: "TV", seasonYear: 2019, title: { romaji: "Alpha", english: "Alpha EN" }, coverImage: { large: "img1" } } },
    { rating: 5, mediaRecommendation: { id: 1, type: "ANIME", format: "TV", seasonYear: 2019, title: { romaji: "Alpha" } } }, // dupe, lower rating
    { rating: 80, mediaRecommendation: { id: 2, type: "MANGA", format: "MANGA", title: { romaji: "Manga" } } }, // non-anime
    { rating: 20, mediaRecommendation: { id: 3, type: "ANIME", format: "MOVIE", title: { romaji: "Beta" } } },
    { rating: 10, mediaRecommendation: null },
    null,
  ];
  const out = parseRecommendations(nodes);
  assert.deepEqual(out.map((r) => r.anilistId), [1, 3]);
  assert.equal(out[0].format, "مسلسل");
  assert.equal(out[1].format, "فيلم");
  assert.equal(out[0].titleEnglish, "Alpha EN");
  assert.equal(out[1].image, null);
});

test("parseRecommendations tolerates garbage", () => {
  assert.deepEqual(parseRecommendations(null), []);
  assert.deepEqual(parseRecommendations(undefined), []);
  assert.deepEqual(parseRecommendations("nope"), []);
  assert.deepEqual(parseRecommendations([{ rating: 1 }]), []); // no media
  assert.deepEqual(parseRecommendations([{ mediaRecommendation: { id: 4, type: "ANIME" } }]), []); // no title
});

/* ── rankRecommendations ── */

test("rankRecommendations sums ratings across seeds and dedupes by id", () => {
  const ranked = rankRecommendations([
    [item({ anilistId: 1, rating: 10 })],
    [item({ anilistId: 1, rating: 15 }), item({ anilistId: 2, rating: 12 })],
  ]);
  assert.deepEqual(ranked.map((r) => r.anilistId), [1, 2]);
  assert.equal(ranked[0].score, 25);
  assert.equal(ranked[1].score, 12);
});

test("rankRecommendations drops excluded items and caps the result", () => {
  const batch = [
    item({ anilistId: 1, rating: 100 }),
    item({ anilistId: 2, rating: 50 }),
    item({ anilistId: 3, rating: 40 }),
  ];
  const ranked = rankRecommendations([batch], { excluded: (r) => r.anilistId === 1, cap: 1 });
  assert.deepEqual(ranked.map((r) => r.anilistId), [2]);
});

test("rankRecommendations breaks rating ties by newer year", () => {
  const ranked = rankRecommendations([[
    item({ anilistId: 1, rating: 10, seasonYear: 2010 }),
    item({ anilistId: 2, rating: 10, seasonYear: 2024 }),
  ]]);
  assert.deepEqual(ranked.map((r) => r.anilistId), [2, 1]);
});

test("rankRecommendations handles empty input", () => {
  assert.deepEqual(rankRecommendations([]), []);
  assert.deepEqual(rankRecommendations([[]]), []);
});

runAll();
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

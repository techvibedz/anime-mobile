// Unit tests for the pure related-anime logic in ./relations.
// Run:  npx tsx lib/relations.test.ts
//
// No test framework is installed, so this is a tiny self-contained harness
// (assert + a pass/fail tally) that exits non-zero on any failure. It covers
// the two bugs reported in the field:
//   • "doesn't show related even though the anime has some" → resolution /
//     scoring (season-preserving variants, candidate selection, thresholds).
//   • "duplicate — the current anime shows as its own next season" → season
//     parsing, canonical de-dupe, and self-exclusion.

import assert from "node:assert";
import {
  normLatin,
  seasonNum,
  canonTitle,
  slugToTitle,
  relSearchVariants,
  buildSearchQueries,
  scoreMedia,
  pickBestMedia,
  buildRelations,
  collectFranchise,
  formatCat,
  type AniListMedia,
} from "./relations";

let passed = 0;
let failed = 0;
const queue: { name: string; fn: () => void | Promise<void> }[] = [];
function test(name: string, fn: () => void | Promise<void>) {
  queue.push({ name, fn });
}
async function runAll() {
  for (const { name, fn } of queue) {
    try {
      await fn();
      passed++;
      console.log(`  ok  ${name}`);
    } catch (e: any) {
      failed++;
      console.error(`FAIL  ${name}\n      ${e?.message || e}`);
    }
  }
}

/* ── normalisation (improved title detection) ── */

test("normLatin folds diacritics so macron'd romaji matches plain spelling", () => {
  assert.equal(normLatin("Tōkyō"), "tokyo");
  assert.equal(normLatin("Jūni Taisen"), "juni taisen");
  assert.equal(normLatin("Shōjo"), normLatin("Shoujo".replace("ou", "o"))); // ō ≡ o
  // Non-latin scripts (katakana, etc.) are dropped, latin kept.
  assert.equal(normLatin("Re:Zero ゼロ"), "re zero");
});

/* ── slug-derived titles (better detection on Arabic pages) ── */

test("slugToTitle recovers clean romaji from a source URL", () => {
  assert.equal(
    slugToTitle("https://witanime.you/anime/tensei-shitara-slime-datta-ken-4th-season/"),
    "tensei shitara slime datta ken 4th season",
  );
  // anime3rb /titles/<id>/<slug> — skip the numeric id segment.
  assert.equal(slugToTitle("https://anime3rb.com/titles/12345/jujutsu-kaisen"), "jujutsu kaisen");
  assert.equal(slugToTitle(""), "");
});

test("relSearchVariants folds in the slug as a fallback for Arabic titles", () => {
  // Arabic page title yields no latin variant; the slug carries the romaji.
  const v = relSearchVariants("جوجوتسو كايسن", "jujutsu-kaisen-2nd-season");
  assert.ok(v.includes("jujutsu kaisen 2nd season"), `got ${JSON.stringify(v)}`);
});

test("buildSearchQueries merges scraped title, MAL alt-titles and slug (deduped)", () => {
  // Arabic scraped title + MAL romaji/English names + slug — the MAL names give
  // AniList's title search extra romanisations to resolve the anime.
  const q = buildSearchQueries(
    ["فري", "Free!", "Free! - Iwatobi Swim Club"],
    "free-iwatobi-swim-club",
  );
  assert.ok(q.includes("free"), `got ${JSON.stringify(q)}`);
  assert.ok(q.includes("free iwatobi swim club"));
  // No duplicate entries.
  assert.equal(new Set(q).size, q.length);
});

/* ── format category (right-page resolution for OVA/movie/special cards) ── */

test("formatCat buckets AniList format labels and source types", () => {
  // AniList Arabic format labels (entry.format from FORMAT_AR).
  assert.equal(formatCat("OVA"), "ova");
  assert.equal(formatCat("فيلم"), "movie");
  assert.equal(formatCat("حلقة خاصة"), "special");
  assert.equal(formatCat("مسلسل"), "tv");
  assert.equal(formatCat("ONA"), "ona");
  assert.equal(formatCat("موسيقى"), "music");
  // Source-site types / titles (English markers).
  assert.equal(formatCat("Movie"), "movie");
  assert.equal(formatCat("TV"), "tv");
  assert.equal(formatCat("Some Show OVA"), "ova");
  assert.equal(formatCat("Some Show"), "");
  assert.equal(formatCat(null), "");
});

/* ── season parsing ── */

test("seasonNum reads explicit markers, not bare trailing numbers", () => {
  assert.equal(seasonNum("Jujutsu Kaisen 2nd Season"), 2);
  assert.equal(seasonNum("Jujutsu Kaisen Season 2"), 2);
  assert.equal(seasonNum("Attack on Titan Part 3"), 3);
  assert.equal(seasonNum("Some Anime S4"), 4);
  assert.equal(seasonNum("Jujutsu Kaisen"), 0);
  assert.equal(seasonNum("Jujutsu Kaisen 0"), 0); // movie title number, NOT a season
  assert.equal(seasonNum("86"), 0);               // the whole title is a number
});

test("seasonNum understands Arabic season markers", () => {
  assert.equal(seasonNum("جوجوتسو كايسن الموسم الثاني"), 2);
  assert.equal(seasonNum("الجزء 3"), 3);
  assert.equal(seasonNum("الموسم ٢"), 2); // arabic-indic digit
});

test("seasonNum understands official trailing Roman season numbers", () => {
  assert.equal(seasonNum("Shiguang Dailiren III"), 3);
  assert.equal(seasonNum("Shiguang Dailiren II"), 2);
  assert.equal(canonTitle("Shiguang Dailiren III"), canonTitle("Shiguang Dailiren Season 3"));
});

/* ── canonical title (de-dupe / self key) ── */

test("canonTitle keeps seasons distinct but collapses spelling variants", () => {
  assert.equal(canonTitle("Jujutsu Kaisen 2nd Season"), canonTitle("Jujutsu Kaisen Season 2"));
  assert.notEqual(canonTitle("Jujutsu Kaisen"), canonTitle("Jujutsu Kaisen 2nd Season"));
  // A latin base with an Arabic season marker matches the latin spelling.
  assert.equal(canonTitle("Jujutsu Kaisen الموسم الثاني"), canonTitle("Jujutsu Kaisen 2nd Season"));
});

/* ── search variants ── */

test("relSearchVariants puts the season-preserving query first", () => {
  const v = relSearchVariants("Jujutsu Kaisen 2nd Season");
  assert.equal(v[0], "jujutsu kaisen 2nd season");
  assert.ok(v.includes("jujutsu kaisen")); // cleaner fallback present
});

test("relSearchVariants recovers an Arabic-only season marker", () => {
  const v = relSearchVariants("Jujutsu Kaisen الموسم الثاني");
  assert.ok(v.includes("jujutsu kaisen Season 2"), `got ${JSON.stringify(v)}`);
});

/* ── candidate scoring / selection ── */

const S1: AniListMedia = {
  id: 1, type: "ANIME", format: "TV",
  title: { romaji: "Jujutsu Kaisen", english: "JUJUTSU KAISEN" },
};
const S2: AniListMedia = {
  id: 2, type: "ANIME", format: "TV",
  title: { romaji: "Jujutsu Kaisen 2nd Season", english: "JUJUTSU KAISEN Season 2" },
};
const ONE_PIECE: AniListMedia = {
  id: 3, type: "ANIME", format: "TV",
  title: { romaji: "One Piece", english: "One Piece" },
};

test("scoreMedia prefers the matching season", () => {
  assert.ok(scoreMedia(S2, "jujutsu kaisen 2nd season") > scoreMedia(S1, "jujutsu kaisen 2nd season"));
});

test("pickBestMedia resolves the correct season, not season 1", () => {
  const best = pickBestMedia([S1, S2], "jujutsu kaisen 2nd season");
  assert.equal(best?.id, 2);
});

test("pickBestMedia rejects an unrelated anime (no false positives)", () => {
  assert.equal(pickBestMedia([ONE_PIECE], "jujutsu kaisen"), null);
});

/* ── relation shaping: the core of both bug fixes ── */

// Mis-resolved-to-Season-1 scenario: the user is viewing Season 2, but (e.g. an
// Arabic title that lost its season) AniList resolved Season 1. Season 1's
// SEQUEL is literally the page being viewed — it must be excluded.
const S1_WITH_SEQUEL_TO_SELF: AniListMedia = {
  id: 1, type: "ANIME", format: "TV",
  title: { romaji: "Jujutsu Kaisen", english: "JUJUTSU KAISEN" },
  relations: {
    edges: [
      { relationType: "PREQUEL", node: { id: 10, type: "ANIME", format: "MOVIE", title: { romaji: "Jujutsu Kaisen 0", english: null }, coverImage: { large: "p0" } } },
      { relationType: "SEQUEL", node: { id: 11, type: "ANIME", format: "TV", title: { romaji: "Jujutsu Kaisen 2nd Season", english: null }, coverImage: { large: "p2" } } },
      { relationType: "ADAPTATION", node: { id: 12, type: "MANGA", format: "MANGA", title: { romaji: "Jujutsu Kaisen", english: null }, coverImage: { large: "pm" } } },
      { relationType: "OTHER", node: { id: 13, type: "ANIME", format: "ONA", title: { romaji: "Juju Sanpo", english: null }, coverImage: { large: "po" } } },
    ],
  },
};

test("buildRelations excludes the anime being viewed (no self-as-sequel duplicate)", () => {
  const out = buildRelations(S1_WITH_SEQUEL_TO_SELF, "Jujutsu Kaisen 2nd Season");
  const titles = out.map((r) => r.title);
  assert.ok(!titles.includes("Jujutsu Kaisen 2nd Season"), `self leaked in: ${JSON.stringify(titles)}`);
  assert.ok(titles.includes("Jujutsu Kaisen 0"));
  assert.ok(titles.includes("Juju Sanpo"));
});

test("buildRelations drops non-anime (manga/novel) relations", () => {
  const out = buildRelations(S1_WITH_SEQUEL_TO_SELF, "Jujutsu Kaisen 2nd Season");
  assert.ok(out.every((r) => r.title !== "Jujutsu Kaisen" || r.anilistId !== 12));
  assert.equal(out.find((r) => r.anilistId === 12), undefined);
});

test("buildRelations de-dupes by id and by canonical title", () => {
  const media: AniListMedia = {
    id: 100, type: "ANIME", title: { romaji: "Base Show", english: null },
    relations: {
      edges: [
        { relationType: "SEQUEL", node: { id: 200, type: "ANIME", format: "TV", title: { romaji: "Base Show 2nd Season", english: null }, coverImage: { large: "a" } } },
        // same id again under another relation → must collapse
        { relationType: "CHARACTER", node: { id: 200, type: "ANIME", format: "TV", title: { romaji: "Base Show 2nd Season", english: null }, coverImage: { large: "a" } } },
        // different id, same canonical title (re-release) → must collapse
        { relationType: "ALTERNATIVE", node: { id: 201, type: "ANIME", format: "TV", title: { romaji: "Base Show Season 2", english: null }, coverImage: { large: "b" } } },
      ],
    },
  };
  const out = buildRelations(media, "Base Show");
  assert.equal(out.length, 1, `expected 1 deduped entry, got ${out.length}`);
  assert.equal(out[0].anilistId, 200); // first occurrence wins
});

test("buildRelations sorts sequels/prequels before side stories", () => {
  const media: AniListMedia = {
    id: 1, type: "ANIME", title: { romaji: "Show", english: null },
    relations: {
      edges: [
        { relationType: "SIDE_STORY", node: { id: 1, type: "ANIME", format: "OVA", title: { romaji: "Show OVA", english: null }, coverImage: { large: "a" } } },
        { relationType: "SEQUEL", node: { id: 2, type: "ANIME", format: "TV", title: { romaji: "Show 2", english: null }, coverImage: { large: "b" } } },
      ],
    },
  };
  const out = buildRelations(media, "Show");
  assert.equal(out[0].relation, "تكملة");      // SEQUEL first
  assert.equal(out[1].relation, "قصة جانبية");  // SIDE_STORY after
});

test("buildRelations maps formats to Arabic labels", () => {
  const out = buildRelations(S1_WITH_SEQUEL_TO_SELF, "Jujutsu Kaisen 2nd Season");
  const movie = out.find((r) => r.title === "Jujutsu Kaisen 0");
  assert.equal(movie?.format, "فيلم");
});

/* ── franchise traversal (fixes "missing some" non-adjacent seasons) ── */

// A 4-season franchise. AniList only links ADJACENT seasons per node, so a
// one-hop read from S1 sees only S2. The graph: S1<->S2<->S3<->S4, and S2 also
// has a side-story OVA.
const node = (id: number, romaji: string, format = "TV") =>
  ({ id, type: "ANIME", format, title: { romaji, english: null }, coverImage: { large: `c${id}` } });
const GRAPH: Record<number, AniListMedia> = {
  1: { ...node(1, "Saga"), relations: { edges: [{ relationType: "SEQUEL", node: node(2, "Saga 2nd Season") }] } },
  2: { ...node(2, "Saga 2nd Season"), relations: { edges: [
    { relationType: "PREQUEL", node: node(1, "Saga") },
    { relationType: "SEQUEL", node: node(3, "Saga 3rd Season") },
    { relationType: "SIDE_STORY", node: node(20, "Saga: OVA", "OVA") },
  ] } },
  3: { ...node(3, "Saga 3rd Season"), relations: { edges: [
    { relationType: "PREQUEL", node: node(2, "Saga 2nd Season") },
    { relationType: "SEQUEL", node: node(4, "Saga 4th Season") },
  ] } },
  4: { ...node(4, "Saga 4th Season"), relations: { edges: [
    { relationType: "PREQUEL", node: node(3, "Saga 3rd Season") },
  ] } },
};
const fetchById = async (id: number) => GRAPH[id] || null;

test("collectFranchise gathers ALL later seasons from season 1, not just the next", async () => {
  const out = await collectFranchise(GRAPH[1], "Saga", fetchById);
  const titles = out.map((r) => r.title);
  assert.ok(titles.includes("Saga 2nd Season"), "S2 missing");
  assert.ok(titles.includes("Saga 3rd Season"), "S3 missing (one-hop limit not overcome)");
  assert.ok(titles.includes("Saga 4th Season"), "S4 missing");
  assert.ok(titles.includes("Saga: OVA"), "side story missing");
  assert.ok(!titles.includes("Saga"), "season 1 (self) leaked");
});

test("collectFranchise from a middle season finds both directions, excludes self", async () => {
  const out = await collectFranchise(GRAPH[2], "Saga 2nd Season", fetchById);
  const titles = out.map((r) => r.title);
  assert.ok(titles.includes("Saga"), "prequel S1 missing");
  assert.ok(titles.includes("Saga 3rd Season"), "sequel S3 missing");
  assert.ok(titles.includes("Saga 4th Season"), "sequel S4 missing");
  assert.ok(!titles.includes("Saga 2nd Season"), "viewed season leaked as its own relation");
});

test("collectFranchise respects the fetch budget", async () => {
  let calls = 0;
  const counting = async (id: number) => { calls++; return GRAPH[id] || null; };
  await collectFranchise(GRAPH[1], "Saga", counting, { maxFetch: 1 });
  assert.ok(calls <= 1, `expected ≤1 fetch, got ${calls}`);
});

test("collectFranchise with no extra fetches equals one-hop relations", async () => {
  const walked = await collectFranchise(GRAPH[1], "Saga", fetchById, { maxFetch: 0 });
  const oneHop = buildRelations(GRAPH[1], "Saga");
  assert.deepEqual(walked.map((r) => r.anilistId), oneHop.map((r) => r.anilistId));
});

/* ── summary ── */

runAll().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});

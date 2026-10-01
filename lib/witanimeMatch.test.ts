import assert from "node:assert/strict";
import { matchWitanimeTitle, resolveWitanimeEpisode, witEpisodeLink, witRelatedCards, witRelationMark, witSearchNames, witTitleScore } from "./witanimeMatch";
import { tm_seasonNum } from "./scraper/direct";

const card = (title: string, slug = title) => ({ title, href: `https://witanime.site/anime/${slug}` });
const match = (names: string[], cards: ReturnType<typeof card>[]) => matchWitanimeTitle(names, cards, tm_seasonNum);
assert.equal(match(["Full Metal Alchemist"], [card("Fullmetal Alchemist", "fma")]), card("", "fma").href);
assert.equal(match(["Naruto Shippuden"], [card("Naruto Shippuuden", "ns")]), card("", "ns").href);
assert.equal(match(["Naruto"], [card("Boruto Naruto Next Generations")]), null);
assert.equal(match(["Mushoku Tensei III"], [card("Mushoku Tensei 2nd Season")]), null);
assert.equal(match(["Mushoku Tensei III"], [card("Mushoku Tensei 3rd Season", "mt3")]), card("", "mt3").href);
assert.equal(match(["King's Game", "Ousama Game"], [card("Ousama Game", "og")]), card("", "og").href);
assert.equal(match(["One Piece"], [card("One Piece", "one"), card("One Piece", "remake")]), null);

// Mixed-script titles: the source lists "ون بيس One Piece" and the site indexes
// the Latin half only. Scoring the whole string caps at 0.615 (< 0.8), so the
// Latin half has to be scored on its own.
assert.equal(match(["ون بيس One Piece"], [card("One Piece", "one")]), card("", "one").href);
assert.equal(match(["قاتل الشياطين Kimetsu no Yaiba"], [card("Kimetsu no Yaiba", "kny")]), card("", "kny").href);
// ...and the reverse: an Arabic-only card matched from a mixed title.
assert.equal(match(["ون بيس One Piece"], [card("ون بيس", "ar")]), card("", "ar").href);
// The half-match must not leak a different anime in.
assert.equal(match(["ون بيس One Piece"], [card("One Punch Man", "opm")]), null);

// The page-identity gate must accept whatever the matcher accepted: an
// alias-only match (King's Game → Ousama Game), a season-format difference
// (II vs 2nd Season) or a dub decoration on the page h1.
assert.ok(witTitleScore(["King's Game", "Ousama Game"], "Ousama Game") >= 0.8);
assert.ok(witTitleScore(["Mushoku Tensei II"], "Mushoku Tensei 2nd Season") >= 0.8);
assert.ok(witTitleScore(["Attack on Titan Season 2"], "Attack on Titan 2nd Season") >= 0.8);
assert.ok(witTitleScore(["Naruto"], "Naruto مترجم") >= 0.8);
// ...while a different anime (sequel) still fails the gate.
assert.ok(witTitleScore(["Naruto"], "Naruto Shippuden") < 0.8);
assert.ok(witTitleScore(["One Piece"], "One Punch Man") < 0.8);

// Decoration stripping: "(2022)" on the app title still matches the bare card,
// and the source-page slug contributes the site's own romaji spelling.
const bleachNames = witSearchNames("Bleach (2022)", "bleach sennen kessen hen");
assert.ok(bleachNames.includes("Bleach"));
assert.ok(witSearchNames("Bleach 2022").includes("Bleach"));
assert.ok(bleachNames.includes("bleach sennen kessen hen"));
assert.equal(match(bleachNames, [card("Bleach", "bleach")]), card("", "bleach").href);
// Symbols/letters added at edges, middle or with different spacing fold away.
assert.equal(match(["Steins;Gate"], [card("Steins Gate", "sg")]), card("", "sg").href);
assert.equal(match(["★ One Piece ★"], [card("One Piece", "op")]), card("", "op").href);
assert.equal(match(["K-On!"], [card("K-On", "kon")]), card("", "kon").href);
assert.equal(match(["Fate/stay night"], [card("Fate stay night", "fsn")]), card("", "fsn").href);
assert.equal(match(["Re:Zero"], [card("Re Zero", "rz")]), card("", "rz").href);

// Long official titles: the site files "Mushoku Tensei II" as "Mushoku Tensei
// Ⅱ: Isekai Ittara Honki Dasu". Strict scoring (symmetric min) rejects the
// subtitle, and the S1-cour-2 sibling collides once seasons are folded — so the
// rails-only loose pass rescues it and picks the shortest raw title (the main
// entry over the "2nd Cour" variants).
const matchLoose = (names: string[], cards: ReturnType<typeof card>[]) =>
  matchWitanimeTitle(names, cards, tm_seasonNum, { allowLoose: true });
const mushoku = [
  card("Mushoku Tensei: Isekai Ittara Honki Dasu 2nd Cour", "mt-s1p2"),
  card("Mushoku Tensei: Isekai Ittara Honki Dasu", "mt-s1"),
  card("Mushoku Tensei Ⅱ: Isekai Ittara Honki Dasu 2nd Cour", "mt-s2p2"),
  card("Mushoku Tensei Ⅱ: Isekai Ittara Honki Dasu", "mt-s2"),
];
assert.equal(match(["Mushoku Tensei II"], mushoku), null);
assert.equal(matchLoose(["Mushoku Tensei II"], mushoku), card("", "mt-s2").href);
// The loose pass must not leak a different anime in.
assert.equal(matchLoose(["Naruto"], [card("Boruto Naruto Next Generations")]), null);
// ...and a strict winner is never displaced by a long-form sibling.
assert.equal(matchLoose(["Bleach"], [card("Bleach", "bleach"), card("Bleach: Sennen Kessen-hen", "tybw")]), card("", "bleach").href);

// The related rail must not surface the site's generic genre suggestions for
// anime with no real relations (a new show's "ذات صلة" is other popular titles,
// e.g. BLACK TORCH → Kimetsu/Bleach/JJK).
assert.deepEqual(
  witRelatedCards(["BLACK TORCH"], [
    { title: "Kimetsu no Yaiba Yuukaku-hen" },
    { title: "BLEACH: Sennen Kessen-hen - Kashin-tan -" },
    { title: "JUJUTSU KAISEN" },
  ]),
  [],
);
// ...while genuine franchise entries survive (base is a whole-word prefix).
assert.deepEqual(
  witRelatedCards(["Mushoku Tensei II"], [
    { title: "Mushoku Tensei Ⅱ: Isekai Ittara Honki Dasu" },
    { title: "Mushoku Tensei: Isekai Ittara Honki Dasu 2nd Cour" },
    { title: "Dororo" },
  ]).map((c) => c.title),
  ["Mushoku Tensei Ⅱ: Isekai Ittara Honki Dasu", "Mushoku Tensei: Isekai Ittara Honki Dasu 2nd Cour"],
);
// A short base keeps its franchise sequels/cour cards (prefix from the card side).
assert.equal(witRelatedCards(["Bleach"], [{ title: "BLEACH: Sennen Kessen-hen - Kashin-tan -" }]).length, 1);
// Word-prefix, not substring: "One Punch Man" is not related to "One Piece".
assert.deepEqual(witRelatedCards(["One Piece"], [{ title: "One Punch Man" }]), []);
// The site's h1 spelling can bridge a differently-spelled app title.
assert.equal(witRelatedCards(["هجوم العمالقة", "Shingeki no Kyojin"], [{ title: "Shingeki no Kyojin Season 2" }]).length, 1);

// Relation marks for the related rail: the source labels no relation types, so
// the mark is derived from its own titles/formats (AniList-style).
const mark = (bases: string[], title: string, type?: string | null, href = "") =>
  witRelationMark(bases, { title, type, href }, tm_seasonNum);
// Bleach page (S1): a movie badge/path reads فيلم, a subtitle sequel reads تكملة.
assert.equal(mark(["Bleach"], "Bleach Movie 1: Memories of Nobody", "فيلم"), "فيلم");
assert.equal(mark(["Bleach"], "BLEACH: Sennen Kessen-hen - Kashin-tan -", null, "https://witanime.site/movie/bleach-sennen-kessen-hen-kashin-tan-movie"), "فيلم");
assert.equal(mark(["Bleach"], "BLEACH: Sennen Kessen-hen"), "تكملة");
// Mushoku Tensei II page: season numbers decide next/previous.
assert.equal(mark(["Mushoku Tensei II"], "Mushoku Tensei: Isekai Ittara Honki Dasu"), "الموسم السابق");
assert.equal(mark(["Mushoku Tensei II"], "Mushoku Tensei Ⅱ: Isekai Ittara Honki Dasu"), "تكملة");
assert.equal(mark(["Mushoku Tensei II"], "Mushoku Tensei Ⅲ: Isekai Ittara Honki Dasu"), "الموسم القادم");
// The reversed prefix is the earlier work.
assert.equal(mark(["Bleach: Sennen Kessen-hen"], "Bleach"), "ما قبلها");
// Format wins over season parsing: a movie's Roman numeral ("Heaven's Feel II")
// must not read as a later season.
assert.equal(mark(["Fate/stay night"], "Fate/stay night: Heaven's Feel II. lost butterfly", "فيلم"), "فيلم");
assert.equal(mark(["Kizumonogatari"], "Kizumonogatari Part 2: Nekketsu", null, "https://witanime.site/movie/kizumonogatari-part-2-nekketsu"), "فيلم");
// The caller always passes several spellings (app title + page h1): a card
// equal to the anime's own short spelling is the same work, not its prequel.
assert.equal(mark(["Mushoku Tensei II", "Mushoku Tensei Ⅱ: Isekai Ittara Honki Dasu"], "Mushoku Tensei II"), "ذات صلة");
assert.equal(mark(["Mushoku Tensei II", "Mushoku Tensei Ⅱ: Isekai Ittara Honki Dasu"], "Mushoku Tensei: Isekai Ittara Honki Dasu"), "الموسم السابق");
// Format-only marks and the generic fallback.
assert.equal(mark(["Naruto"], "Naruto Special", "Special"), "حلقة خاصة");
assert.equal(mark(["Naruto"], "Naruto OVA", "OVA"), "OVA");
assert.equal(mark(["Naruto"], "Naruto"), "ذات صلة");
// A card sharing no base with the anime gets no mark at all.
assert.equal(mark(["Naruto"], "One Punch Man"), "");

const anime = "https://witanime.site/anime/one-piece";
const html = '<a href="/watch/other/12">wrong anime</a><a href="/watch/one-piece/11">wrong episode</a><a href="/watch/one-piece/12">correct</a>';
assert.equal(witEpisodeLink(html, anime, 12), "https://witanime.site/watch/one-piece/12");
assert.equal(witEpisodeLink(html, anime, 13), null);
assert.equal(witEpisodeLink('<a href="https://evil.test/watch/one-piece/12">', anime, 12), null);

async function main() {
  let reads = 0;
  const url = await resolveWitanimeEpisode("King's Game", 12, null,
    async (query) => query.includes("Ousama") ? [card("Ousama Game", "ousama-game")] : [],
    async () => ["Ousama Game"], tm_seasonNum,
    async () => { reads++; return '<a href="/watch/ousama-game/12">12</a>'; });
  assert.equal(url, "https://witanime.site/watch/ousama-game/12");
  assert.equal(reads, 1);
  assert.equal(await resolveWitanimeEpisode("", 12, anime, async () => { throw Error("Known URL should skip search"); },
    async () => [], tm_seasonNum, async () => html), "https://witanime.site/watch/one-piece/12");

  // Cross-source discovery for a mixed-script episode title: exactly ONE search
  // must fire (the site answers 429 to a parallel burst and the lookup used to
  // lose every server over it).
  const queries: string[] = [];
  const mixed = await resolveWitanimeEpisode("ون بيس One Piece", 1179, null,
    async (query) => { queries.push(query); return [card("One Piece", "one-piece")]; },
    async () => { throw Error("aliases must not be needed"); }, tm_seasonNum,
    async (url) => url.endsWith("/anime/one-piece") ? '<a href="/watch/one-piece/1179">1179</a>' : "");
  assert.equal(mixed, "https://witanime.site/watch/one-piece/1179");
  assert.equal(queries.length, 1);

  // A title only the site's spelling resolves still walks the query plan.
  const slowQueries: string[] = [];
  const viaPlan = await resolveWitanimeEpisode("Some Obscure Show", 3, null,
    async (query) => { slowQueries.push(query); return query === "obscure" ? [card("Some Obscure Show", "some-obscure-show")] : []; },
    async () => [], tm_seasonNum,
    async () => '<a href="/watch/some-obscure-show/3">3</a>');
  assert.equal(viaPlan, "https://witanime.site/watch/some-obscure-show/3");
  assert.ok(slowQueries.length > 1 && slowQueries.includes("obscure"));
  // A stale known/cached anime page must fall back to the title search instead
  // of reporting "no Witanime copy" for that episode.
  const staleSearches: string[] = [];
  const recovered = await resolveWitanimeEpisode("Some Show", 4, "https://witanime.site/anime/some-show-renamed",
    async (query) => { staleSearches.push(query); return [card("Some Show", "some-show")]; },
    async () => [], tm_seasonNum,
    async (url) => url.includes("renamed") ? '<a href="/watch/other/4">4</a>' : '<a href="/watch/some-show/4">4</a>');
  assert.equal(recovered, "https://witanime.site/watch/some-show/4");
  assert.ok(staleSearches.length >= 1, "a stale anime page must trigger the search fallback");

  console.log("Witanime matching: spelling, aliases, seasons, mixed script, ambiguity and exact episode passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

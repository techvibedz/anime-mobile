import assert from "node:assert/strict";
import { matchWitanimeTitle, resolveWitanimeEpisode, witEpisodeLink } from "./witanimeMatch";
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

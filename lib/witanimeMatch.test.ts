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
  console.log("Witanime matching: spelling, aliases, seasons, ambiguity and exact episode passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

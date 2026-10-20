import assert from "node:assert/strict";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetchAniListDetail, fetchUpcomingAnimePage, sortUpcomingAnime, formatStartDate } from "./seasons";

AsyncStorage.getItem = async () => null;
AsyncStorage.setItem = async () => {};

const originalFetch = globalThis.fetch;
const calls: string[] = [];
// "down" = AniList refuses (403) so the Kitsu fallback is exercised.
let anilist: "up" | "down" = "down";
globalThis.fetch = (async (input, init) => {
  const url = String(input);
  calls.push(url);
  if (url.includes("anilist.co") && anilist === "up") {
    const page = JSON.parse(String(init?.body ?? "{}")).variables?.page;
    if (page === 2) return new Response("", { status: 500 });
    const base = { format: "TV", averageScore: null, episodes: null, genres: ["Fantasy"], status: "NOT_YET_RELEASED", isAdult: false, coverImage: { large: "https://example.com/a.jpg" } };
    return new Response(JSON.stringify({ data: { Page: { pageInfo: { hasNextPage: true }, media: [
      { ...base, id: 1, title: { romaji: "Year Only" }, popularity: 900, countryOfOrigin: "JP", startDate: { year: 2027, month: null, day: null } },
      { ...base, id: 2, title: { romaji: "Exact Day" }, popularity: 100, countryOfOrigin: "JP", startDate: { year: 2027, month: 3, day: 10 } },
      { ...base, id: 3, title: { romaji: "Not Japanese" }, popularity: 999, countryOfOrigin: "CN", startDate: { year: 2027, month: 1, day: 1 } },
    ] } } }), { status: 200 });
  }
  if (url.includes("anilist.co")) return new Response("", { status: 403 });
  if (url.includes("/anime/45666?")) return new Response(JSON.stringify({
    data: {
      id: "45666",
      type: "anime",
      attributes: {
        slug: "mahoutsukai-no-yoru",
        canonicalTitle: "Mahoutsukai no Yoru",
        titles: { en: "Witch on the Holy Night", en_jp: "Mahoutsukai no Yoru" },
        synopsis: "A detailed synopsis.",
        posterImage: { large: "https://example.com/detail-poster.jpg" },
        coverImage: { large: "https://example.com/banner.jpg" },
        subtype: "movie",
        averageRating: "82.5",
        episodeCount: 1,
        episodeLength: 120,
        startDate: "2026-11-20",
        status: "upcoming",
        youtubeVideoId: "trailer-id",
        ageRating: "PG",
        nsfw: false,
      },
    },
    included: [
      { id: "150", type: "categories", attributes: { title: "Action", nsfw: false } },
      { id: "42951", type: "anime", attributes: { canonicalTitle: "Related Anime", titles: {}, posterImage: { large: "https://example.com/related.jpg" }, subtype: "TV", nsfw: false } },
      { id: "32978", type: "mediaRelationships", attributes: { role: "prequel" }, relationships: { destination: { data: { type: "anime", id: "42951" } } } },
    ],
  }), { status: 200, headers: { "Content-Type": "application/vnd.api+json" } });
  if (url.includes("page%5Boffset%5D=20")) return new Response(JSON.stringify({ data: [], included: [], links: { next: null } }), {
    status: 200,
    headers: { "Content-Type": "application/vnd.api+json" },
  });
  // A failed page must THROW, not read as "no more items".
  if (url.includes("page%5Boffset%5D=40")) return new Response("", { status: 500 });
  return new Response(JSON.stringify({
    data: [{
      id: "45666",
      type: "anime",
      attributes: {
        canonicalTitle: "Mahoutsukai no Yoru",
        titles: { en_jp: "Mahoutsukai no Yoru" },
        posterImage: { large: "https://example.com/poster.jpg" },
        subtype: "movie",
        averageRating: null,
        episodeCount: 1,
        startDate: "2026-11-20",
        userCount: 1871,
        ageRating: "PG",
      },
      relationships: { mappings: { data: [{ type: "mappings", id: "313567" }] } },
    }],
    included: [{
      type: "mappings",
      id: "313567",
      attributes: { externalSite: "anilist/anime", externalId: "143103" },
    }],
    links: { next: "https://kitsu.app/api/edge/anime?page%5Boffset%5D=20" },
  }), { status: 200, headers: { "Content-Type": "application/vnd.api+json" } });
}) as typeof fetch;

async function main() {
  try {
    // ── AniList is the primary source ──
    anilist = "up";
    const ani = await fetchUpcomingAnimePage(1, true);
    assert.equal(ani.hasNext, true);
    assert.deepEqual(ani.items.map((i) => i.title), ["Year Only", "Exact Day"], "non-JP titles are dropped");
    assert.equal(ani.items[0].startPrecision, "year");
    assert.equal(ani.items[1].startPrecision, undefined, "an exact day carries no precision flag");
    assert.equal(formatStartDate(ani.items[0].startAt, "year"), "2027");
    assert.equal(formatStartDate(ani.items[0].startAt, "month"), "يناير 2027");
    // "2027" must not sort ahead of a confirmed 10 March 2027.
    assert.deepEqual(sortUpcomingAnime(ani.items, "soon").map((i) => i.id), [2, 1]);
    // A later AniList page failing must throw (screen retries), never fall back
    // to Kitsu mid-list.
    const before = calls.length;
    await assert.rejects(() => fetchUpcomingAnimePage(2, true), /HTTP 500/);
    assert.equal(calls.length, before + 1, "no Kitsu request for a failed later page");

    // ── AniList down → page 1 falls back to Kitsu ──
    anilist = "down";
    calls.length = 0;
    const firstPage = await fetchUpcomingAnimePage(1);
    const items = firstPage.items;
    assert.equal(calls.length, 2, "AniList attempt, then Kitsu");
    assert.equal(firstPage.hasNext, true);
    assert.equal(items.length, 1);
    assert.deepEqual(items[0], {
      id: 143103,
      kitsuId: 45666,
      title: "Mahoutsukai no Yoru",
      image: "https://example.com/poster.jpg",
      format: "MOVIE",
      score: null,
      episodes: 1,
      genres: [],
      status: "NOT_YET_RELEASED",
      startAt: 1795132800,
      popularity: 1871,
    });
    assert.deepEqual(
      sortUpcomingAnime([
        items[0],
        { ...items[0], id: 2, popularity: 5000, startAt: 1800000000 },
        { ...items[0], id: 3, popularity: 100, startAt: null },
      ], "popular").map((item) => item.id),
      [2, 143103, 3],
    );
    assert.deepEqual(
      sortUpcomingAnime([
        items[0],
        { ...items[0], id: 2, popularity: 5000, startAt: 1800000000 },
        { ...items[0], id: 3, popularity: 100, startAt: null },
      ], "soon").map((item) => item.id),
      [143103, 2, 3],
    );
    await assert.rejects(() => fetchUpcomingAnimePage(2), /HTTP 403/, "page 2 never mixes in Kitsu");
    const detail = await fetchAniListDetail(143103, 45666);
    assert.equal(calls.length, 5);
    assert.equal(detail?.description, "A detailed synopsis.");
    assert.equal(detail?.banner, "https://example.com/banner.jpg");
    assert.equal(detail?.cover, "https://example.com/detail-poster.jpg");
    assert.equal(detail?.startAt, 1795132800);
    assert.deepEqual(detail?.genres, ["Action"]);
    assert.deepEqual(detail?.relations[0], {
      id: -42951,
      kitsuId: 42951,
      title: "Related Anime",
      image: "https://example.com/related.jpg",
      format: "TV",
      relation: "PREQUEL",
    });
    console.log("seasons upcoming + fallback tests passed");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void main();

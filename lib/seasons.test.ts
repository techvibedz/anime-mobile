import assert from "node:assert/strict";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetchAniListDetail, fetchUpcomingAnimePage, sortUpcomingAnime } from "./seasons";

AsyncStorage.getItem = async () => null;
AsyncStorage.setItem = async () => {};

const originalFetch = globalThis.fetch;
const calls: string[] = [];
globalThis.fetch = (async (input) => {
  const url = String(input);
  calls.push(url);
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
  if (url.includes("page%5Boffset%5D=40")) return new Response(JSON.stringify({ data: [], included: [] }), {
    status: 200,
    headers: { "Content-Type": "application/vnd.api+json" },
  });
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
    links: { next: null },
  }), { status: 200, headers: { "Content-Type": "application/vnd.api+json" } });
}) as typeof fetch;

async function main() {
  try {
    const firstPage = await fetchUpcomingAnimePage(1);
    const items = firstPage.items;
    assert.equal(calls.length, 1);
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
    const lastPage = await fetchUpcomingAnimePage(2);
    assert.equal(lastPage.hasNext, false);
    assert.deepEqual(lastPage.items, []);
    const detail = await fetchAniListDetail(143103, 45666);
    assert.equal(calls.length, 4);
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
    console.log("seasons fallback tests passed");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void main();

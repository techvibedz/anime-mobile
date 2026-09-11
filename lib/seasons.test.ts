import assert from "node:assert/strict";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetchUpcomingAnime } from "./seasons";

AsyncStorage.getItem = async () => null;
AsyncStorage.setItem = async () => {};

const originalFetch = globalThis.fetch;
const calls: string[] = [];
globalThis.fetch = (async (input) => {
  const url = String(input);
  calls.push(url);
  if (url.includes("anilist.co")) return new Response("", { status: 403 });
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
  }), { status: 200, headers: { "Content-Type": "application/vnd.api+json" } });
}) as typeof fetch;

async function main() {
  try {
    const items = await fetchUpcomingAnime();
    assert.equal(calls.length, 2);
    assert.equal(items.length, 1);
    assert.deepEqual(items[0], {
      id: 143103,
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
    console.log("seasons fallback tests passed");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void main();

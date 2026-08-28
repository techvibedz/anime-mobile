import assert from "node:assert";
import { favoriteKey, isAnimeDetailUrl, toAnimeUrl } from "./favoritesIdentity";

assert.equal(
  favoriteKey("https://witanime.life/anime/naruto/?ref=home"),
  favoriteKey("https://witanime.you/anime/Naruto"),
);
assert.equal(
  favoriteKey("https://w1.anime4up.rest/anime/naruto/"),
  favoriteKey("https://anime4up.rest/anime/naruto"),
);
assert.equal(isAnimeDetailUrl("https://anime3rb.com/titles/naruto"), true);
assert.equal(isAnimeDetailUrl("https://anime3rb.com/episode/naruto/1"), false);
assert.ok(toAnimeUrl("https://witanime.you/episode/naruto-الحلقة-12/")?.includes("/anime/naruto"));

console.log("favorites identity tests passed");

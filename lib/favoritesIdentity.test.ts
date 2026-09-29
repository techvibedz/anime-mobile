import assert from "node:assert";
import { favoriteKey, isAnimeDetailUrl, isEpisodeUrl, toAnimeUrl } from "./favoritesIdentity";

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

// Witanime episode pages are /watch/<slug>/<n> — they must be recognized as
// episodes and converted to their /anime/<slug> page (the old check only knew
// /episode/, so these were routed to the anime screen as if they were anime).
assert.equal(isEpisodeUrl("https://witanime.site/watch/one-piece/1180"), true);
assert.equal(isEpisodeUrl("https://witanime.site/anime/one-piece"), false);
assert.equal(isEpisodeUrl("https://witanime.site/watch/stream-gate/token"), false);
assert.equal(isEpisodeUrl("https://anime3rb.com/episode/naruto/1"), true);
assert.equal(isEpisodeUrl("https://w1.anime4up.rest/episode/anime-bleach-الحلقة-3-مترجمة/"), true);
assert.equal(
  toAnimeUrl("https://witanime.site/watch/tensei-shitara-slime-datta-ken-4th-season/24"),
  "https://witanime.site/anime/tensei-shitara-slime-datta-ken-4th-season",
);
// Query/hash must not stop the conversion; ep-numbered movie watches resolve
// to the movie page too.
assert.equal(isEpisodeUrl("https://witanime.site/watch/one-piece/1180?ref=home"), true);
assert.equal(
  toAnimeUrl("https://witanime.site/watch/one-piece/1180?ref=home"),
  "https://witanime.site/anime/one-piece",
);
assert.equal(
  toAnimeUrl("https://witanime.site/watch/movie/kusunoki-no-bannin/1"),
  "https://witanime.site/movie/kusunoki-no-bannin",
);

// anime4up slugs its episodes with the anime name ("انمي-<slug>") while its
// anime page is "/anime/<slug>" — the prefix must not survive the conversion.
assert.equal(
  toAnimeUrl("https://w1.anime4up.rest/episode/%d8%a7%d9%86%d9%85%d9%8a-bleach-sennen-kessen-hen-kashin-tan-%d8%a7%d9%84%d8%ad%d9%84%d9%82%d8%a9-7-%d9%85%d8%aa%d8%b1%d8%ac%d9%85%d8%a9/"),
  "https://w1.anime4up.rest/anime/bleach-sennen-kessen-hen-kashin-tan/",
);

// Witanime movie pages are detail pages too (the hero shows them), and must
// not be confused with their /watch/movie/<slug> player pages.
assert.equal(isAnimeDetailUrl("https://witanime.site/movie/kusunoki-no-bannin"), true);
assert.equal(isAnimeDetailUrl("https://witanime.site/watch/movie/kusunoki-no-bannin"), false);
assert.equal(isEpisodeUrl("https://witanime.site/watch/movie/kusunoki-no-bannin"), true);
assert.equal(
  toAnimeUrl("https://witanime.site/watch/movie/kusunoki-no-bannin"),
  "https://witanime.site/movie/kusunoki-no-bannin",
);
assert.equal(
  favoriteKey("https://witanime.site/movie/kusunoki-no-bannin/"),
  favoriteKey("https://www.witanime.site/movie/kusunoki-no-bannin"),
);

console.log("favorites identity tests passed");

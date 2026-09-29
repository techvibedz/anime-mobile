import assert from "node:assert/strict";
import { parseAnime4upHomeHtml } from "./direct";
import { dedupeRecentEpisodes, loadWitanimeHome, mergeRecentEpisodes } from "../homeSourceSelection";

const html = `
  <a href="https://w1.anime4up.rest/episode/anime-bleach-الحلقة-3-مترجمة/"
     class="lucodeia-slider-slide-item"
     style="background-image:url('https://img.example/bleach.jpg')">
    <div class="lucodeia-slider-meta"><h2>Bleach الحلقة 3</h2></div>
  </a>
  <div class="anime-card-container">
    <div class="anime-card-poster">
      <a class="overlay" href="https://w1.anime4up.rest/anime/bleach/"></a>
      <img data-src="https://img.example/poster.jpg" />
    </div>
    <div class="anime-card-title"><h3><a href="https://w1.anime4up.rest/anime/bleach/">Bleach</a></h3></div>
    <div class="anime-card-type"><a>TV</a></div>
  </div>`;

async function main() {
  const home = parseAnime4upHomeHtml(html);
  assert.ok(home);
  assert.equal(home.featured[0]?.title, "Bleach");
  assert.equal(home.featured[0]?.href, "https://w1.anime4up.rest/episode/anime-bleach-الحلقة-3-مترجمة/");
  assert.equal(home.episodes[0]?.title, "الحلقة 3");
  assert.equal(home.episodes[0]?.animeTitle, "Bleach");
  assert.equal(home.animes[0]?.title, "Bleach");
  assert.equal(home.animes[0]?.type, "TV");

  let webViewCalls = 0;
  assert.equal(await loadWitanimeHome(async () => home, async () => {
    webViewCalls += 1;
    return null;
  }), home);
  assert.equal(webViewCalls, 0);

  assert.equal(await loadWitanimeHome(async () => null, async () => {
    webViewCalls += 1;
    return home;
  }), home);
  assert.equal(webViewCalls, 1);

  assert.equal(await loadWitanimeHome(
    async () => { throw new Error("direct failed"); },
    async () => { throw new Error("webView failed"); },
  ), null);

  // Recent-episodes merge: anime4up's batch-upload page can de-dupe to a
  // couple of animes; the witanime feed backfills the rail, without repeating
  // an anime the primary already carries. The cross-source case matters: the
  // same anime has a different animeHref per site ("Liar Game" vs "LIAR GAME").
  const primary = [
    { href: "https://up4/ep/1", animeHref: "https://up4/anime/liar-game", animeTitle: "Liar Game" },
    { href: "https://up4/ep/2", animeHref: "https://up4/anime/sakura", animeTitle: "Sakura-sou no Pet na Kanojo" },
  ];
  const fallback = [
    { href: "https://wit/ep/liar", animeHref: "https://wit/anime/liar-game", animeTitle: "LIAR GAME" },
    { href: "https://up4/ep/1b", animeHref: "https://up4/anime/liar-game/", animeTitle: "لعبة الكذب" },
    { href: "https://wit/ep/sakura", animeHref: null, animeTitle: "Sakura-sou no Pet na Kanojo" },
    { href: "https://wit/ep/op", animeHref: "https://wit/anime/one-piece", animeTitle: "One Piece" },
  ];
  assert.deepEqual(
    mergeRecentEpisodes(primary, fallback).map((ep) => ep.href),
    ["https://up4/ep/1", "https://up4/ep/2", "https://wit/ep/op"],
  );
  assert.deepEqual(mergeRecentEpisodes([], fallback).map((ep) => ep.href), [
    "https://wit/ep/liar", "https://up4/ep/1b", "https://wit/ep/sakura", "https://wit/ep/op",
  ]);
  assert.deepEqual(mergeRecentEpisodes(primary, []), primary);

  // See-all de-dupe: one anime from two sources (different animeHrefs) must
  // collapse to a single card; titles normalize ("Liar Game" vs "LIAR GAME").
  {
    const seen = new Set<string>();
    const deduped = dedupeRecentEpisodes(
      [
        { href: "https://up4/ep/1", animeHref: "https://up4/anime/liar-game", animeTitle: "Liar Game" },
        { href: "https://wit/ep/liar", animeHref: "https://wit/anime/liar-game", animeTitle: "LIAR GAME" },
        { href: "https://up4/ep/2", animeHref: "https://up4/anime/sakura", animeTitle: "Sakura-sou no Pet na Kanojo" },
      ],
      seen,
    );
    assert.deepEqual(deduped.map((ep) => ep.href), ["https://up4/ep/1", "https://up4/ep/2"]);
    // A later page must not re-add the same anime even when its href varies
    // only by a trailing slash or via the other source's title.
    const next = dedupeRecentEpisodes(
      [
        { href: "https://up4/ep/9", animeHref: "https://up4/anime/liar-game/", animeTitle: "لعبة الكذب" },
        { href: "https://wit/ep/liar-2", animeHref: "https://wit/anime/liar-game-2", animeTitle: "Liar Game" },
      ],
      seen,
    );
    assert.deepEqual(next, []);
  }

  console.log("home fallback tests passed");
}

void main();

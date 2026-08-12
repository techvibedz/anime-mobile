import assert from "node:assert/strict";
import { parseAnime4upHomeHtml } from "./direct";
import { loadWitanimeHome } from "../homeSourceSelection";

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
    async () => { throw new Error("webview failed"); },
  ), null);

  console.log("home fallback tests passed");
}

void main();

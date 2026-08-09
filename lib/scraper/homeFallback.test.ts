import assert from "node:assert/strict";
import { parseAnime4upHomeHtml } from "./direct";
import { selectHomeSource } from "../homeSourceSelection";

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

  const started = Date.now();
  const selected = await selectHomeSource([
    { source: "witanime", load: () => new Promise<null>(() => {}) },
    { source: "anime4up", load: async () => home },
    { source: "anime3rb", load: async () => null },
  ], 10, 100);
  assert.equal(selected?.source, "anime4up");
  assert.ok(Date.now() - started < 80, "secondary source must not wait for blocked primary");

  const preferred = await selectHomeSource([
    { source: "witanime", load: () => new Promise((resolve) => setTimeout(() => resolve(home), 5)) },
    { source: "anime4up", load: async () => home },
  ], 20, 100);
  assert.equal(preferred?.source, "witanime");

  console.log("home fallback tests passed");
}

void main();

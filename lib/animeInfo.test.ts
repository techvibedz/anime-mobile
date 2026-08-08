import assert from "node:assert";
import { buildAniListFields, fetchAnimeMal, fetchMalPrefix, mergeMalFallback, parseMalHtml, parseMalPrefix, pickMalCandidate, shouldReplaceMalCache } from "./animeInfo";

const html = `
  <div class="spaceit_pad"><span class="dark_text">Type:</span> TV</div>
  <div class="spaceit_pad"><span class="dark_text">Status:</span> Currently Airing</div>
  <div class="spaceit_pad"><span class="dark_text">Studios:</span> <a>Toei Animation</a></div>
  <div class="spaceit_pad"><span class="dark_text">Source:</span> Manga</div>
  <span itemprop="ratingValue" class="score-label">8.73</span>`;

const parsed = parseMalHtml(html);
assert.equal(parsed.score, 8.73);
assert.deepEqual(parsed.fields, [
  { label: "النوع", value: "مسلسل" },
  { label: "الحالة", value: "يُعرض حالياً" },
  { label: "الاستوديو", value: "Toei Animation" },
  { label: "المصدر", value: "مانغا" },
]);
assert.equal(parseMalHtml('<span itemprop="ratingValue">N/A</span>').score, null);

const mobile = parseMalHtml(`
  <div class="js-detail-information"><table class="table-list">
    <tr><td class="list-title">Type</td><td><a>TV</a></td></tr>
    <tr><td class="list-title">Premiered</td><td><a>Summer 2026</a></td></tr>
    <tr><td class="list-title">Duration</td><td>23 min. per ep.</td></tr>
    <tr><td class="list-title">Rating</td><td>R - 17+ (violence &amp; profanity)</td></tr>
  </table></div>`);
assert.deepEqual(mobile.fields, [
  { label: "النوع", value: "مسلسل" },
  { label: "الموسم", value: "صيف 2026" },
  { label: "مدة الحلقة", value: "23 min. per ep." },
  { label: "التصنيف العمري", value: "+17 سنة" },
]);

const ranked = parseMalHtml(`
  <div class="spaceit_pad"><span class="dark_text">Ranked:</span>
    #54<sup>2</sup><div class="statistics-info"><small><sup>2</sup> based on the top anime page</small></div>
  </div>`);
assert.deepEqual(ranked.fields, [{ label: "الترتيب", value: "#54" }]);

const prefix = parseMalPrefix({ categories: [{ type: "anime", items: [
  { id: 12859, name: "One Piece Film: Z", url: "https://myanimelist.net/anime/12859", payload: { media_type: "Movie", score: "8.10", status: "Finished Airing", aired: "Dec 15, 2012" } },
  { id: 21, name: "One Piece", url: "https://myanimelist.net/anime/21", payload: { media_type: "TV", score: "8.73", status: "Currently Airing", aired: "Oct 20, 1999 to ?" } },
] }] }, "One Piece");
assert.equal(prefix?.id, 21);
assert.equal(prefix?.data.score, 8.73);
assert.deepEqual(prefix?.data.fields.slice(0, 2), [
  { label: "النوع", value: "مسلسل" },
  { label: "الحالة", value: "يُعرض حالياً" },
]);

assert.deepEqual(mergeMalFallback(
  prefix!.data,
  null,
  [{ label: "الاستوديو", value: "Fallback Studio" }],
), {
  score: 8.73,
  fields: [{ label: "الاستوديو", value: "Fallback Studio" }],
  _complete: false,
});

assert.equal(shouldReplaceMalCache(
  { score: 8.73, fields: [{ label: "النوع", value: "مسلسل" }], _complete: true },
  { score: 8.73, fields: [], _complete: false },
), false);
assert.equal(shouldReplaceMalCache(
  { score: 8.73, fields: [], _complete: false },
  { score: 8.73, fields: [{ label: "النوع", value: "مسلسل" }], _complete: true },
), true);

assert.deepEqual(buildAniListFields({
  format: "TV",
  status: "RELEASING",
  episodes: 14,
  season: "SUMMER",
  seasonYear: 2026,
  source: "LIGHT_NOVEL",
  studios: { nodes: [{ name: "Studio Bind" }] },
}), [
  { label: "النوع", value: "مسلسل" },
  { label: "الحالة", value: "يُعرض حالياً" },
  { label: "عدد الحلقات", value: "14" },
  { label: "الموسم", value: "صيف 2026" },
  { label: "المصدر", value: "رواية خفيفة" },
  { label: "الاستوديو", value: "Studio Bind" },
]);

const seasonHit = pickMalCandidate([
  { mal_id: 1, title: "Jujutsu Kaisen" },
  { mal_id: 2, title: "Jujutsu Kaisen 2nd Season" },
], "Jujutsu Kaisen الموسم الثاني");
assert.equal(seasonHit?.mal_id, 2);
assert.equal(pickMalCandidate([{ mal_id: 3, title: "Naruto" }], "Frieren"), null);

async function testFastPrefix() {
  const prefixUrls: string[] = [];
  const fastPrefix = await fetchMalPrefix("One Piece", async (url) => {
    prefixUrls.push(url);
    return JSON.stringify({ categories: [{ type: "anime", items: [
      { id: 21, name: "One Piece", url: "https://myanimelist.net/anime/21", payload: { score: "8.73" } },
    ] }] });
  });
  assert.equal(fastPrefix?.data.score, 8.73);
  assert.equal(prefixUrls.length, 1);
  assert.match(prefixUrls[0], /search\/prefix\.json/);
}

async function testScoreMissStaysLightweight() {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    if (/search\/prefix\.json/.test(url)) {
      return new Response(JSON.stringify({ categories: [{ type: "anime", items: [] }] }), { status: 200 });
    }
    return new Response("", { status: 504 });
  };
  try {
    const started = Date.now();
    const result = await fetchAnimeMal("Pantoufa Missing Rating");
    assert.equal(result.score, null);
    assert.ok(Date.now() - started < 500, "score miss should not wait for retry backoff");
    assert.equal(urls.some((url) => /graphql\.anilist\.co|myanimelist\.net\/anime\//.test(url)), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void (async () => {
  await testFastPrefix();
  await testScoreMissStaysLightweight();
  console.log("anime info tests passed");
})();

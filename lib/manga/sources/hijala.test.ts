import assert from "node:assert/strict";
import {
  enclosingObject,
  hijalaChapterNum,
  hijalaChapterUrl,
  hijalaPage,
  hijalaSearchUrl,
  hijalaSlug,
  HIJALA_PAGE_SIZE,
  parseHijalaCards,
  parseHijalaChapter,
  parseHijalaChapters,
  parseHijalaDetail,
  parseHijalaHome,
  rscPayload,
} from "./hijala";

// Shapes trimmed from live hijala.org responses (2026-11-13): the JSON API and
// the Next.js RSC flight payload (`self.__next_f.push([1,"<escaped>"])`).

/** Wrap a JS value the way Next.js streams it: JSON text inside a JS string,
 * split across two push chunks. */
function rscHtml(value: unknown): string {
  const text = `5:["$","div",null,${JSON.stringify(value)}]`;
  const mid = Math.floor(text.length / 2);
  const chunk = (s: string) => `<script>self.__next_f.push([1,${JSON.stringify(s)}])</script>`;
  return `<html><body><div>x</div>${chunk(text.slice(0, mid))}${chunk(text.slice(mid))}</body></html>`;
}

const SEARCH = JSON.stringify({
  success: true,
  series: [
    {
      id: "fog-land", realId: 113, title: "Fog Land",
      image: "https://hijala.org/hijala-cdn/series_covers/6a5b9ffc2a246_f3af5f73.jpg",
      type: "Manhwa", genre: "Drama, Action", rating: 4.9, status: "Ongoing", views: 10,
      chapters: [{ id: 10202, num: "Chapter 62", locked: false }],
    },
    {
      id: "lookism", realId: 25, title: "Lookism", image: "series_covers/lk.jpg",
      type: "Manhwa", genre: "Action", rating: 0, status: "Completed", views: 900,
      chapters: [{ id: 1, num: "Chapter 634" }],
    },
    { id: "fog-land", title: "Fog Land duplicate", chapters: [] },
    { id: "", title: "no id" },
  ],
});

const POPULAR = JSON.stringify({
  success: true,
  popular: [{ id: "lookism", title: "Lookism", image: "https://hijala.org/hijala-cdn/series_covers/lk.jpg", rating: "9.9", views: 2055 }],
});

const SERIES = {
  id: 113, slug: "fog-land", title: "Fog Land", altTitles: "",
  image: "https://hijala.org/hijala-cdn/series_covers/fog.jpg",
  type: "Manhwa", genre: ["Drama", "Action"], status: "Ongoing", rating: 4.8571,
  totalChapters: 4, author: "Pogo", released: "—",
  synopsis: "سجن دولي {غامض} \"Fog Land\"",
  chapters: [
    { id: 4, num: "62", sub: "اختبار", locked: false, time: "Nov 11, 2026", coins: 0 },
    { id: 3, num: "61.2", sub: "", locked: false, time: "Nov 4, 2026", coins: 0 },
    { id: 2, num: "61", sub: "", locked: true, time: "Nov 1, 2026", coins: 5 },
    { id: 1, num: "1", sub: "", locked: false, time: "Jul 18, 2026", coins: 0 },
  ],
};

const CHAPTER = {
  manga: { id: 113, slug: "fog-land", title: "Fog Land", chapters: [{ id: 1, num: "1" }] },
  currentChapterNum: 62,
  chapterId: 10202,
  pageKeys: [
    "chapters/113_1/a.webp",
    "chapters/113_1/b.webp",
    "chapters/113_1/a.webp",
    "https://hijala.org/hijala-cdn/chapters/113_1/c.webp",
  ],
};

async function main() {
  // ── ids ────────────────────────────────────────────────────────────────────
  assert.equal(hijalaSlug("fog-land"), "fog-land");
  assert.equal(hijalaSlug("https://hijala.org/series/fog-land/chapter-3"), "fog-land");
  assert.equal(hijalaSlug("https://hijala.com/baek-xx/"), "baek-xx", "legacy hijala.com ids keep working");
  assert.equal(hijalaSlug("https://evil.example/solo-leveling/"), null);
  assert.equal(hijalaSlug(""), null);

  assert.equal(hijalaChapterNum("62"), "62");
  assert.equal(hijalaChapterNum("41.2"), "41.2");
  assert.equal(hijalaChapterNum("chapter-41.2"), "41.2");
  assert.equal(hijalaChapterNum("lookism-633", "lookism"), "633", "legacy {slug}-{n}");
  assert.equal(hijalaChapterNum("the-beginning-after-the-end-41-2", "the-beginning-after-the-end"), "41.2");
  assert.equal(hijalaChapterNum("solo-leveling-2-15", "solo-leveling-2"), "15", "digits inside the slug are not the number");
  assert.equal(hijalaChapterNum("https://hijala.com/baek-xx-154/", "baek-xx"), "154");
  assert.equal(hijalaChapterUrl("fog-land", "62"), "https://hijala.org/series/fog-land/chapter-62");
  assert.equal(hijalaChapterUrl("", "62"), null);

  // ── API cards ──────────────────────────────────────────────────────────────
  const cards = parseHijalaCards(SEARCH);
  assert.deepEqual(cards.map((c) => c.id), ["fog-land", "lookism"], "dedupe + drop id-less rows");
  assert.deepEqual(cards[0], {
    source: "hijala", id: "fog-land", title: "Fog Land",
    cover: "https://hijala.org/hijala-cdn/series_covers/6a5b9ffc2a246_f3af5f73.jpg",
    type: "مانهوا", status: "مستمر", rating: "4.9", latest: "الفصل 62",
  });
  assert.equal(cards[1].cover, "https://hijala.org/hijala-cdn/series_covers/lk.jpg", "relative image keys → CDN");
  assert.equal(cards[1].rating, null, "0 = unrated");
  assert.equal(cards[1].status, "مكتمل");
  assert.deepEqual(parseHijalaCards("<html>not json</html>"), []);
  assert.deepEqual(parseHijalaCards(null), []);

  const home = parseHijalaHome(SEARCH, POPULAR);
  assert.ok(home);
  assert.deepEqual(home.sections.map((s) => `${s.id}:${s.kind}:${s.items.length}`), ["latest:latest:2", "popular:ranked:1"]);
  assert.equal(home.featured[0].id, "lookism");
  assert.equal(home.featured[0].rating, "9.9");
  assert.equal(parseHijalaHome(null, null), null);

  // Client-side paging + popular order over the one-shot catalog.
  assert.deepEqual(hijalaPage(SEARCH, 1).map((c) => c.id), ["fog-land", "lookism"]);
  assert.deepEqual(hijalaPage(SEARCH, 1, true).map((c) => c.id), ["lookism", "fog-land"], "views desc");
  assert.deepEqual(hijalaPage(SEARCH, 2), []);
  const big = JSON.stringify({ series: Array.from({ length: 65 }, (_, i) => ({ id: `s${i}`, title: `S ${i}` })) });
  assert.equal(hijalaPage(big, 1).length, HIJALA_PAGE_SIZE);
  assert.equal(hijalaPage(big, 3).length, 5);

  const url = new URL(hijalaSearchUrl(" solo ", { type: "مانجا", status: "مكتمل", sort: "title" }, "Martial Arts"));
  assert.equal(url.origin + url.pathname, "https://hijala.org/api/series/search");
  assert.deepEqual(Object.fromEntries(url.searchParams), { q: "solo", genre: "Martial Arts", status: "Completed", type: "Manga", sort: "A-Z" });
  assert.deepEqual(Object.fromEntries(new URL(hijalaSearchUrl("")).searchParams), { q: "", genre: "Any", status: "Any", type: "Any", sort: "Latest Chapters" });

  // ── RSC payload ────────────────────────────────────────────────────────────
  const payload = rscPayload(rscHtml(SERIES));
  assert.ok(payload.includes('"synopsis":'));
  assert.equal(enclosingObject(payload, '"synopsis":')?.slug, "fog-land", "braces inside strings don't unbalance the scan");
  assert.equal(enclosingObject(payload, '"nope":'), null);

  const detail = parseHijalaDetail(rscHtml(SERIES), "fog-land");
  assert.ok(detail);
  assert.equal(detail.id, "fog-land");
  assert.equal(detail.title, "Fog Land");
  assert.equal(detail.cover, "https://hijala.org/hijala-cdn/series_covers/fog.jpg");
  assert.equal(detail.synopsis, 'سجن دولي {غامض} "Fog Land"');
  assert.deepEqual(detail.genres, ["Drama", "Action"]);
  assert.equal(detail.author, "Pogo");
  assert.equal(detail.year, null, "em dash = unknown");
  assert.equal(detail.rating, "4.9");
  assert.equal(detail.latest, "الفصل 62");
  assert.deepEqual(detail.chapters.map((c) => c.id), ["62", "61.2", "1"], "locked chapter dropped, newest-first");
  assert.equal(detail.chapters[0].title, "اختبار");
  assert.equal(detail.chapters[1].title, null);
  assert.equal(parseHijalaDetail("<html></html>", "x"), null);

  assert.deepEqual(parseHijalaChapters([{ num: "Chapter 3" }, { num: "3" }, { num: "" }, null]).map((c) => c.number), ["3"]);

  const reader = parseHijalaChapter(rscHtml(CHAPTER));
  assert.ok(reader);
  assert.deepEqual(reader.pages, [
    "https://hijala.org/hijala-cdn/chapters/113_1/a.webp",
    "https://hijala.org/hijala-cdn/chapters/113_1/b.webp",
    "https://hijala.org/hijala-cdn/chapters/113_1/c.webp",
  ]);
  assert.equal(reader.title, "Fog Land 62");
  assert.equal(parseHijalaChapter(rscHtml({ ...CHAPTER, pageKeys: [] })), null, "locked/empty chapter → null");
  assert.equal(parseHijalaChapter(""), null);

  console.log("hijala source tests passed");
}

void main();

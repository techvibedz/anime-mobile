import assert from "node:assert/strict";
import {
  hijalaListingUrl,
  hijalaSlug,
  parseHijalaCards,
  parseHijalaChapter,
  parseHijalaChapters,
  parseHijalaDetail,
  parseHijalaHome,
} from "./hijala";

// Trimmed snippets from live hijala.com pages (2026-10-25) — same classes and
// structure, fewer items.

const PLACEHOLDER = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";

const HOME = `
<div class="hotslid"><div class="bixbox hothome full"><div class="releases"><h2>الأعمال الرائجة</h2></div><div class="listupd popularslider"><div class="popconslide"><div class="bs"><div class="bsx">
<a href="https://hijala.com/baek-xx/" title="BAEK XX"><div class="limit"><div class="ply"></div>
<span class="type Manhwa"></span>
<img data-lazyloaded="1" src="${PLACEHOLDER}" data-src="https://hijala.com/wp-content/uploads/2024/07/BAEK-XX-207x300.webp" alt="BAEK XX"/></div><div class="bigor"><div class="tt">
BAEK XX</div><div class="adds"><div class="epxs">فصل 154</div><div class="rt"><div class="rating"><div class="numscore">9</div></div></div></div></div>
</a></div></div></div></div></div></div>
<div class="bixbox"><div class="releases"><h2>أحــدث الأصدارات</h2></div><div class="listupd">
<div class="bs styletere stylefiv"><div class="bsx">
<a href="https://hijala.com/kowloon-soroka/" title="Kowloon: Soroka"><div class="limit"><div class="ply"></div>
<span class="type Manga"></span>
<img data-lazyloaded="1" src="${PLACEHOLDER}" data-src="https://hijala.com/wp-content/uploads/2026/08/w7p3Xr.webp" alt="Kowloon: Soroka"/></div>
</a><div class="bigor"><div class="tt">
<a href="https://hijala.com/kowloon-soroka/" title="Kowloon: Soroka">Kowloon: Soroka</a></div><ul class="chfiv"><li><a href="https://hijala.com/kowloon-soroka-35/"><span class="fivchap">الفصل.  35</span><span class="fivtime">3 ساعات</span></a></li><li><a href="https://hijala.com/kowloon-soroka-34/"><span class="fivchap">الفصل.  34</span></a></li></ul></div></div></div>
<div class="bs styletere stylefiv"><div class="bsx">
<a href="https://hijala.com/shadow-slave/" title="Shadow Slave"><div class="limit">
<span class="type Manhwa"></span>
<img src="https://hijala.com/wp-content/uploads/2026/07/shadow.webp" alt="Shadow Slave"/></div>
</a><div class="bigor"><div class="tt">
<a href="https://hijala.com/shadow-slave/" title="Shadow Slave">Shadow Slave</a></div><ul class="chfiv"><li><a href="https://hijala.com/shadow-slave-14/"><span class="fivchap">الفصل.  14</span></a></li></ul></div></div></div>
</div></div>`;

const SEARCH = `
<div class="listupd"><div class="bs"><div class="bsx">
<a href="https://hijala.com/solo-leveling/" title="Solo Leveling"><div class="limit">
<span class="type Manhwa"></span>
<img src="https://hijala.com/wp-content/uploads/2024/10/image-222x300.webp" alt="Solo Leveling"/></div><div class="bigor"><div class="tt">
Solo Leveling</div><div class="adds"><div class="epxs">فصل 179</div><div class="numscore">9.9</div></div></div>
</a></div></div><div class="bs"><div class="bsx">
<a href="https://hijala.com/because-im-super-lucky/" title="Because I&#8217;m Super Lucky"><div class="limit">
<img src="https://hijala.com/wp-content/uploads/x.webp" alt="x"/></div></a></div></div>
<div class="bs"><div class="bsx"><a href="https://hijala.com/test/" title="test"></a></div></div>
<div class="bs"><div class="bsx"><a href="https://hijala.com/genres/action/" title="أكشن"></a></div></div>
</div>`;

const DETAIL = `
<div class="thumb" itemprop="image"><img data-lazyloaded="1" src="${PLACEHOLDER}" data-src="https://hijala.com/wp-content/uploads/2024/10/image.webp" alt="Solo Leveling"/></div>
<div class="rating bixbox"><div class="rating-prc"><div class="num" itemprop="ratingValue" content="9.9">9.9</div></div></div>
<div class="tsinfo bixbox"><div class="imptdt">
الحالة <i>Ongoing</i></div><div class="imptdt">
النوع <a href="https://hijala.com//?order=title&type=Manhwa">Manhwa</a></div><div class="imptdt">
المؤلف <i>تشوجونج 추공 (Chugong)</i></div><div class="imptdt">
نشر بتاريخ <i><time datetime="2024-10-15">أكتوبر 15, 2024</time></i></div></div>
<div id="titlemove"><h1 class="entry-title" itemprop="name">Solo Leveling</h1>
<span class="alternative">Only I Level Up | 나 혼자만 레벨업</span></div>
<div class="wd-full"><span class="mgen"><a href="https://hijala.com/genres/%d8%a3%d9%83%d8%b4%d9%86/" rel="tag">أكشن</a><a href="https://hijala.com/genres/x/" rel="tag">فانتازيا</a></span></div>
<div class="wd-full"><h2>قصة العمل Solo Leveling</h2><div class="entry-content entry-content-single" itemprop="description"><p>قبل 10 سنوات ، بعد ظهور &#8220;الباب&#8221;</p></div></div>
<span id="series-history-tpl" style='display:none'><li data-id="{{id}}" data-num="{{number}}"><a href="#/chapter-{{number}}"><span class="chapternum">فصل {{number}}</span></a></li></span>
<div class="eplister" id="chapterlist"><ul ><li data-num="179"><div class="chbox"><div class="eph-num">
<a href="https://hijala.com/solo-leveling-179/">
<span class="chapternum">فصل 179</span>
<span class="chapterdate">أكتوبر 22, 2024</span>
</a></div></div></li><li data-num="24.5"><div class="chbox"><div class="eph-num">
<a href="https://hijala.com/solo-leveling-24-5/">
<span class="chapternum">فصل 24.5</span>
<span class="chapterdate">أكتوبر 20, 2024</span>
</a></div></div></li><li data-num="04"><div class="chbox"><div class="eph-num">
<a href="https://hijala.com/solo-leveling-4/">
<span class="chapternum">فصل 04</span>
</a></div></div></li></ul></div>
<footer><ul class="menu"><li><a href="https://hijala.com/privacy-policy/">سياسة الخصوصية</a></li></ul></footer>`;

const CHAPTER = `
<h1 class="entry-title" itemprop="name">Shadow Slave 14</h1>
<a href="https://hijala.com/"><img data-src="http://hijala.com/wp-content/uploads/2024/10/hijala.png"></a>
<div id="readerarea"><noscript><p><img decoding="async" src="http://hijala.com/wp-content/uploads/manga/a5d871df/1.webp"><img decoding="async" src="https://hijala.com/wp-content/uploads/manga/a5d871df/2.webp"><img decoding="async" src="https://hijala.com/wp-content/uploads/manga/a5d871df/2.webp"></p></noscript></div>
<div id="readerarea-loading"><img data-src="https://hijala.com/wp-content/themes/mangareader/assets/img/readerarea.svg" /></div>
<div class="kln"><a href="https://hijala.org/"><img data-src="https://hijala.com/wp-content/uploads/ad.webp"></a></div>`;

function main() {
  // IDs
  assert.equal(hijalaSlug("https://hijala.com/solo-leveling/"), "solo-leveling");
  assert.equal(hijalaSlug("solo-leveling"), "solo-leveling");
  assert.equal(hijalaSlug("https://hijala.com/genres/action/"), null);
  assert.equal(hijalaSlug("https://evil.example/solo-leveling/"), null);

  // Home: latest-update rail + trending rail; chapter labels normalized.
  const home = parseHijalaHome(HOME);
  assert.ok(home);
  const latest = home.sections.find((s) => s.id === "latest");
  const popular = home.sections.find((s) => s.id === "popular");
  assert.deepEqual(latest?.items.map((c) => [c.id, c.title, c.latest, c.type]), [
    ["kowloon-soroka", "Kowloon: Soroka", "الفصل 35", "مانجا"],
    ["shadow-slave", "Shadow Slave", "الفصل 14", "مانهوا"],
  ]);
  assert.equal(latest?.items[0].cover, "https://hijala.com/wp-content/uploads/2026/08/w7p3Xr.webp");
  assert.deepEqual(popular?.items.map((c) => [c.id, c.latest, c.rating]), [["baek-xx", "الفصل 154", "9"]]);
  assert.equal(popular?.items[0].cover, "https://hijala.com/wp-content/uploads/2024/07/BAEK-XX-207x300.webp");
  assert.equal(home.featured[0]?.id, "baek-xx");

  // Search cards: entities decoded, site pages + the "test" post skipped.
  const cards = parseHijalaCards(SEARCH);
  assert.deepEqual(cards.map((c) => [c.source, c.id, c.title]), [
    ["hijala", "solo-leveling", "Solo Leveling"],
    ["hijala", "because-im-super-lucky", "Because I’m Super Lucky"],
  ]);
  assert.equal(cards[0].latest, "الفصل 179");
  assert.equal(cards[0].rating, "9.9");

  // Detail: metadata + chapter list (the {{template}} row is ignored).
  const detail = parseHijalaDetail(DETAIL, "solo-leveling");
  assert.ok(detail);
  assert.equal(detail.title, "Solo Leveling");
  assert.equal(detail.cover, "https://hijala.com/wp-content/uploads/2024/10/image.webp");
  assert.equal(detail.status, "مستمر");
  assert.equal(detail.type, "مانهوا");
  assert.equal(detail.rating, "9.9");
  assert.equal(detail.author, "تشوجونج 추공 (Chugong)");
  assert.deepEqual(detail.genres, ["أكشن", "فانتازيا"]);
  assert.equal(detail.synopsis, "قبل 10 سنوات ، بعد ظهور “الباب”");
  assert.deepEqual(detail.chapters.map((c) => [c.id, c.number, c.date]), [
    ["solo-leveling-179", "179", "أكتوبر 22, 2024"],
    ["solo-leveling-24-5", "24.5", "أكتوبر 20, 2024"],
    ["solo-leveling-4", "04", null],
  ]);
  assert.equal(detail.latest, "الفصل 179");

  // Reader: only #readerarea pages, deduped; logo/loader/ad images excluded.
  const reader = parseHijalaChapter(CHAPTER, "https://hijala.com/shadow-slave-14/");
  assert.deepEqual(reader?.pages, [
    "https://hijala.com/wp-content/uploads/manga/a5d871df/1.webp",
    "https://hijala.com/wp-content/uploads/manga/a5d871df/2.webp",
  ]);
  assert.equal(reader?.title, "Shadow Slave 14");
  // ts_reader JSON fallback when the noscript copy is absent.
  assert.deepEqual(
    parseHijalaChapter('<script>ts_reader.run({"sources":[{"images":["https:\\/\\/hijala.com\\/a.webp","https:\\/\\/hijala.com\\/b.webp"]}]})</script>', "https://hijala.com/x-1/")?.pages,
    ["https://hijala.com/a.webp", "https://hijala.com/b.webp"],
  );

  // Filtered listing URLs.
  assert.equal(hijalaListingUrl(undefined, 1), "https://hijala.com/manga/?order=popular");
  assert.equal(
    hijalaListingUrl({ status: "مكتمل", type: "مانهوا", sort: "latest" }, 3, { title: "solo", genreId: 7 }),
    "https://hijala.com/manga/?title=solo&genre%5B%5D=7&status=completed&type=manhwa&order=update&page=3",
  );

  // Junk never throws.
  assert.equal(parseHijalaHome(""), null);
  assert.deepEqual(parseHijalaCards(""), []);
  assert.equal(parseHijalaDetail("", "x"), null);
  assert.deepEqual(parseHijalaChapters(""), []);
  assert.equal(parseHijalaChapter("", "https://hijala.com/x/"), null);
  assert.equal(parseHijalaChapter('<script>"images":[broken</script>', "https://hijala.com/x/"), null);

  console.log("hijala source tests passed");
}

main();

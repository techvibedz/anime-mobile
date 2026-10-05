import assert from "node:assert/strict";
import {
  mangawySource,
  parseMangawyBrowse,
  parseMangawyChapter,
  parseMangawyDetail,
  parseMangawyHome,
  parseMangawySearch,
} from "./mangawy";

const homeHtml = `
<section class="mb-10"><div class="max-w-[1400px] mx-auto px-4"><div class="group relative overflow-hidden rounded-3xl bg-card" data-v-4db8b08e>
  <div class="fh-cover--active fh-cover absolute inset-0"><div class="relative aspect-2/3"><img src="https://img.mangawy.org/covers/9c92d276bde5e4c36116d584b8247d41-cover-md.webp" alt="Return of the Mount Hua Sect"></div></div>
  <div class="fh-cover--next fh-cover absolute inset-0"><div><img src="https://img.mangawy.org/covers/1b07681c1c5273976f04f07b6d0afa78-cover-md.webp" alt="Swordmaster’S Youngest Son"></div></div>
  <h2 class="max-w-2xl text-xl font-bold" data-v-4db8b08e>Return of the Mount Hua Sect</h2>
  <span class="bg-emerald-400/10 text-emerald-400 rounded-lg px-2.5 py-1 text-xs font-bold" data-v-4db8b08e>مستمر</span>
  <a href="/series/return-of-the-mount-hua-sect-k2c31iwr" class="inline-flex min-h-11 items-center rounded-xl bg-primary"> ابدأ القراءة </a>
</div></div></section>
<section class="mb-12">
  <div class="text-base font-bold tracking-tight text-foreground">الأكثر قراءة اليوم</div>
  <div class="flex overflow-x-auto pb-3 gap-3">
    <a href="/series/dungeon-odyssey-ml9di46d" class="group relative flex flex-col gap-2 w-28 sm:w-32 md:w-36 shrink-0 snap-start">
      <div><div class="relative aspect-2/3 rounded-xl overflow-hidden"><img src="https://img.mangawy.org/covers/b9565a79ba8e76207eac4c5c101bcedc-thumb-sm.webp" alt="Dungeon Odyssey"><div class="absolute bottom-1.5 left-1.5 z-20 inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold leading-none bg-emerald-500/10 text-emerald-400">مانهوا</div></div></div>
      <div class="space-y-0.5"><h3 class="font-semibold text-sm">Dungeon Odyssey</h3><div class="flex items-center gap-1.5 text-xs"><span>170 فصل</span><span> · 15d</span></div></div>
    </a>
    <a href="/series/eleceed-orldm5hn" class="group relative flex flex-col gap-2 w-28 sm:w-32 md:w-36 shrink-0 snap-start">
      <div><div class="relative aspect-2/3 rounded-xl overflow-hidden"><img src="https://img.mangawy.org/covers/641e90c185f51a00b4e2bf8c80fd02c3-thumb-sm.webp" alt="Eleceed"></div></div>
      <div class="space-y-0.5"><h3 class="font-semibold text-sm">Eleceed</h3><div class="flex items-center gap-1.5 text-xs"><span>419 فصل</span></div></div>
    </a>
  </div>
</section>
<section class="mb-12">
  <h2>آخر الفصول</h2>
  <div id="reka-tabs-v-0-1-0-content-hot" role="tabpanel">
    <div class="group flex h-full gap-3 rounded-2xl border border-border/10 p-2.5 bg-card/40">
      <div class="flex-1 min-w-0 flex flex-col h-full">
        <div class="mb-2"><a href="/series/the-return-of-the-crazy-demon-d4wiawry" class="block"><h3 class="font-bold text-sm">The Return of the Crazy Demon</h3></a>
        <div class="flex items-center gap-3 mt-1.5 text-xs"><span class="bg-emerald-500/10 text-emerald-400 inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold leading-none">مانهوا</span><span>213 فصل</span><span>· 6d</span></div></div>
        <div class="flex-1 flex flex-col gap-1 overflow-hidden">
          <div class="flex items-center justify-between text-xs py-2"><a href="/series/the-return-of-the-crazy-demon-d4wiawry/chapter/213" class="flex flex-1 items-center gap-3 min-w-0"><span class="font-medium truncate"> الفصل 213</span><span class="shrink-0 text-[11px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded-sm leading-none"> جديد </span></a><span class="text-xs text-muted-foreground shrink-0">6d</span></div>
          <div class="flex items-center justify-between text-xs py-2"><a href="/series/the-return-of-the-crazy-demon-d4wiawry/chapter/214" class="flex flex-1 items-center gap-3 min-w-0"><span class="font-medium truncate"> الفصل 214</span></a><span class="text-xs text-muted-foreground shrink-0">11d</span></div>
        </div>
      </div>
      <a href="/series/the-return-of-the-crazy-demon-d4wiawry" class="block shrink-0 w-[104px]"><div><img src="https://img.mangawy.org/covers/7fb0adf451d87f8ecd124bfebbb38590-thumb-sm.webp" alt="The Return of the Crazy Demon"></div></a>
    </div>
    <div class="group flex h-full gap-3 rounded-2xl border border-border/10 p-2.5 bg-card/40">
      <div class="flex-1 min-w-0 flex flex-col h-full">
        <div class="mb-2"><a href="/series/the-grand-duchess-has-constitution-gkrzdp5h" class="block"><h3 class="font-bold text-sm">The Grand Duchess has Constitution</h3></a></div>
        <div class="flex-1 flex flex-col gap-1 overflow-hidden">
          <div class="flex items-center justify-between text-xs py-2"><a href="/series/the-grand-duchess-has-constitution-gkrzdp5h/chapter/60" class="flex flex-1 items-center gap-3 min-w-0"><span class="font-medium truncate"> الفصل 60</span></a><span class="text-xs text-muted-foreground shrink-0">6d</span></div>
        </div>
      </div>
      <a href="/series/the-grand-duchess-has-constitution-gkrzdp5h" class="block shrink-0 w-[104px]"><div><img src="https://img.mangawy.org/covers/e0e0d0c0-thumb-sm.webp" alt="The Grand Duchess has Constitution"></div></a>
    </div>
  </div>
  <div id="reka-tabs-v-0-1-0-content-new" role="tabpanel"></div>
</section>
<div class="lg:hidden mb-10">
  <h3 class="flex items-center gap-2 px-1 text-sm font-bold"><svg class="lucide-circle-check-big"></svg><span>مكتمل حديثاً</span></h3>
  <div class="space-y-1.5">
    <a href="/series/tokyo-revengers-7y0aqqs1" class="group flex min-h-16 items-center gap-3 rounded-xl p-2">
      <div class="relative aspect-2/3 rounded-xl overflow-hidden w-20"><img src="https://img.mangawy.org/covers/3e08687afa5fb194e93b314f4024995c-thumb-sm.webp" alt="Tokyo Revengers"></div>
      <div class="min-w-0 flex-1"><p class="text-sm font-bold leading-snug text-foreground truncate">Tokyo Revengers</p><p class="text-xs text-muted-foreground mt-1">261 فصل</p></div>
    </a>
    <a href="/series/bleach-t9qzdutd" class="group flex min-h-16 items-center gap-3 rounded-xl p-2">
      <div class="relative aspect-2/3 rounded-xl overflow-hidden w-20"><img src="https://img.mangawy.org/covers/558a60faab2a0fc4e8a8f1a11f5f8e46-thumb-sm.webp" alt="BLEACH"></div>
      <div class="min-w-0 flex-1"><p class="text-sm font-bold leading-snug text-foreground truncate">BLEACH</p><p class="text-xs text-muted-foreground mt-1">393 فصل</p></div>
    </a>
  </div>
</div>`;

const searchJson = JSON.stringify([
  {
    slug: "eternally-regressing-knight-mmnotiwf",
    title: "Eternally Regressing Knight",
    title_ar: null,
    cover_url: "https://img.mangawy.org/covers/e4a4b772c6da028b2d195d0e4fbfcc62.webp",
    status: "ongoing",
    type: "manhwa",
    chapter_count: 113,
  },
  {
    slug: "bleach-t9qzdutd",
    title: "BLEACH",
    title_ar: "بليتش",
    cover_url: null,
    status: "completed",
    type: "manga",
    chapter_count: 393,
  },
]);

const detailHtml = `
<h1 class="text-2xl font-bold tracking-tight text-foreground">Return of the Mount Hua Sect</h1>
<img src="https://img.mangawy.org/covers/9c92d276bde5e4c36116d584b8247d41-cover-md.webp" alt="غلاف Return of the Mount Hua Sect">
<p class="mt-1.5 text-xs text-muted-foreground">El retorno del Monte Hua</p>
<span class="bg-emerald-500/10 text-emerald-400 inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border">مانهوا</span>
<span class="border-border/30 bg-muted/40 text-foreground/80 inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border">2021</span>
<div class="flex items-center gap-1.5"><div class="bg-emerald-400 w-2 h-2 rounded-full"></div><span class="font-medium text-foreground">مستمر</span></div>
<div class="pill-group flex flex-wrap items-center gap-1.5"><a href="/browse?genre=أكشن" class="rounded-full">أكشن</a><a href="/browse?genre=فنون-قتالية" class="rounded-full">فنون قتالية</a><a href="/browse?genre=أكشن" class="rounded-full">أكشن</a></div>
<div id="series-description" class="">تشينغ مينغ، التلميذ الثالث عشر لطائفة هوسان، ثم يولد من جديد بعد 100 عام.</div>
<ul class="space-y-2.5">
  <li><a href="/series/return-of-the-mount-hua-sect-k2c31iwr/chapter/181-2nhid049" class="group block h-full"><div class="flex items-center justify-between"><div class="flex items-center gap-4"><span class="shrink-0 text-base font-bold"> ف. 181</span><div class="flex min-w-0 flex-1 flex-col"><div class="truncate text-sm font-medium">Chapter 181.0</div></div></div><span class="ms-3 text-[11px]"><svg class="lucide-calendar w-3 h-3"><path d="M8 2v4"></path></svg> ٢٣ سبتمبر</span></div></a></li>
  <li><a href="/series/return-of-the-mount-hua-sect-k2c31iwr/chapter/180-ul6nwb5j" class="group block h-full"><div class="flex items-center justify-between"><div class="flex items-center gap-4"><span class="shrink-0 text-base font-bold"> ف. 180</span><div class="flex min-w-0 flex-1 flex-col"><div class="truncate text-sm font-medium">Chapter 180.0</div></div></div><span class="ms-3 text-[11px]"><svg class="lucide-calendar w-3 h-3"><path d="M8 2v4"></path></svg> ١٦ سبتمبر</span></div></a></li>
  <li><a href="/series/return-of-the-mount-hua-sect-k2c31iwr/chapter/179-xp5zqn4d" class="group block h-full"><div class="flex items-center justify-between"><div class="flex items-center gap-4"><span class="shrink-0 text-base font-bold"> ف. 179</span><div class="flex min-w-0 flex-1 flex-col"><div class="truncate text-sm font-medium">Chapter 179.0</div></div></div><span class="ms-3 text-[11px]"><svg class="lucide-calendar w-3 h-3"><path d="M8 2v4"></path></svg> ٩ سبتمبر</span></div></a></li>
</ul>`;

const chapterHtml = `
<meta property="og:image" content="https://img.mangawy.org/published/return-of-the-mount-hua-sect/179/r-hash/001_0.webp">
<link rel="preload" as="image" href="https://img.mangawy.org/published/return-of-the-mount-hua-sect/179/r-hash/001_0.webp">
<img src="https://img.mangawy.org/covers/9c92d276bde5e4c36116d584b8247d41-cover-md.webp" alt="غلاف">
<div data-page-index="2"><img src="https://img.mangawy.org/published/return-of-the-mount-hua-sect/179/r-hash/003_0.webp" alt="صفحة 3"></div>
<div data-page-index="1"><img src="https://img.mangawy.org/published/return-of-the-mount-hua-sect/179/r-hash/002_0.webp" alt="صفحة 2"></div>
<script>window.__NUXT__={"tiles":[{"index":0,"imageUrl":"https://img.mangawy.org/published/return-of-the-mount-hua-sect/179/r-hash/001_1.webp"},{"index":1,"imageUrl":"https://img.mangawy.org/published/return-of-the-mount-hua-sect/179/r-hash/001_0.webp"}],"n":1}</script>`;

const browseJson = JSON.stringify({
  items: [
    {
      slug: "return-of-the-mount-hua-sect-k2c31iwr",
      title: "Return of the Mount Hua Sect",
      cover_url: "https://img.mangawy.org/covers/9c92d276bde5e4c36116d584b8247d41-cover-md.webp",
      status: "ongoing",
      type: "manhwa",
      chapter_count: 187,
    },
  ],
  pagination: { page: 1, page_size: 36, total: 197, total_pages: 6 },
  sort: "popular",
});

async function main() {
  assert.equal(mangawySource.id, "mangawy");
  assert.equal(mangawySource.label, "مانجاوي");

  const home = parseMangawyHome(homeHtml);
  assert.ok(home);
  assert.equal(home.featured[0]?.id, "return-of-the-mount-hua-sect-k2c31iwr");
  assert.equal(home.featured[0]?.title, "Return of the Mount Hua Sect");
  assert.equal(home.featured[0]?.cover, "https://img.mangawy.org/covers/9c92d276bde5e4c36116d584b8247d41-cover-md.webp");
  assert.equal(home.featured[0]?.status, "مستمر");
  assert.deepEqual(
    home.sections.map((section) => [section.id, section.kind]),
    [["popular", "ranked"], ["latest", "latest"], ["completed", "grid"]],
  );
  const popular = home.sections[0].items;
  assert.deepEqual(popular.map((card) => card.id), ["dungeon-odyssey-ml9di46d", "eleceed-orldm5hn"]);
  assert.equal(popular[0].type, "مانهوا");
  assert.equal(popular[0].cover, "https://img.mangawy.org/covers/b9565a79ba8e76207eac4c5c101bcedc-thumb-sm.webp");
  const latest = home.sections[1].items;
  assert.deepEqual(latest.map((card) => card.id), [
    "the-return-of-the-crazy-demon-d4wiawry",
    "the-grand-duchess-has-constitution-gkrzdp5h",
  ]);
  assert.equal(latest[0].latest, "الفصل 213");
  assert.equal(latest[1].latest, "الفصل 60");
  assert.equal(latest[0].type, "مانهوا");
  assert.deepEqual(home.sections[2].items.map((card) => card.id), [
    "tokyo-revengers-7y0aqqs1",
    "bleach-t9qzdutd",
  ]);
  assert.equal(home.sections[2].items[1].title, "BLEACH");
  assert.equal(parseMangawyHome("<html><body>empty</body></html>"), null);

  const results = parseMangawySearch(searchJson);
  assert.equal(results.length, 2);
  assert.equal(results[0].id, "eternally-regressing-knight-mmnotiwf");
  assert.equal(results[0].type, "مانهوا");
  assert.equal(results[0].status, "مستمر");
  assert.equal(results[1].title, "BLEACH");
  assert.equal(results[1].type, "مانجا");
  assert.equal(results[1].status, "مكتمل");
  assert.equal(results[1].cover, null);
  assert.deepEqual(parseMangawySearch("<html>not json</html>"), []);
  assert.deepEqual(parseMangawySearch("{}"), []);

  const detail = parseMangawyDetail(detailHtml, "return-of-the-mount-hua-sect-k2c31iwr");
  assert.ok(detail);
  assert.equal(detail.title, "Return of the Mount Hua Sect");
  assert.equal(detail.type, "مانهوا");
  assert.equal(detail.status, "مستمر");
  assert.equal(detail.year, "2021");
  assert.deepEqual(detail.genres, ["أكشن", "فنون قتالية"]);
  assert.equal(detail.synopsis, "تشينغ مينغ، التلميذ الثالث عشر لطائفة هوسان، ثم يولد من جديد بعد 100 عام.");
  assert.equal(detail.cover, "https://img.mangawy.org/covers/9c92d276bde5e4c36116d584b8247d41-cover-md.webp");
  assert.deepEqual(detail.chapters.map((chapter) => chapter.id), [
    "181-2nhid049",
    "180-ul6nwb5j",
    "179-xp5zqn4d",
  ]);
  assert.deepEqual(detail.chapters.map((chapter) => chapter.number), ["181", "180", "179"]);
  assert.equal(detail.chapters[0].title, "Chapter 181.0");
  assert.equal(detail.chapters[0].date, "٢٣ سبتمبر");
  assert.equal(detail.latest, "الفصل 181");
  assert.equal(parseMangawyDetail("<html><body>no h1</body></html>", "x"), null);

  const reader = parseMangawyChapter(chapterHtml, "https://mangawy.org/series/return-of-the-mount-hua-sect-k2c31iwr/chapter/179");
  assert.ok(reader);
  assert.deepEqual(reader.pages, [
    "https://img.mangawy.org/published/return-of-the-mount-hua-sect/179/r-hash/001_0.webp",
    "https://img.mangawy.org/published/return-of-the-mount-hua-sect/179/r-hash/002_0.webp",
    "https://img.mangawy.org/published/return-of-the-mount-hua-sect/179/r-hash/003_0.webp",
  ]);
  assert.equal(parseMangawyChapter("<html><body>no pages</body></html>", "https://mangawy.org/"), null);

  const signed = "https://img.mangawy.org/published/work/ch/001_0.webp?token=a&expires=42";
  const extra = "https://img.mangawy.org/published/work/ch/credits.webp";
  assert.deepEqual(parseMangawyChapter(`<img src="${signed}"><img src="${extra}">`, "https://mangawy.org/")?.pages, [signed, extra]);
  assert.deepEqual(parseMangawyChapter(JSON.stringify([signed, extra]).replaceAll("/", "\\/"), "https://mangawy.org/")?.pages, [signed, extra]);

  // Browse listing comes from /api/browse now: the type the HTML page never
  // exposed (the reason the type filter used to be a no-op) is on every item.
  const browse = parseMangawyBrowse(browseJson);
  assert.equal(browse.length, 1);
  assert.equal(browse[0].id, "return-of-the-mount-hua-sect-k2c31iwr");
  assert.equal(browse[0].title, "Return of the Mount Hua Sect");
  assert.equal(browse[0].cover, "https://img.mangawy.org/covers/9c92d276bde5e4c36116d584b8247d41-cover-md.webp");
  assert.equal(browse[0].type, "مانهوا");
  assert.equal(browse[0].status, "مستمر");
  assert.equal(browse[0].latest, "الفصل 187");
  assert.deepEqual(parseMangawyBrowse("<html><body>empty</body></html>"), []);
  assert.deepEqual(parseMangawyBrowse("{}"), []);

  console.log("mangawy tests passed");
}

void main();

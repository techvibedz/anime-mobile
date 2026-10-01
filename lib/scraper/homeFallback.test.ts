import assert from "node:assert/strict";
import { parseAnime4upHomeHtml, parseWitFeatured, parseWitHomeEpisodes, parseWitHomeRails } from "./direct";
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

  // Witanime's home renders "الأكثر مشاهدة" (most-watched, popularity-ranked)
  // before "أحدث الحلقات" (latest). The episode feed must read only the latest
  // rail, otherwise episodes from earlier weeks lead the "new episodes" list.
  const witHomeEpisodeRails = `
    <section class="mb-14">
      <h2>الأكثر مشاهدة</h2>
      <a href="https://witanime.site/watch/old-hit/5"><img src="https://img.example/old.jpg" alt=""><h3>Old Hit</h3></a>
    </section>
    <section class="mb-14">
      <h2>أحدث الحلقات</h2>
      <a href="https://witanime.site/watch/fresh-show/2"><img src="https://img.example/fresh.jpg" alt=""><h3>Fresh Show</h3></a>
      <a href="https://witanime.site/watch/other-show/9"><img src="https://img.example/other.jpg" alt=""><h3>Other Show</h3></a>
    </section>`;
  const witEps = parseWitHomeEpisodes(witHomeEpisodeRails);
  assert.deepEqual(witEps.map((e) => e.animeTitle), ["Fresh Show", "Other Show"]);
  assert.equal(witEps[0]?.title, "الحلقة 2");
  assert.equal(witEps[0]?.animeHref, "https://witanime.site/anime/fresh-show");
  assert.equal(
    parseWitHomeEpisodes('<a href="https://witanime.site/watch/legacy/1"><h3>Legacy</h3></a>').length,
    1,
  );

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

  // Witanime's current hero carousel ([data-hero-slide]): banner, anime link,
  // meta row (genres) and synopsis must come out of the static HTML — the old
  // .lucodeia-slider-slide-item markup no longer exists on the live site, and
  // the direct path used to fall back to plain rail cards.
  const witHeroHtml = `
    <div data-hero-slide class="absolute inset-y-0 left-1/2 w-full">
      <img src="https://images.witanime.site/banners/aaa.jpg" alt="">
      <h2 title="BLEACH: Sennen Kessen-hen - Kashin-tan -">
        <a href="https://witanime.site/anime/bleach-sennen-kessen-hen-kashin-tan">BLEACH: Sennen Kessen-hen - Kashin-tan -</a>
      </h2>
      <div class="mb-4 flex flex-wrap items-center gap-x-4 text-sm text-neutral-300">
        <span class="flex flex-wrap items-center gap-2"><span class="inline-flex">TV</span><span dir="ltr">8.8</span></span>
        <span class="flex flex-wrap items-center gap-2">
          <span>2026</span>
          <span class="text-xs" aria-hidden="true">•</span>
          <span><span class="font-medium">10</span> حلقات</span>
          <span class="text-xs" aria-hidden="true">•</span>
          <span><span class="font-medium">مستمر</span></span>
          <span class="text-xs" aria-hidden="true">•</span>
          <span>أكشن, مغامرة, شونين</span>
        </span>
      </div>
      <p class="mb-6 line-clamp-3 max-w-2xl text-sm">القسم الرابع من الموسم الثاني.</p>
      <a href="https://witanime.site/anime/bleach-sennen-kessen-hen-kashin-tan" class="group/cta"><span class="relative">شاهد الآن</span></a>
    </div>
    <div data-hero-slide class="absolute inset-y-0 left-1/2 w-full">
      <img src="https://images.witanime.site/banners/bbb.jpg" alt="">
      <h2 title="BLACK TORCH"><a href="https://witanime.site/anime/black-torch">BLACK TORCH</a></h2>
      <p class="mb-6 line-clamp-3">قصة أخرى.</p>
    </div>`;
  const hero = parseWitFeatured(witHeroHtml);
  assert.equal(hero.length, 2);
  assert.equal(hero[0]?.title, "BLEACH: Sennen Kessen-hen - Kashin-tan -");
  assert.equal(hero[0]?.href, "https://witanime.site/anime/bleach-sennen-kessen-hen-kashin-tan");
  assert.equal(hero[0]?.image, "https://images.witanime.site/banners/aaa.jpg");
  assert.equal(hero[0]?.description, "القسم الرابع من الموسم الثاني.");
  assert.deepEqual(hero[0]?.genres, ["أكشن", "مغامرة", "شونين"]);
  assert.equal(hero[1]?.title, "BLACK TORCH");
  assert.equal(hero[1]?.description, "قصة أخرى.");
  assert.deepEqual(hero[1]?.genres, []);

  // Home rails below "latest episodes": witanime's three server-rendered
  // sections (latest movies / most-watched animes / most-watched movies) are
  // sliced by heading so a rail can never bleed into a neighbouring one — the
  // old full-page card scan is exactly what mixed upcoming titles and movies
  // into the removed "trending" rail. Markup mirrors the live home page.
  const railsHtml = `
    <section class="mb-14">
      <div class="mb-6"><h2 class="text-xl font-bold text-white sm:text-2xl">أحدث الأفلام</h2><span>جديد</span></div>
      <div class="sm:px-5"><div class="grid grid-cols-2">
        <a href="https://witanime.site/movie/mononoke-movie-hebigami" class="group relative isolate flex w-full cursor-pointer flex-col overflow-hidden rounded-xl bg-neutral-800" data-preview="https://witanime.site/preview/movie/mononoke-movie-hebigami">
          <span class="pointer-events-none absolute inset-0"><img src="https://images.witanime.site/posters/f9d60e3bd5990d8286290fc21f2773b6.jpg" alt="" aria-hidden="true" class="h-full w-full scale-150 object-cover opacity-[.12] blur-md"></span>
          <div class="relative px-3 pb-3 pt-4 text-center"><h3 dir="ltr" class="truncate text-sm font-medium text-white">Mononoke Movie: Hebigami</h3></div>
          <div class="relative mt-auto"><div class="relative overflow-hidden rounded-t-xl bg-neutral-900"><img src="https://images.witanime.site/posters/f9d60e3bd5990d8286290fc21f2773b6.jpg" alt="Mononoke Movie: Hebigami" class="aspect-[2/3] w-full object-cover"></div></div>
        </a>
        <a href="https://witanime.site/movie/kusunoki-no-bannin" class="group relative isolate flex w-full cursor-pointer flex-col overflow-hidden rounded-xl bg-neutral-800">
          <div class="relative px-3 pb-3 pt-4 text-center"><h3 dir="ltr" class="truncate text-sm font-medium text-white">Kusunoki no Bannin</h3></div>
          <div class="relative mt-auto"><img src="https://images.witanime.site/posters/93b959150eff48c8c59486380467708c.jpg" alt="Kusunoki no Bannin" class="aspect-[2/3] w-full object-cover"></div>
        </a>
      </div></div>
    </section>
    <section class="mb-14">
      <div class="sm:px-5"><div x-data="{ overflowing: false }">
        <div class="mb-6"><h2 class="text-xl font-bold text-white sm:text-2xl">أكثر الأنميات مشاهدة</h2><span>كل الأوقات</span></div>
        <a class="@container group block w-full cursor-pointer" data-preview="https://witanime.site/preview/anime/one-piece" href="https://witanime.site/anime/one-piece">
          <div class="relative mb-3 aspect-[2/3] overflow-hidden rounded-xl bg-neutral-900">
            <img src="https://images.witanime.site/posters/96b62f648db8ff6cd11e38f430d725f7.jpg" alt="One Piece" class="h-full w-full object-cover opacity-80">
            <div class="absolute inset-x-0 top-0 z-10"><div class="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-sm font-bold text-black">1</div></div>
          </div>
          <h3 dir="ltr" class="truncate text-base font-semibold leading-snug text-white">One Piece</h3>
        </a>
      </div></div>
    </section>
    <section class="mb-14">
      <div class="sm:px-5"><div x-data="{ overflowing: false }">
        <div class="mb-6"><h2 class="text-xl font-bold text-white sm:text-2xl">أكثر الأفلام مشاهدة</h2><span>كل الأوقات</span></div>
        <a href="https://witanime.site/movie/bleach-sennen-kessen-hen-kashin-tan-movie" class="group relative isolate flex w-full cursor-pointer flex-col overflow-hidden rounded-xl bg-neutral-800" data-preview="https://witanime.site/preview/movie/bleach-sennen-kessen-hen-kashin-tan-movie">
          <span class="pointer-events-none absolute inset-0"><img src="https://images.witanime.site/posters/2351b991203a615344f5876bd37aec69.jpg" alt="" class="h-full w-full scale-150 blur-md"></span>
          <div class="relative px-3 pb-3 pt-4 text-center"><h3 dir="ltr" class="truncate text-sm font-medium text-white">BLEACH: Sennen Kessen-hen - Kashin-tan Movie</h3></div>
          <div class="relative mt-auto"><div class="relative overflow-hidden rounded-t-xl bg-neutral-900"><img src="https://images.witanime.site/posters/2351b991203a615344f5876bd37aec69.jpg" alt="BLEACH: Sennen Kessen-hen - Kashin-tan Movie" class="aspect-[2/3] w-full object-cover"><div class="absolute start-2 top-2 z-10"><div class="flex h-8 w-8 rounded-lg bg-white text-sm font-bold text-black">1</div></div></div></div>
        </a>
      </div></div>
    </section>`;
  const rails = parseWitHomeRails(railsHtml);
  assert.deepEqual(rails.latestMovies.map((c) => c.title), ["Mononoke Movie: Hebigami", "Kusunoki no Bannin"]);
  assert.equal(rails.latestMovies[0]?.href, "https://witanime.site/movie/mononoke-movie-hebigami");
  assert.equal(rails.latestMovies[0]?.image, "https://images.witanime.site/posters/f9d60e3bd5990d8286290fc21f2773b6.jpg");
  assert.equal(rails.latestMovies[0]?.isNew, false);
  assert.deepEqual(rails.topAnimes.map((c) => c.title), ["One Piece"]);
  assert.equal(rails.topAnimes[0]?.href, "https://witanime.site/anime/one-piece");
  // The most-watched rails must not pick up the rank badge div as a type.
  assert.equal(rails.topAnimes[0]?.type, null);
  assert.deepEqual(rails.topMovies.map((c) => c.title), ["BLEACH: Sennen Kessen-hen - Kashin-tan Movie"]);
  assert.equal(rails.topMovies[0]?.href, "https://witanime.site/movie/bleach-sennen-kessen-hen-kashin-tan-movie");

  // A page without those headings (legacy cached HTML / layout drift) must
  // degrade to empty rails — never harvest cards from unrelated sections.
  const noRails = parseWitHomeRails(`
    <section><h2>أنميات قادمة</h2>
      <a href="https://witanime.site/anime/upcoming-thing"><img src="https://img.example/u.jpg" alt=""><h3>Upcoming Thing</h3></a>
    </section>`);
  assert.deepEqual(noRails, { latestMovies: [], topAnimes: [], topMovies: [] });

  console.log("home fallback tests passed");
}

void main();

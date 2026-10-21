import assert from 'node:assert/strict';
import { parseWitAnimeDetail } from './direct';

// Shape of a current witanime.site anime page (trimmed): banner img with empty
// alt, poster img with alt, h1 title, synopsis, genre pills, episode links
// including a duplicate, a relative link and a recap ".5" episode.
const page = `<html><head><title>x</title></head><body>
<a href="/watch/other-show/3">header link outside main</a>
<main class="flex-1"><section class="relative pt-16">
 <img src="https://img/banner.jpg" alt="" class="h-full">
 <img src="https://img/poster.jpg" alt="Mushoku Tensei Ⅲ" width="192">
 <h1 class="mb-1 text-3xl"><span dir="ltr">Mushoku Tensei Ⅲ: Isekai Ittara Honki Dasu</span></h1>
 <div class="mb-4 flex flex-wrap items-center gap-2"><span>TV</span><span>مكتمل</span></div>
 <p class="mb-6 text-sm leading-relaxed text-neutral-300">الموسم الثالث &amp; الأخير.</p>
 <div class="mb-6 flex flex-wrap gap-2 max-md:order-2"><span class="pill"> مغامرة </span><span class="pill"> دراما </span></div>
 <a href="https://witanime.site/watch/mushoku-tensei-iii/2">2</a>
 <a href="https://witanime.site/watch/mushoku-tensei-iii/1">1</a>
 <a href="https://witanime.site/watch/mushoku-tensei-iii/1">dup</a>
 <a href="/watch/mushoku-tensei-iii/3">3</a>
 <a href="https://witanime.site/watch/mushoku-tensei-iii/3.5">recap</a>
</section></main></body></html>`;

const d = parseWitAnimeDetail(page, 'https://witanime.site');
assert.ok(d, 'current layout parses');
assert.equal(d.title, 'Mushoku Tensei Ⅲ: Isekai Ittara Honki Dasu');
assert.equal(d.poster, 'https://img/poster.jpg', 'banner with empty alt is skipped');
assert.equal(d.synopsis, 'الموسم الثالث & الأخير.');
assert.deepEqual(d.genres, ['مغامرة', 'دراما'], 'status pills are not genres');
assert.deepEqual(d.episodes.map((e) => e.number), [1, 2, 3], 'sorted, deduped, recap .5 skipped, outside-main ignored');
assert.equal(d.episodes[2].href, 'https://witanime.site/watch/mushoku-tensei-iii/3', 'relative link made absolute');
assert.equal(d.episodes[0].title, 'الحلقة 1');

const movie = parseWitAnimeDetail(page.replace(/<a href="[^"]*mushoku[^"]*">[^<]*<\/a>/g, '').replace('</section>', '<a href="/watch/movie/kimi-no-na-wa">m</a></section>'), 'https://witanime.site');
assert.deepEqual(movie?.episodes.map((e) => [e.number, e.title]), [[1, 'فيلم']], 'movie link is a single episode');

assert.equal(parseWitAnimeDetail('<html><body><h1>x</h1></body></html>', 'https://witanime.site'), null, 'no <main>: WebView fallback');
assert.equal(parseWitAnimeDetail(page.replace(/<a href="[^"]*\/watch\/[^"]*">[^<]*<\/a>/g, ''), 'https://witanime.site'), null, 'no episodes: WebView fallback, never a partial detail');

console.log('PASS witanime static detail parser');

// Tests for the direct embed resolvers' shared machinery: the Dean-Edwards
// packed-JS unpacker and the media-URL picker. Live CDN hosts bot-block plain
// GETs from CI machines, so instead of fetching we PACK a known stream URL
// with a real packer and assert extractFromPacked round-trips it — this is
// the exact code path that resolves streamwish (and any packed mirror).
// Run:  npx tsx lib/scraper/embedExtract.test.ts

import assert from "node:assert";
import { buildVideaXmlRequest, extractFromPacked, extractMp4uploadUrl, extractVideaXmlUrl, extractVideasUrl, isMp4uploadMediaUrl, looksLikeCfChallenge, parseA3rbGenres, parseA3rbSynopsis, parseAnime4upEpisodeTitles, parseAnime4upRecentHtml, parseAnime4upStreamUrl, parseAnime4upSubtitles, parseUp4Episodes, parseUp4Servers, parseWitAnimeSections, pickHighestHlsVariant, pickMediaUrl } from "./direct";

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e: any) { failed++; console.error(`FAIL  ${name}\n      ${e?.message || e}`); }
}

/* ── minimal Dean-Edwards packer (mirror of the production unpacker) ── */
const B62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
function baseN(n: number, r: number): string {
  let s = "";
  while (n > 0) { s = B62[n % r] + s; n = Math.floor(n / r); }
  return s || "0";
}
function pack(script: string): string {
  const words = script.match(/\w+/g) || [];
  const dict: string[] = [];
  for (const w of words) if (!dict.includes(w)) dict.push(w);
  const a = dict.length <= 10 ? 10 : dict.length <= 36 ? 36 : 62;
  let p = script;
  for (let i = 0; i < dict.length; i++) {
    p = p.replace(new RegExp("\\b" + dict[i] + "\\b", "g"), baseN(i, a));
  }
  const escaped = p.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `eval(function(p,a,c,k,e,d){return p}('${escaped}',${a},${dict.length},'${dict.join("|")}'.split('|')))`;
}

const M3U8 = "https://cdn.example.com/master.m3u8?token=abc123";
const MP4 = "https://vid.example.net/field/film480.mp4?sign=zz99";
const MP4UPLOAD = "https://s14.mp4upload.com:282/d/video.mp4?token=abc";

test("packed JW setup round-trips to the m3u8", () => {
  const html = `<html><script>${pack(`jwplayer("v").setup({file:"${M3U8}",width:"100%"});`)}</script></html>`;
  assert.equal(extractFromPacked(html), M3U8);
});

test("packed sources-array round-trips to the mp4", () => {
  const html = `<script>${pack(`player.setup({sources:[{file:"${MP4}",type:"mp4"}]});`)}</script>`;
  assert.equal(extractFromPacked(html), MP4);
});

test("non-packed HTML yields null (no false positives)", () => {
  assert.equal(extractFromPacked("<html><body>nothing here</body></html>"), null);
});

test("pickMediaUrl prefers file: m3u8 in plain HTML", () => {
  assert.equal(pickMediaUrl(`<script>var x={file:"${M3U8}"};</script>`), M3U8);
});

test("pickMediaUrl rejects decoys and embed-page self references", () => {
  assert.equal(pickMediaUrl(`file:"https://cdn.example.com/sample-video.mp4"`), null);
  assert.equal(pickMediaUrl(`file:"https://streamwish.to/embed-abc12.m3u8"`), null);
});

test("pickMediaUrl skips trackers and takes the real stream", () => {
  const html = `"https://google-analytics.com/collect.mp4" then {file:"${M3U8}"}`;
  assert.equal(pickMediaUrl(html), M3U8);
});

test("mp4upload inline player.src object yields the direct mp4", () => {
  const html = `<script>player.src({type:"video/mp4",src:"${MP4UPLOAD}"});</script>`;
  assert.equal(extractMp4uploadUrl(html), MP4UPLOAD);
});

test("mp4upload parser decodes JSON-escaped URLs and HTML query entities", () => {
  const html = '<script>player.src({src:"https:\\/\\/s14.mp4upload.com\\/d\\/abc\\/video.mp4?token=1&amp;expires=2"});</script>';
  assert.equal(
    extractMp4uploadUrl(html),
    "https://s14.mp4upload.com/d/abc/video.mp4?token=1&expires=2",
  );
});

test("mp4upload packed player.src yields the direct mp4", () => {
  const html = `<script>${pack(`player.src({type:"video/mp4",src:"${MP4UPLOAD}"});`)}</script>`;
  assert.equal(extractMp4uploadUrl(html), MP4UPLOAD);
});

test("mp4upload parser rejects sample files", () => {
  assert.equal(extractMp4uploadUrl('player.src({src:"https://x.mp4upload.com/sample-video.mp4"})'), null);
});

test("mp4upload parser skips an unrelated mp4 before the real stream", () => {
  const html = `src:"https://cdn.example.com/trailer.mp4";src:"${MP4UPLOAD}"`;
  assert.equal(extractMp4uploadUrl(html), MP4UPLOAD);
});

test("mp4upload parser ignores player CSS on the mp4upload host", () => {
  const html = `
    <link href="https://www.mp4upload.com/player/videojs/skins/nuevo/videojs.min.css">
    <script>player.src({src:"${MP4UPLOAD}"});</script>`;
  assert.equal(extractMp4uploadUrl(html), MP4UPLOAD);
});

test("mp4upload parser returns null for CSS-only HTML", () => {
  assert.equal(
    extractMp4uploadUrl('<link href="https://www.mp4upload.com/player/videojs/video.min.css">'),
    null,
  );
});

test("mp4upload direct playback accepts only its progressive MP4", () => {
  assert.equal(isMp4uploadMediaUrl(MP4UPLOAD), true);
  assert.equal(isMp4uploadMediaUrl("https://s14.mp4upload.com/live/playlist.m3u8"), false);
  assert.equal(isMp4uploadMediaUrl("https://example.com/video.mp4"), false);
});

test("videas static HTML yields its direct playlist", () => {
  const url = "https://cdn.videas.fr/v-medias/example/playlist.m3u8";
  assert.equal(extractVideasUrl(`<script>player.setup({file:"${url}"})</script>`), url);
});

test("Anime4up archive keeps the latest episode per anime and paginates", () => {
  const card = (episode: number, anime: string) => `<div class="anime-card-container">
    <div class="anime-card-poster"><a class="overlay" href="https://w1.anime4up.rest/episode/${anime}-الحلقة-${episode}/"></a><img data-src="https://img/${anime}.jpg"></div>
    <div class="anime-card-status"><a href="https://w1.anime4up.rest/episode/${anime}-الحلقة-${episode}/">الحلقة ${episode}</a></div>
    <div class="anime-card-title"><h3><a href="https://w1.anime4up.rest/anime/${anime}/">${anime}</a></h3></div>
  </div>`;
  const result = parseAnime4upRecentHtml(card(12, "alpha") + card(11, "alpha") + card(8, "beta") + '<a href="/episode/page/2/">2</a>', 1);
  assert.deepEqual(result.episodes.map((episode) => [episode.animeTitle, episode.title]), [["alpha", "الحلقة 12"], ["beta", "الحلقة 8"]]);
  assert.equal(result.hasNext, true);
});

test("Anime4up episode title ignores the download-section heading", () => {
  const titles = parseAnime4upEpisodeTitles(`
    <title>انمي Digimon Beatbreak الحلقة 48 مترجمة | Anime4up</title>
    <h3 class="area-title">روابط تحميل الحلقة</h3>`);
  assert.deepEqual(titles, { episodeTitle: "الحلقة 48", animeTitle: "Digimon Beatbreak" });
});

test("Videa manifest request and signed source parse without a WebView", () => {
  const token = "HkECgvfnGgVQzV_O3LO_zImFfXzwhN2llCAjOAmTo9a7QztESocRozxNSYW98t3R";
  const request = buildVideaXmlRequest("https://videa.hu/player?v=abc123", `<script>var _xt = "${token}";</script>`, "12345678");
  assert.ok(request?.url.includes("/player/xml?v=abc123&_s=12345678&_t="));
  const xml = '<hash_values><hash_value_720>sig</hash_value_720></hash_values><video_sources><video_source name="720" exp="99">https://videa.hu/static/video.mp4</video_source></video_sources>';
  assert.equal(extractVideaXmlUrl(xml), "https://videa.hu/static/video.mp4?md5=sig&expires=99");
});

test("current Anime4up HTML exposes private CDN and redirected DoodStream servers", () => {
  const servers = parseUp4Servers(`<ul id="episode-servers">
    <li data-watch="https://4t.44y4h0r.shop/Anime4up-S1/mal/61169/1/sub/"><a>anime4up1 <span>[FHD]</span></a></li>
    <li data-watch="https://playmogo.com/e/t0rdyelb0krl"><a>DoodStream <span>[FHD]</span></a></li>
    <li data-watch="https://mp4upload.com/embed-5a5h09ih6s0t.html"><a>Mp4upload <span>[FHD]</span></a></li>
  </ul>`);
  assert.deepEqual(servers.map((server) => server.provider), ["anime4upcdn", "doodstream", "mp4upload"]);
});

test("Anime4up CDN page exposes its token-signed HLS stream URL", () => {
  const stream = "https://cdn1.k1c6x8p.shop/?token=mUgefvO_DctcULgGHagj3FzypF0sPdzJpmpOEDCSF";
  const html = `<script>const edgeHosts = ["cdn1.k1c6x8p.shop","cdn2.k1c6x8p.shop"];\nlet streamUrl = "${stream}";</script>`;
  assert.equal(parseAnime4upStreamUrl(html), stream);
});

test("Cloudflare's JSD snippet on a served page is NOT a challenge", () => {
  const jsd = `<script>window.__cfRLUnblockHandlers=true;var a=document.createElement('script');a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';document.getElementsByTagName('head')[0].appendChild(a);</script>`;
  assert.equal(looksLikeCfChallenge(jsd), false);
  // The live anime4up player page carries exactly this snippet plus its stream.
  assert.equal(
    looksLikeCfChallenge(`<script>let streamUrl = "https://cdn1.k1c6x8p.shop/?token=x";</script>${jsd}`),
    false,
  );
});

test("Anime4up player page exposes its sidecar subtitle tracks", () => {
  // Live shape: a nested fallbacks array (a non-greedy regex stops early).
  const html = `<script>
    const tracks = [{"file":"https://w1.anime4up.rest/vnx-subtitle/abc.vtt","fallbacks":["https://w1.anime4up.rest/wp-content/uploads/x.vtt?vnx_uploaded_subtitle=1"],"label":"العربية","srclang":"ar","kind":"captions","default":true}];
    let streamUrl = "https://cdn1.k1c6x8p.shop/?token=x";
  </script>`;
  const subs = parseAnime4upSubtitles(html);
  assert.equal(subs.length, 1);
  assert.equal(subs[0].url, "https://w1.anime4up.rest/vnx-subtitle/abc.vtt");
  assert.equal(subs[0].lang, "ar");
});

test("Anime4up subtitle parser is empty without a tracks array", () => {
  assert.deepEqual(parseAnime4upSubtitles("<html><body>no tracks</body></html>"), []);
});

test("a real Cloudflare interstitial is still detected", () => {
  assert.equal(looksLikeCfChallenge(`<title>Just a moment...</title><div id="cf-please-wait"></div>`), true);
  assert.equal(looksLikeCfChallenge(`<span data-translate="checking_browser">Checking your browser</span>`), true);
});

test("Witanime anime page splits ذات صلة and قد يعجبك أيضًا rails", () => {
  const card = (href: string, title: string, type: string) => `<a href="${href}" class="group block w-full cursor-pointer">
    <img src="https://images.witanime.site/posters/${title.replace(/\s+/g, "-")}.jpg" alt="${title}">
    <div class="absolute start-2 top-2 rounded-md bg-white px-2 py-1 text-xs font-bold text-black">${type}</div>
    <h3 dir="ltr" class="truncate font-semibold text-white">${title}</h3>
  </a>`;
  const html = `<section>
      <h2 class="text-2xl font-bold text-white">ذات صلة</h2>
      ${card("https://witanime.site/anime/kimetsu-no-yaiba-yuukaku-hen", "Kimetsu no Yaiba Yuukaku-hen", "TV")}
    </section>
    <section>
      <h2 class="text-2xl font-bold text-white">قد يعجبك أيضًا</h2>
      ${card("https://witanime.site/anime/strike-the-blood-valkyria-no-oukoku-hen", "Strike the Blood", "OVA")}
    </section>`;
  const sections = parseWitAnimeSections(html);
  assert.deepEqual(sections.related.map((c) => c.title), ["Kimetsu no Yaiba Yuukaku-hen"]);
  assert.deepEqual(sections.mayLike.map((c) => c.title), ["Strike the Blood"]);
  assert.equal(sections.mayLike[0].type, "OVA");
});

test("Witanime current-layout top-3 badge is captured, score badge ignored", () => {
  const html = `<section>
      <h2 class="text-2xl font-bold text-white">ذات صلة</h2>
      <a href="https://witanime.site/movie/bleach-movie-1" class="group block w-full cursor-pointer">
        <img src="https://images.witanime.site/posters/bleach-movie-1.jpg" alt="Bleach Movie 1">
        <div class="absolute start-3 top-3 h-6 rounded-md bg-white px-2 text-xs font-bold leading-6 text-black">فيلم</div>
        <div class="absolute end-3 top-3 flex h-6 items-center rounded-md bg-black/70 px-2 text-xs font-bold text-white backdrop-blur-sm"><span>7.6</span></div>
        <h3 dir="ltr" class="mb-1 line-clamp-1 text-lg font-medium text-white">Bleach Movie 1: Memories of Nobody</h3>
      </a>
    </section>`;
  const sections = parseWitAnimeSections(html);
  assert.equal(sections.related[0].type, "فيلم");
});

test("legacy مقترحة heading still parses as the related rail", () => {
  const html = `<section>
      <h2>مقترحة</h2>
      <a href="https://witanime.site/anime/bleach"><img src="https://images.witanime.site/posters/bleach.jpg" alt="Bleach"><h3>Bleach</h3></a>
    </section>`;
  assert.deepEqual(parseWitAnimeSections(html).related.map((c) => c.title), ["Bleach"]);
});

test("Witanime sections are empty when the page has no rails", () => {
  const sections = parseWitAnimeSections("<section><h2>الحلقات</h2></section>");
  assert.deepEqual(sections, { related: [], mayLike: [] });
});

test("Anime4up CDN parser ignores pages without a streamUrl", () => {
  assert.equal(parseAnime4upStreamUrl("<html><body>nothing</body></html>"), null);
  assert.equal(parseAnime4upStreamUrl('let streamUrl = "/relative/only.m3u8";'), null);
});

test("HLS master playlist resolves to the highest-bandwidth variant", () => {
  const master = [
    "#EXTM3U",
    "#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360",
    "https://cdn1.k1c6x8p.shop/?token=low",
    "#EXT-X-STREAM-INF:BANDWIDTH=5300000,RESOLUTION=1920x1080",
    "https://cdn1.k1c6x8p.shop/?token=best",
    "#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720",
    "/?token=mid",
  ].join("\n");
  assert.equal(pickHighestHlsVariant(master, "https://cdn1.k1c6x8p.shop/master.m3u8"), "https://cdn1.k1c6x8p.shop/?token=best");
});

test("HLS media playlist (no variants) yields null so the master is kept", () => {
  assert.equal(pickHighestHlsVariant("#EXTM3U\n#EXTINF:6,\nseg1.ts", "https://cdn/x.m3u8"), null);
});

test("current Anime4up anime page ignores stylesheet selectors and finds episode cards", () => {
  const episodes = parseUp4Episodes(`
    <style>.episodes-list-content { display: flex } .pagination { display: table }</style>
    <div class="anime-grid">
      <div class="ep_num">
        <a href="https://w1.anime4up.rest/episode/one-piece-%D8%A7%D9%84%D8%AD%D9%84%D9%82%D8%A9-1129/">الحلقة 1129</a>
      </div>
      <a href="https://w1.anime4up.rest/episode/one-piece-%D8%A7%D9%84%D8%AD%D9%84%D9%82%D8%A9-1129/" class="overlay"></a>
    </div>`);
  assert.deepEqual(episodes.map((episode) => episode.number), [1129]);
});

test("anime3rb story scope stops at the story div, not a char cap (Kashin-tan regression)", () => {
  // Captured live: the page had NEITHER toggle marker ("x-show=summary" /
  // "summary = ! summary"), so the old +8000-char fallback swept the short
  // re-telling and other description-like blocks in after the real story — the
  // detail page showed "the description repeated in a different format".
  // Card meta paragraphs (rating / episode count / season+year) must also stop
  // the parse: the grid runs in groups and the paragraphs after a card meta
  // are its per-season re-descriptions.
  const page = `<div x-data="{summary: false}">
  <div class="py-4 flex flex-col gap-2" x-show="! summary">
    <p class="sm:text-[1.04rem] leading-loose text-justify">الجزء الختامي من «بليتش: حرب الألف عام».</p>
    <p class="sm:text-[1.04rem] leading-loose text-justify">يُحطّم ملك الكوينسي حرسه الملكي، ثم يبدأ البطل معركته الأخيرة لحماية العوالم الثلاثة، وتبدأ التشوهات بالظهور في كل مكان.</p>
    <p class="sm:text-[1.04rem] leading-loose text-justify">كوميدي ربيع 2016 التقييم 6.92 11 حلقات.</p>
    <p class="sm:text-[1.04rem] leading-loose text-justify">وصف موسمي مكرر يجب ألا يظهر إطلاقاً في صفحة التفاصيل.</p>
  </div>
  <div class="flex flex-col gap-3 rounded-lg"><label>أسماء أخرى :</label><h2>Bleach: Thousand-Year Blood War</h2></div>
  <div class="py-4" x-show="summary"><p class="sm:text-[1.04rem] leading-loose text-justify">يتابع الموسم الأخير معركة إيتشيغو الأخيرة ضد يهواتش لحماية العوالم من الانهيار الكامل.</p></div>
  <p class="sm:text-[1.04rem] leading-loose text-justify">الموسم الثاني من بليتش تدور أحداثه بعد مرور عام على الأحداث السابقة.</p>
</div>`;
  const story = parseA3rbSynopsis(page);
  assert.equal(story.includes("الجزء الختامي"), true);
  assert.equal(story.includes("يُحطّم ملك الكوينسي"), true);
  assert.equal(story.includes("وصف موسمي مكرر"), false);
  assert.equal(story.includes("يتابع الموسم الأخير"), false);
  assert.equal(story.includes("الموسم الثاني"), false);
  assert.equal(parseA3rbSynopsis("<html><body>no story block</body></html>"), "");
});

test("anime3rb genres stay scoped to the anime, not the related-works cards (Re:Zero regression)", () => {
  // Captured live: the anime page's own genres use /genre/ links with short
  // Arabic labels; the "اعمال ذات صلة" carousel cards reuse the SAME markup
  // inside an <a> that wraps the season/rating/episode badges AND the card's
  // synopsis paragraph. A page-wide genre match captured the whole card
  // ("كوميدي ربيع 2016 التقييم 6.92 11 حلقات <full synopsis>") and the detail
  // screen rendered those captures as genre chips — the user saw "the
  // description repeated in another format" right below the real genres.
  const card = `<li class="glide__slide">
      <a href="/titles/rezero-kara-hajimeru-break-time" class="details">
        <div class="genres"><span href="/genre/comedy">كوميدي</span></div>
        <p class="flex flex-wrap gap-1"><span class="badge">ربيع 2016</span><span class="badge">التقييم 6.92</span><span class="badge">11 حلقات</span></p>
        <p class="synopsis">ينتقل سوبارو ناتسوكي فجأة إلى عالم آخر مليء بالتوتر واليأس، لكنه يجد فيه فرصة للراحة.</p>
      </a>
    </li>`;
  const page = `
    <div class="genres"><a href="/genre/thriller">تشويق</a><a href="/genre/isekai">إيسيكاي</a><a href="/genre/time-travel">سفر عبر الزمن</a></div>
    <div class="py-4" x-show="! summary"><p class="leading-loose text-justify">القصة الحقيقية.</p></div>
    <h3>اعمال ذات صلة (11)</h3>
    <ul class="glide__slides titles-slider">${card}${card}</ul>`;
  assert.deepEqual(parseA3rbGenres(page), ["تشويق", "إيسيكاي", "سفر عبر الزمن"]);

  // No carousel marker at all (markup drift): the length/format guards must
  // still reject a card-shaped capture.
  const drifted = `<a href="/genre/action">أكشن</a><span href="/genre/comedy">كوميدي</span><p class="badge">ربيع 2016 التقييم 6.92 11 حلقات</p><p class="synopsis">قصة مكررة.</p></a>`;
  assert.deepEqual(parseA3rbGenres(drifted), ["أكشن"]);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

// Tests for the direct embed resolvers' shared machinery: the Dean-Edwards
// packed-JS unpacker and the media-URL picker. Live CDN hosts bot-block plain
// GETs from CI machines, so instead of fetching we PACK a known stream URL
// with a real packer and assert extractFromPacked round-trips it — this is
// the exact code path that resolves streamwish (and any packed mirror).
// Run:  npx tsx lib/scraper/embedExtract.test.ts

import assert from "node:assert";
import { extractFromPacked, extractMp4uploadUrl, extractVideasUrl, isMp4uploadMediaUrl, parseUp4Episodes, parseUp4Servers, pickMediaUrl } from "./direct";

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

test("current Anime4up HTML exposes private CDN and redirected DoodStream servers", () => {
  const servers = parseUp4Servers(`<ul id="episode-servers">
    <li data-watch="https://4o.z4m2r9t.shop/Anime4up-S1/mal/35120/8/sub/"><a>anime4up1 <span>[FHD]</span></a></li>
    <li data-watch="https://playmogo.com/e/t0rdyelb0krl"><a>DoodStream <span>[FHD]</span></a></li>
    <li data-watch="https://mp4upload.com/embed-5a5h09ih6s0t.html"><a>Mp4upload <span>[FHD]</span></a></li>
  </ul>`);
  assert.deepEqual(servers.map((server) => server.provider), ["anime4upcdn", "doodstream", "mp4upload"]);
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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

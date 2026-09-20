import assert from "node:assert";
import {
  isWitAnimeHtml,
  parseWitCards,
  parseWitEpisodeMeta,
  parseWitEpisodeSitemap,
  parseWitGateTarget,
  parseWitManifestEntries,
  parseWitPlayerConfig,
  parseWitServers,
  rewriteWitUrl,
  selectWitRecentEntries,
} from "./direct";

assert.equal(isWitAnimeHtml('<div class="anime-card-container"></div>'), true);
assert.equal(isWitAnimeHtml('<title>WitAnime — شاهد الأنمي أون لاين</title>'), true);
assert.equal(isWitAnimeHtml('<html><title>Watch Anime Online Free</title></html>'), false);
assert.equal(
  rewriteWitUrl("https://witanime.you/anime/test/?x=1#episodes", "https://witanime.life"),
  "https://witanime.life/anime/test/?x=1#episodes",
);
assert.equal(
  rewriteWitUrl("https://anime3rb.com/anime/test", "https://witanime.life"),
  "https://anime3rb.com/anime/test",
);

const embed = "https://www.mp4upload.com/embed-abcdefgh1234.html";
const registry = Buffer.from(JSON.stringify([
  Buffer.from(embed).toString("base64").split("").reverse().join(""),
])).toString("base64");
const config = Buffer.from(JSON.stringify([{
  d: [0],
  k: Buffer.from("0").toString("base64"),
}])).toString("base64");
const page = (registryName: string, configName: string) => `
  <script>var ${registryName} = "${registry}"; var ${configName} = "${config}";</script>
  <span class="ser">Mp4upload</span>`;

assert.equal(parseWitServers(page("_zX", "_zK"))[0]?.iframeUrl, embed);
assert.equal(parseWitServers(page("_zH", "_zW"))[0]?.iframeUrl, embed);

const currentCard = parseWitCards(`
  <a class="group block" href="https://witanime.site/anime/black-torch">
    <div class="absolute start-2 top-2">TV</div>
    <img src="https://images.witanime.site/posters/black-torch.jpg" alt="BLACK TORCH">
    <h3>BLACK TORCH</h3>
  </a>`)[0];
assert.deepEqual(currentCard, {
  title: "BLACK TORCH",
  href: "https://witanime.site/anime/black-torch",
  image: "https://images.witanime.site/posters/black-torch.jpg",
  type: "TV",
  status: null,
  synopsis: null,
});

const sitemap = [
  ["a/1", 1], ["b/1", 2], ["a/2", 7], ["c/1", 3], ["d/1", 4], ["e/1", 5], ["f/1", 6],
].map(([path, minute]) => `<url><loc>https://witanime.site/watch/${path}</loc><lastmod>2026-09-20T00:0${minute}:00Z</lastmod></url>`).join("");
assert.equal(parseWitEpisodeSitemap(`<urlset>${sitemap}</urlset>`).length, 7);
assert.deepEqual(
  selectWitRecentEntries([sitemap], new Set(["a"]), 2, 2).entries.map((entry) => [entry.slug, entry.number]),
  [["f", 1], ["e", 1]],
);
assert.deepEqual(
  selectWitRecentEntries([sitemap], new Set(["a"]), 3, 2).entries.map((entry) => [entry.slug, entry.number]),
  [["d", 1], ["c", 1]],
);

const playerHtml = `<meta name="csrf-token" content="csrf123"><div x-data="watchPlayer({ sourcesUrl: '\\/watch\\/show\\/12\\/sources' })">`;
assert.deepEqual(parseWitPlayerConfig(playerHtml, "https://witanime.site/watch/show/12"), {
  sourcesUrl: "https://witanime.site/watch/show/12/sources",
  csrf: "csrf123",
});
assert.deepEqual(parseWitManifestEntries({ players: {
  FHD: [{ label: "mega", token: "a".repeat(64) }, { label: "hgcloud", token: "b".repeat(64) }],
  HD: [{ label: "hgcloud", token: "c".repeat(64) }, { label: "mp4upload", token: "d".repeat(64) }],
} }).map((entry) => [entry.label, entry.quality]), [
  ["hgcloud", "FHD"], ["mp4upload", "HD"], ["mega", "FHD"],
]);
assert.equal(parseWitGateTarget(
  null,
  `<meta http-equiv="refresh" content="0;url='https://videa.hu/player?v=abc'">`,
  "https://witanime.site/watch/stream-gate/token",
  "https://witanime.site/watch/stream-gate/token",
), "https://videa.hu/player?v=abc");

const meta = parseWitEpisodeMeta(`<script type="application/ld+json">${JSON.stringify({
  "@type": "TVEpisode",
  image: "https://images.witanime.site/posters/show.jpg",
  partOfSeries: { name: "Show Name", url: "https://witanime.site/anime/show" },
})}</script>`, {
  href: "https://witanime.site/watch/show/12",
  slug: "show",
  number: 12,
  updatedAt: 0,
});
assert.deepEqual(meta, {
  title: "الحلقة 12",
  href: "https://witanime.site/watch/show/12",
  image: "https://images.witanime.site/posters/show.jpg",
  animeTitle: "Show Name",
  animeHref: "https://witanime.site/anime/show",
  isNew: true,
});

console.log("wit failover tests passed");

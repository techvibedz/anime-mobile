import assert from "node:assert";
import { isWitAnimeHtml, parseWitCards, parseWitServers, rewriteWitUrl } from "./direct";

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

console.log("wit failover tests passed");

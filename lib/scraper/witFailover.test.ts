import assert from "node:assert";
import { isWitAnimeHtml, parseWitServers, rewriteWitUrl } from "./direct";

assert.equal(isWitAnimeHtml('<div class="anime-card-container"></div>'), true);
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

console.log("wit failover tests passed");

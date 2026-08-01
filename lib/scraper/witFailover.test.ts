import assert from "node:assert";
import { isWitAnimeHtml, rewriteWitUrl } from "./direct";

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

console.log("wit failover tests passed");

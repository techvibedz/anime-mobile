import assert from "node:assert/strict";
import {
  candidateForAttempt,
  classifySourceFailure,
  isRetryableSourceStatus,
  isTopLevelWebViewError,
  isValidSourceHtml,
  nextCandidateIndex,
  preferredHostFromValue,
  sourceCandidates,
} from "./sourceDomains";

assert.deepEqual(sourceCandidates("https://witanime.you/anime/x?y=1", null), [
  "https://witanime.you/anime/x?y=1",
  "https://witanime.life/anime/x?y=1",
]);
assert.deepEqual(sourceCandidates("https://w1.anime4up.rest/home8/", "anime4up.rest"), [
  "https://anime4up.rest/home8/",
  "https://w1.anime4up.rest/home8/",
]);
assert.deepEqual(sourceCandidates("https://anime3rb.com/titles/x", "www.anime3rb.com"), [
  "https://www.anime3rb.com/titles/x",
  "https://anime3rb.com/titles/x",
]);
assert.deepEqual(sourceCandidates("https://example.com/x", null), ["https://example.com/x"]);
assert.deepEqual(
  [1, 2, 3].map((attempt) => candidateForAttempt(["primary", "mirror"], attempt)),
  ["primary", "mirror", "primary"],
);
assert.equal(
  preferredHostFromValue(JSON.stringify({ host: "witanime.life", expiresAt: 2_000 }), "witanime", 1_000),
  "witanime.life",
);
assert.equal(
  preferredHostFromValue(JSON.stringify({ host: "witanime.life", expiresAt: 2_000 }), "witanime", 2_001),
  null,
);

assert.equal(isValidSourceHtml("witanime", '<div class="anime-card-container">'), true);
assert.equal(isValidSourceHtml("anime4up", '<title>Anime4up - انمي فور اب</title>'), true);
assert.equal(isValidSourceHtml("anime3rb", '<title>Anime3rb انمي عرب</title>'), true);
assert.equal(isValidSourceHtml("anime4up", "Attention Required | Cloudflare"), false);
assert.equal(
  isValidSourceHtml(
    "anime4up",
    '<ul id="episode-servers"><li data-watch="https://video.example/e/1"></li></ul><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>',
  ),
  true,
);
assert.equal(isValidSourceHtml("witanime", "ISP blocked this website"), false);

assert.equal(classifySourceFailure("net::ERR_CERT_AUTHORITY_INVALID"), "ssl");
assert.equal(classifySourceFailure("net::ERR_NAME_NOT_RESOLVED"), "dns");
assert.equal(classifySourceFailure("scrape timeout after 25000ms"), "timeout");
assert.equal(classifySourceFailure("HTTP 503", 503), "cloudflare");
assert.equal(classifySourceFailure("HTTP 500", 500), "http");
assert.equal(classifySourceFailure("connection reset"), "network");

assert.equal(isRetryableSourceStatus(404), false);
assert.equal(isRetryableSourceStatus(410), false);
assert.equal(isRetryableSourceStatus(403), true);
assert.equal(isRetryableSourceStatus(429), true);
assert.equal(isRetryableSourceStatus(500), true);
assert.equal(nextCandidateIndex(0, 2), 1);
assert.equal(nextCandidateIndex(1, 2), null);

assert.equal(
  isTopLevelWebViewError("https://witanime.you/missing.js", "https://witanime.you/anime/example/"),
  false,
);
assert.equal(
  isTopLevelWebViewError("https://witanime.you/anime/example/#player", "https://witanime.you/anime/example/"),
  true,
);
assert.equal(isTopLevelWebViewError(undefined, "https://witanime.you/anime/example/"), true);

console.log("sourceDomains tests passed");

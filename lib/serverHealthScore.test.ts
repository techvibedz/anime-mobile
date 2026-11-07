import assert from "node:assert";
import {
  fastestKey,
  healthBucket,
  healthKey,
  healthScore,
  healthTier,
  successRate,
  type HealthStat,
} from "./serverHealthScore";

const stat = (ok: number, fail: number, avgMs: number | null, recentOk = 0, recentFail = 0): HealthStat => ({
  ok, fail, avgMs, recentOk, recentFail,
});

// Keys are case-insensitive and default sensibly.
assert.equal(healthKey("Anime3rb", "VID3RB"), "anime3rb|vid3rb");
assert.equal(healthKey(undefined, undefined), "unknown|generic");

// Unknown / tiny samples stay at the prior and never get badges.
assert.equal(successRate(null), 0.7);
assert.equal(healthTier(stat(1, 0, 900)), "unknown");
assert.equal(healthTier(stat(2, 2, 900)), "unknown");

// A proven fast host is "fast"; a mostly failing one is "unstable".
assert.equal(healthTier(stat(40, 2, 2100)), "fast");
assert.equal(healthTier(stat(40, 2, 9000)), "good");
assert.equal(healthTier(stat(3, 20, 3000)), "unstable");

// Bayesian prior: 1/1 must not outrank 95/100.
assert.ok(successRate(stat(95, 5, null)) > successRate(stat(1, 0, null)));

// Recent failures dominate a good day: a host that died this afternoon drops.
const diedToday = stat(80, 10, 2500, 0, 12);
assert.ok(successRate(diedToday) < 0.45, `died host rate ${successRate(diedToday)}`);
assert.equal(healthTier(diedToday), "unstable");

// Speed breaks ties among equally reliable hosts, but never beats reliability.
assert.ok(healthScore(stat(50, 1, 1800)) > healthScore(stat(50, 1, 14000)));
assert.ok(healthScore(stat(50, 1, 14000)) > healthScore(stat(10, 30, 1500)));

// Buckets are coarse: near-equal hosts share a bucket.
assert.equal(healthBucket(stat(50, 2, 2000)), healthBucket(stat(48, 3, 2600)));
assert.ok(healthBucket(stat(50, 2, 2000)) > healthBucket(stat(5, 30, 2000)));

// Fastest badge goes to the quickest "fast" tier host only.
const stats = new Map<string, HealthStat>([
  ["anime3rb|vid3rb", stat(60, 3, 3200)],
  ["witanime|mp4upload", stat(40, 1, 1900)],
  ["anime4up|voe", stat(4, 1, 900)], // too few samples
  ["witanime|uqload", stat(5, 40, 800)], // fast but unstable
]);
assert.equal(fastestKey([...stats.keys()], stats), "witanime|mp4upload");
assert.equal(fastestKey(["anime4up|voe"], stats), null);

console.log("server health score tests passed");

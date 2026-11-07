import assert from "node:assert";
import {
  addLocalReaction,
  bucketOf,
  buildReactionMap,
  floatsForBucket,
  formatClock,
  glyphOf,
  heatSegments,
  hottestBucket,
  topEmojis,
  totalReactions,
} from "./reactionsCore";

assert.equal(bucketOf(0), 0);
assert.equal(bucketOf(14.9), 2);
assert.equal(bucketOf(-3), 0);
assert.equal(bucketOf(99999), 2500);
assert.equal(glyphOf("fire"), "🔥");
assert.equal(glyphOf("nope"), "✨");

const map = buildReactionMap([
  { bucket: 10, emoji: "fire", n: 5 },
  { bucket: 10, emoji: "shock", n: 2, mine: true },
  { bucket: 100, emoji: "cry", n: 1 },
  { bucket: 50, emoji: "bogus", n: 9 }, // unknown emoji ignored
]);
assert.equal(totalReactions(map), 8);
assert.equal(map.get(10)?.total, 7);
assert.deepEqual(map.get(10)?.mine, ["shock"]);
assert.equal(map.has(50), false);
assert.deepEqual(topEmojis(map.get(10)!), ["fire", "shock"]);

// Optimistic add is immutable and idempotent for my own emoji.
const added = addLocalReaction(map, 10, "laugh");
assert.notEqual(added, map);
assert.equal(added.get(10)?.total, 8);
assert.equal(map.get(10)?.total, 7, "original untouched");
assert.equal(addLocalReaction(added, 10, "laugh"), added, "repeat is a no-op");
assert.equal(addLocalReaction(map, 3, "love").get(3)?.total, 1);

// Hottest moment.
assert.deepEqual(hottestBucket(map), { bucket: 10, total: 7, top: "fire" });
assert.equal(hottestBucket(map, 20), null);

// Floats exclude my own single reaction.
assert.deepEqual(floatsForBucket(map.get(10)), ["fire", "fire", "shock"]);
assert.deepEqual(floatsForBucket({ total: 1, counts: { love: 1 }, mine: ["love"] }), []);
assert.deepEqual(floatsForBucket(undefined), []);

// Heat: busiest segment = 1, quiet ones 0, out-of-range buckets dropped.
const heat = heatSegments(map, 600, 60); // 10 s per segment
assert.equal(heat.length, 60);
assert.equal(heat[5], 1); // bucket 10 → t=52.5 s → segment 5
assert.ok(heat[50] > 0 && heat[50] < 1); // bucket 100 → t=502.5 s
assert.equal(heat[0], 0);
assert.deepEqual(heatSegments(map, 0, 4), [0, 0, 0, 0]);

assert.equal(formatClock(872), "14:32");
assert.equal(formatClock(3725), "1:02:05");
assert.equal(formatClock(-5), "0:00");

console.log("reactions core tests passed");

import assert from "node:assert";
import { aiQueryKey, buildAniListBatch, looksLikeNaturalQuery, parseAniListBatch } from "./aiSearchCore";

// Titles are not natural queries; descriptions are.
assert.equal(looksLikeNaturalQuery("naruto"), false);
assert.equal(looksLikeNaturalQuery("One Piece"), false);
assert.equal(looksLikeNaturalQuery("هجوم العمالقة"), false);
assert.equal(looksLikeNaturalQuery("أبغى انمي زي هجوم العمالقة بس قصير"), true);
assert.equal(looksLikeNaturalQuery("بغيت انمي فيه انتقام"), true);
assert.equal(looksLikeNaturalQuery("anime like death note"), true);
assert.equal(looksLikeNaturalQuery("a b c d e f"), true, "5+ words");

// Cache keys fold punctuation, hamza and spacing.
assert.equal(aiQueryKey("  أنمي   زي «ناروتو»؟ "), aiQueryKey("انمي زي ناروتو"));

// Batch query uses aliases and variables.
const b = buildAniListBatch(["Death Note", "Monster"]);
assert.ok(b.query.includes("m0:Page") && b.query.includes("m1:Page"));
assert.ok(b.query.startsWith("query($q0:String,$q1:String)"));
assert.deepEqual(b.variables, { q0: "Death Note", q1: "Monster" });

// Parse keeps the AI order, drops misses and duplicate ids.
const parsed = parseAniListBatch(
  {
    data: {
      m0: { media: [{ id: 1535, title: { romaji: "Death Note", english: "Death Note" }, coverImage: { large: "https://img/1.jpg" }, format: "TV", seasonYear: 2006, averageScore: 84, episodes: 37 }] },
      m1: { media: [] },
      m2: { media: [{ id: 1535, title: { romaji: "Death Note" } }] },
      m3: { media: [{ id: 19, title: { romaji: "Monster", english: null }, coverImage: { large: "https://img/2.jpg" }, format: "TV" }] },
    },
  },
  [
    { title: "Death Note", reason: "عبقري ضد محقق" },
    { title: "Nope", reason: "" },
    { title: "Death Note (dup)", reason: "" },
    { title: "Monster", reason: "طبيب يطارد قاتلًا" },
  ],
);
assert.deepEqual(parsed.map((p) => p.anilistId), [1535, 19]);
assert.equal(parsed[0].reason, "عبقري ضد محقق");
assert.equal(parsed[0].year, 2006);
assert.equal(parsed[1].titleEnglish, null);
assert.deepEqual(parseAniListBatch(null, [{ title: "x", reason: "" }]), []);

console.log("ai search core tests passed");

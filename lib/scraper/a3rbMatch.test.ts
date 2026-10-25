import assert from "node:assert/strict";
import { a3rbCatalogMatch, a3rbCompactKey } from "./direct";

// anime3rb title matching across sites that split romaji differently.
// Regression: witanime's "Aoashi Season 2" never found anime3rb's
// "ao-ashi-season-2" (no anime3rb servers on any episode), 2026-10-25.

const catalog = [
  "ao-ashi", "ao-ashi-season-2", "ao-no-hako", "ao-no-hako-season-2",
  "dragon-ball", "dragon-ball-z", "blood", "blood-c",
  "chihayafuru", "chihayafuru-2", "chihayafuru-3",
  "kengan-ashura", "kengan-ashura-season-2", "kengan-ashura-season-2-part-2",
  "major-s1", "major-2nd", "tokyo-ghoul", "tokyo-ghoul-a",
  "kimetsu-no-yaiba", "kimetsu-no-yaiba-mugenjou-hen",
];

function main() {
  // Word-break differences, both directions, season kept strict.
  assert.equal(a3rbCatalogMatch("Aoashi Season 2", catalog), "ao-ashi-season-2");
  assert.equal(a3rbCatalogMatch("Aoashi 2nd Season", catalog), "ao-ashi-season-2");
  assert.equal(a3rbCatalogMatch("Aoashi", catalog), "ao-ashi");
  assert.equal(a3rbCatalogMatch("Ao Ashi Season 2", catalog), "ao-ashi-season-2");
  assert.equal(a3rbCatalogMatch("Kimetsu no Yaiba Mugen jou hen", catalog), "kimetsu-no-yaiba-mugenjou-hen");
  // A season anime3rb doesn't have is NO match, never another season's page.
  assert.equal(a3rbCatalogMatch("Aoashi Season 3", catalog), null);

  // Glued keys keep one-letter words: these must never collapse together.
  assert.notEqual(a3rbCompactKey("dragon ball z", 1), a3rbCompactKey("dragon ball", 1));
  assert.notEqual(a3rbCompactKey("blood c", 1), a3rbCompactKey("blood", 1));
  assert.equal(a3rbCatalogMatch("Dragonball Z", catalog), "dragon-ball-z");
  assert.equal(a3rbCatalogMatch("Bloodc", catalog), "blood-c");
  // Season numbers written any way share a key; cours ("part 2") do not.
  assert.equal(a3rbCompactKey("chihayafuru 2", 2), a3rbCompactKey("Chihayafuru Season 2", 2));
  assert.equal(a3rbCatalogMatch("Chihaya Furu Season 2", catalog), "chihayafuru-2");
  assert.notEqual(a3rbCompactKey("kengan ashura season 2 part 2", 2), a3rbCompactKey("kengan ashura season 2", 2));
  assert.equal(a3rbCatalogMatch("Kenganashura Season 2", catalog), "kengan-ashura-season-2");
  // "Major 2nd" is its own show — a bare ordinal is not a season marker.
  assert.notEqual(a3rbCompactKey("major 2nd", 1), a3rbCompactKey("major", 1));

  console.log("anime3rb title match tests passed");
}

main();

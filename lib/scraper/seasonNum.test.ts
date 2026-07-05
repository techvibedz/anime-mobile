// Tests for tm_seasonNum — the shared season detector that keeps a later season
// from resolving to season 1's page (wrong episode numbering). The Roman-numeral
// cases are the regression: "Mushoku Tensei III" used to read as season 1, so
// its anime3rb servers played season 1's episodes.
// Run:  npx tsx lib/scraper/seasonNum.test.ts

import assert from "node:assert";
import { tm_seasonNum } from "./direct";

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e: any) { failed++; console.error(`FAIL  ${name}\n      ${e?.message || e}`); }
}

test("no marker → season 1", () => {
  assert.equal(tm_seasonNum("Mushoku Tensei: Isekai Ittara Honki Dasu"), 1);
});
test("Roman III → 3 (the regression)", () => {
  assert.equal(tm_seasonNum("Mushoku Tensei III: Isekai Ittara Honki Dasu"), 3);
});
test("Roman II → 2", () => {
  assert.equal(tm_seasonNum("Mushoku Tensei II: Isekai Ittara Honki Dasu"), 2);
});
test("LOWERCASE roman in a slug is detected (anime3rb 'mushoku-tensei-ii-…')", () => {
  // The catalog matcher lowercases both sides and anime3rb slugs are lowercase,
  // so multi-letter romans MUST match case-insensitively — the real bug.
  assert.equal(tm_seasonNum("mushoku tensei ii isekai ittara honki dasu"), 2);
  assert.equal(tm_seasonNum("mushoku tensei iii isekai ittara honki dasu"), 3);
});
test("lowercase single v/x is NOT a season (word-collision guard)", () => {
  assert.equal(tm_seasonNum("gleipnir vs something"), 1); // stray lowercase, no bare v/x token
  assert.equal(tm_seasonNum("some anime v"), 1);          // lowercase single 'v' → not a season
});
test("Roman IV/V/IX resolve to 4/5/9", () => {
  assert.equal(tm_seasonNum("Some Anime IV"), 4);
  assert.equal(tm_seasonNum("Some Anime V"), 5);
  assert.equal(tm_seasonNum("Some Anime IX"), 9);
});
test('"season N" still wins', () => {
  assert.equal(tm_seasonNum("Overlord Season 4"), 4);
});
test('"Nth Season" still wins', () => {
  assert.equal(tm_seasonNum("Boku no Hero Academia 7th Season"), 7);
});
test("Arabic الموسم still works", () => {
  assert.equal(tm_seasonNum("ناروتو الموسم 2"), 2);
});
test("lowercase stray roman letters do NOT trip (case guard)", () => {
  // "vinland", "vi" mid-word, a lowercase "v" — none are season markers.
  assert.equal(tm_seasonNum("Vinland Saga"), 1);
  assert.equal(tm_seasonNum("Gleipnir"), 1);
});
test("number-bearing title is not a Roman season (Mob Psycho 100)", () => {
  assert.equal(tm_seasonNum("Mob Psycho 100"), 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

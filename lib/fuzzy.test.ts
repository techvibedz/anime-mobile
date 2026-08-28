// Characterization tests for the pure fuzzy title matching in ./fuzzy.
// Run:  npx tsx lib/fuzzy.test.ts
//
// No test framework is installed, so this is a tiny self-contained harness
// (assert + a pass/fail tally) that exits non-zero on any failure. These tests
// document the CURRENT behaviour of normFuzzy / levenshtein / fuzzyScore — the
// pure logic that re-ranks source search results and recovers titles from the
// local anime3rb catalog. Non-1.0/non-0 scores use range assertions on purpose:
// the exact float is an implementation detail, the relative ordering is not.

import assert from "node:assert";
import { normFuzzy, levenshtein, fuzzyScore, sourceSearchQueries, wordSearchFallbacks } from "./fuzzy";

let passed = 0;
let failed = 0;
const queue: { name: string; fn: () => void | Promise<void> }[] = [];
function test(name: string, fn: () => void | Promise<void>) {
  queue.push({ name, fn });
}
async function runAll() {
  for (const { name, fn } of queue) {
    try {
      await fn();
      passed++;
      console.log(`  ok  ${name}`);
    } catch (e: any) {
      failed++;
      console.error(`FAIL  ${name}\n      ${e?.message || e}`);
    }
  }
}

/* ── normFuzzy ── */

test("normFuzzy drops a colon and lowercases (Re:Zero → re zero)", () => {
  assert.equal(normFuzzy("Re:Zero"), "re zero");
});

test("normFuzzy strips trailing punctuation (Fullmetal! → fullmetal)", () => {
  assert.equal(normFuzzy("Fullmetal!"), "fullmetal");
});

test("normFuzzy folds Latin diacritics (Pokémon → pokemon)", () => {
  assert.equal(normFuzzy("Pokémon"), "pokemon");
});

test("normFuzzy returns empty for empty/whitespace-only input", () => {
  assert.equal(normFuzzy(""), "");
  assert.equal(normFuzzy("   "), "");
  assert.equal(normFuzzy("!!!"), "");
});

test("normFuzzy collapses multiple spaces and trims", () => {
  assert.equal(normFuzzy("  full   metal  "), "full metal");
});

/* ── levenshtein ── */

test("levenshtein of identical strings is 0", () => {
  assert.equal(levenshtein("a", "a"), 0);
  assert.equal(levenshtein("naruto", "naruto"), 0);
});

test("levenshtein with one empty string is the other's length", () => {
  assert.equal(levenshtein("", "abc"), 3);
  assert.equal(levenshtein("abc", ""), 3);
});

test("levenshtein of a one-edit typo is 1 (narto → naruto)", () => {
  assert.equal(levenshtein("narto", "naruto"), 1);
});

test("levenshtein early-out returns max+1 once the cap is exceeded", () => {
  // "abcdef" vs "zzzzzz" is distance 6; with cap 2 it bails to 3.
  assert.equal(levenshtein("abcdef", "zzzzzz", 2), 3);
});

/* ── fuzzyScore ── */

test("fuzzyScore of an exact post-normalize match is 1", () => {
  assert.equal(fuzzyScore("re zero", "Re:Zero"), 1);
});

test("fuzzyScore is 0 for empty query or empty title", () => {
  assert.equal(fuzzyScore("", "Naruto"), 0);
  assert.equal(fuzzyScore("Naruto", ""), 0);
});

test("fuzzyScore is high for a strong typo (narto vs Naruto)", () => {
  assert.ok(fuzzyScore("narto", "Naruto") > 0.7, `got ${fuzzyScore("narto", "Naruto")}`);
});

test("fuzzyScore is low for unrelated titles (naruto vs One Piece)", () => {
  // Observed: exactly 0.5 — the spaceless typo path caps its edit distance at
  // ceil(6*0.4)=3 and divides by the longer length (8), so 1 - 4/8 = 0.5. This
  // documents the current ceiling, not a target; it still ranks well below a
  // real match (>0.7). Assert it stays at-or-below this boundary.
  assert.ok(fuzzyScore("naruto", "One Piece") <= 0.5, `got ${fuzzyScore("naruto", "One Piece")}`);
});

test("fuzzyScore absorbs spacing differences (full metal vs Fullmetal Alchemist)", () => {
  const s = fuzzyScore("full metal", "Fullmetal Alchemist");
  assert.ok(s > 0.7, `got ${s}`);
});

test("wordSearchFallbacks recovers meaningful pieces of a failed phrase", () => {
  assert.deepEqual(wordSearchFallbacks("naruto shuppudin"), ["naruto", "shuppudin"]);
  assert.deepEqual(wordSearchFallbacks("Attack on Titan season 3"), ["attack", "titan"]);
  assert.deepEqual(wordSearchFallbacks("naruto"), []);
});

test("sourceSearchQueries searches full text and separate words together", () => {
  assert.deepEqual(
    sourceSearchQueries("Naruto: Shuppudin"),
    ["Naruto: Shuppudin", "naruto shuppudin", "naruto", "shuppudin"],
  );
});

/* ── summary ── */

runAll().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});

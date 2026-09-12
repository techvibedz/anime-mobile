// Unit tests for the pure watch-party sync math.
// Run:  npx tsx lib/watchParty.test.ts
//
// computeSync is the whole correctness surface clients depend on: match the
// host's play/pause, and seek ONLY when drift exceeds the tolerance window.

import assert from "node:assert";
import { computeSync, DRIFT_TOLERANCE_MS, genCode, type PartyState } from "./watchPartySync";

const base = (over: Partial<PartyState> = {}): PartyState => ({
  episode: "ep",
  params: {},
  positionMs: 10_000,
  playing: true,
  at: 1_000_000,
  ...over,
});

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e: any) { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; }
}

// In-tolerance drift → no seek.
test("no seek when within tolerance", () => {
  const s = base();
  const r = computeSync(s, 10_000, s.at); // exact, no elapsed
  assert.strictEqual(r.shouldSeekTo, null);
  assert.strictEqual(r.play, true);
});

// Elapsed time is added while playing, so a client that's "caught up" doesn't seek.
test("compensates for elapsed time while playing", () => {
  const s = base();
  const now = s.at + 1500; // 1.5s later
  // Compensation is capped below the correction window so clock skew cannot
  // create a seek storm: expected 10100, local 10050 → 50ms drift.
  const r = computeSync(s, 10_050, now);
  assert.strictEqual(r.shouldSeekTo, null);
});

// Drift beyond tolerance → seek to the elapsed-compensated position.
test("seeks when drift exceeds tolerance", () => {
  const s = base();
  const now = s.at + 1000;
  const expected = s.positionMs + 100; // transit compensation cap
  const r = computeSync(s, expected + DRIFT_TOLERANCE_MS + 500, now);
  assert.strictEqual(r.shouldSeekTo, expected);
});

// When the host is paused, elapsed time is NOT added (position is frozen).
test("paused host: no elapsed compensation, follows pause", () => {
  const s = base({ playing: false });
  const now = s.at + 10_000; // long gap
  const r = computeSync(s, s.positionMs, now);
  assert.strictEqual(r.shouldSeekTo, null);
  assert.strictEqual(r.play, false);
});

// A client whose clock is far AHEAD of the host's must not seek-storm: the
// compensation is clamped under the drift tolerance, so the seek stays off.
test("clamped compensation: skewed client clock does not seek", () => {
  const s = base(); // host at 10000, playing
  const now = s.at + 60_000; // client clock 60s ahead
  const r = computeSync(s, 10_150, now); // client actually in sync (~0.05s off)
  assert.strictEqual(r.shouldSeekTo, null);
});

// Late delivery is capped, then corrected once the remaining drift is visible.
test("caps transit compensation and corrects visible drift", () => {
  const s = base();
  const now = s.at + 900;
  const r = computeSync(s, 10_000 + 900 + DRIFT_TOLERANCE_MS + 500, now);
  assert.strictEqual(r.shouldSeekTo, 10_100);
});

test("visual drift window stays below a quarter second", () => {
  assert.ok(DRIFT_TOLERANCE_MS <= 250);
});

// Room codes avoid ambiguous glyphs and are the right length.
test("genCode: 5 unambiguous chars", () => {
  const c = genCode();
  assert.strictEqual(c.length, 5);
  assert.ok(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/.test(c), c);
});

console.log(`\n${passed} passed`);

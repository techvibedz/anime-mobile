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
  // Client advanced ~1.5s too → expected 11500, local 11400 → 100ms drift.
  const r = computeSync(s, 11_400, now);
  assert.strictEqual(r.shouldSeekTo, null);
});

// Drift beyond tolerance → seek to the elapsed-compensated position.
test("seeks when drift exceeds tolerance", () => {
  const s = base();
  const now = s.at + 1000;
  const expected = s.positionMs + 1000; // 11000
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

// Room codes avoid ambiguous glyphs and are the right length.
test("genCode: 5 unambiguous chars", () => {
  const c = genCode();
  assert.strictEqual(c.length, 5);
  assert.ok(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/.test(c), c);
});

console.log(`\n${passed} passed`);

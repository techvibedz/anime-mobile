// Unit tests for the pure poster-sizing math.
// Run:  npx tsx lib/img.test.ts
//
// buildPhotonUrl is the correctness surface: only witanime hosts get wrapped,
// widths snap to buckets, everything else passes through byte-for-byte.

import assert from "node:assert";
import { buildPhotonUrl } from "./img";

let passed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e: any) { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; }
}

test("witanime.you → Photon-wrapped, bucketed width, webp-ready", () => {
  const out = buildPhotonUrl("https://witanime.you/wp-content/uploads/2026/04/X-413x559.jpg", 220);
  assert.equal(out, "https://i0.wp.com/witanime.you/wp-content/uploads/2026/04/X-413x559.jpg?w=240&quality=75&strip=all&ssl=1");
});

test("witanime.life (alt TLD) also wrapped", () => {
  assert.ok(buildPhotonUrl("https://witanime.life/wp-content/uploads/x.jpg", 100).startsWith("https://i0.wp.com/witanime.life/"));
});

test("width snaps UP to the nearest bucket, caps at max", () => {
  assert.match(buildPhotonUrl("https://witanime.you/a.jpg", 181), /\?w=240&/);
  assert.match(buildPhotonUrl("https://witanime.you/a.jpg", 9999), /\?w=800&/);
});

test("anime4up passes through untouched (403s on Photon)", () => {
  const raw = "https://w1.anime4up.rest/wp-content/uploads/2026/04/Kill-Ao.jpg";
  assert.equal(buildPhotonUrl(raw, 240), raw);
});

test("anime3rb passes through untouched", () => {
  const raw = "https://images.anime3rb.com/297908/1654bceb88153c.jpg";
  assert.equal(buildPhotonUrl(raw, 240), raw);
});

test("garbage input returns as-is, never throws", () => {
  assert.equal(buildPhotonUrl("not a url", 240), "not a url");
});

console.log(`\n${passed} passed`);

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

test("hero-size requests can reach 1200px", () => {
  assert.match(buildPhotonUrl("https://witanime.you/a.jpg", 1000, 1200), /\?w=1200&/);
});

test("manga WordPress CDNs (3asq, mangalik) are wrapped", () => {
  assert.ok(buildPhotonUrl("https://3asq.online/wp-content/uploads/2026/10/5.jpg", 150).startsWith("https://i0.wp.com/3asq.online/"));
  assert.ok(buildPhotonUrl("https://io.mangalik.net/wp-content/uploads/a.webp", 150).startsWith("https://i0.wp.com/io.mangalik.net/"));
  assert.equal(buildPhotonUrl("https://not3asq.online.evil.com/a.jpg", 150), "https://not3asq.online.evil.com/a.jpg");
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

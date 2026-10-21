// Run: npx tsx lib/scraper/a3rbCatalogSeed.test.ts
// The bundled anime3rb title list is the search/playback catalog's floor since
// anime3rb cut its sitemap to ~550 titles (2026-10-21).
import assert from "node:assert/strict";
import { A3RB_CATALOG_SEED } from "./a3rbCatalogSeed";

const slugs = A3RB_CATALOG_SEED.split(/\r?\n/);
assert.ok(slugs.length > 6000, `seed shrank to ${slugs.length}`);
assert.equal(new Set(slugs).size, slugs.length, "no duplicate slugs");
for (const slug of slugs) assert.match(slug, /^[^\s/<>]+$/, `malformed slug: ${JSON.stringify(slug)}`);
for (const known of ["naruto", "one-piece", "jujutsu-kaisen", "darwins-game", "bubblegum-crisis"]) assert.ok(slugs.includes(known), known);
console.log(`PASS anime3rb catalog seed (${slugs.length} titles)`);

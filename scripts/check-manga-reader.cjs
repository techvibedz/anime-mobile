const assert = require("node:assert/strict");
const fs = require("node:fs");

// Wiring contract for the manga section (reader v2 + combined sources). These
// invariants encode the fixes for real reported bugs — if a future edit removes
// one, the failure names the regression instead of it shipping silently.

const reader = fs.readFileSync("app/manga-reader/[chapter].tsx", "utf8");
const pageImage = fs.readFileSync("components/MangaPageImage.tsx", "utf8");
const hub = fs.readFileSync("app/(tabs)/manga.tsx", "utf8");
const detail = fs.readFileSync("app/manga/[id].tsx", "utf8");
const library = fs.readFileSync("app/manga-library.tsx", "utf8");
const store = fs.readFileSync("lib/manga/store.ts", "utf8");
const api = fs.readFileSync("lib/manga/api.ts", "utf8");
const types = fs.readFileSync("lib/manga/types.ts", "utf8");
const aggregate = fs.readFileSync("lib/manga/aggregate.ts", "utf8");
const genres = fs.readFileSync("lib/manga/genres.ts", "utf8");

// Zoom: pinch must arbitrate with the native list scroll (the Android race
// that killed zoom) and keep full-resolution textures while zoomed. Double-tap
// zoom was removed by request — zoom is pinch-only.
assert.ok(reader.includes("blocksExternalGesture"), "reader: pinch must block the external list gesture");
assert.ok(reader.includes("Gesture.Native()"), "reader: native list gesture composition missing");
assert.ok(pageImage.includes("allowDownscaling={!fullResolution}"), "reader: long strips must retain safe downsampling");
assert.ok(!reader.includes("Image.loadAsync"), "reader: prefetch must not decode full-size pages a second time");
assert.ok(!reader.includes("Image.prefetch("), "reader: Android prefetch must not add uncancellable original-size decodes");
assert.ok(!reader.includes("numberOfTaps(2)"), "reader: double-tap zoom must stay removed");
assert.ok(!reader.includes("doubleTap"), "reader: double-tap zoom must stay removed");

// Degraded page decodes self-heal by reloading outside the image cache.
assert.ok(reader.includes("noteNaturalWidth"), "reader: page quality self-heal baseline missing");
assert.ok(pageImage.includes("cacheKey"), "reader: page quality self-heal must bypass the image cache");

// One-finger pan must gate on the live shared zoom flag (manual activation),
// not on React state — otherwise the list steals the drag mid-zoom.
assert.ok(reader.includes("manualActivation(true)"), "reader: pan must use manual activation");
assert.ok(reader.includes("onTouchesMove"), "reader: pan activation must read the live zoom flag");
assert.ok(reader.includes("zoomFlag"), "reader: shared zoom flag missing");

// Fit modes + the three reading modes.
for (const mode of ["width", "screen", "height", "stretch", "original", "smart"]) {
  assert.ok(reader.includes(`"${mode}"`), `reader: fit mode "${mode}" missing`);
}
assert.ok(reader.includes("pagedV"), "reader: vertical paged mode missing");

// Per-page loading affordance + retry, and the resized-page URL fallback.
assert.ok(pageImage.includes("<MangaSkeleton"), "reader: page loading shimmer missing");
assert.ok(pageImage.includes("onLoadStart"), "reader: page loading state missing");
assert.ok(pageImage.includes("onRetry") || pageImage.includes("t.retry"), "reader: page retry state missing");
assert.ok(pageImage.includes("upgradeMangaPage"), "reader: page URL quality upgrade missing");

// Chrome only on tap: drags and pinches hide it.
assert.ok(reader.includes("setChrome(false)"), "reader: chrome must hide on scroll/zoom");

// Settings sheet must scroll and wrap — it overflows short screens otherwise.
assert.ok(reader.includes("settingsScroll"), "reader: settings sheet scroll container missing");
assert.ok(reader.includes("maxHeight"), "reader: settings sheet must cap its height");

// Merged reader identity: chapter refs carry the chapter's own source.
assert.ok(reader.includes("decodeReaderRef"), "reader: merged chapter ref decoder missing");
assert.ok(reader.includes("fetchMergedDetail"), "reader: chapter navigation must use the merged detail");
assert.ok(reader.includes("mangaChapterReadKey"), "reader: read marks must be source-scoped");

// Continue-reading removal.
assert.ok(store.includes("removeMangaProgress"), "store: removeMangaProgress missing");
assert.ok(hub.includes("removeMangaProgress"), "hub: continue-reading removal not wired");

// Combined hub: one merged feed + genre browse, no source chips/labels.
assert.ok(aggregate.includes("mergeHomes"), "aggregate: home merge missing");
assert.ok(aggregate.includes("mergeDetails"), "aggregate: chapter merge missing");
assert.ok(aggregate.includes("searchMergedManga"), "aggregate: merged search missing");
assert.ok(aggregate.includes("browseMergedGenre"), "aggregate: merged genre browse missing");
assert.ok(aggregate.includes("SOURCE_QUALITY_ORDER"), "aggregate: page-quality source order missing");
assert.ok(aggregate.includes("onPartial"), "aggregate: streamed partial results missing");
assert.ok(hub.includes("fetchMergedHome"), "hub: merged home not wired");
assert.ok(hub.includes("readCachedMergedHome"), "hub: merged home SWR cache not wired");
assert.ok(hub.includes("MANGA_GENRES"), "hub: genre filter catalog not wired");
assert.ok(hub.includes("browseMergedGenre"), "hub: genre browse not wired");
assert.ok(aggregate.includes("browseMergedAll"), "aggregate: filtered whole-catalog browse missing");
assert.ok(hub.includes("browseMergedAll"), "hub: empty-text filtered search not wired");
assert.ok(!hub.includes("SourceChips"), "hub: source tabs must stay removed");
assert.ok(!hub.includes("mangaSourceLabel"), "hub: source names must never render");
assert.ok(!detail.includes("mangaAttribution"), "detail: source attribution must stay removed");
assert.ok(detail.includes("readCachedMergedDetail"), "detail: merged SWR cache not wired");
assert.ok(detail.includes("mangaChapterReadKey"), "detail: source-scoped read marks not wired");

// Search streaming + stale-while-revalidate speed paths.
assert.ok(api.includes("readCachedMangaHome"), "api: home SWR cache missing");
assert.ok(api.includes("readCachedMangaDetail"), "api: detail SWR cache missing");
assert.ok(api.includes("browseMangaGenre"), "api: genre browse cache missing");

// High-resolution covers wired on every surface.
assert.ok(hub.includes("upgradeMangaCover"), "hub: cover upgrade not wired");
assert.ok(detail.includes("upgradeMangaCover"), "detail: cover upgrade not wired");
assert.ok(fs.readFileSync("components/MangaGrid.tsx", "utf8").includes("upgradeMangaCover"), "manga grid: cover upgrade not wired");

// Persisted page ratios (stable continuous-scroll anchor + uniform edges).
assert.ok(reader.includes("RATIOS_KEY"), "reader: persisted ratio cache missing");
// The cache must re-render already-mounted pages once it hydrates (it races the
// chapter fetch), and the continuous list must keep its anchor when a page's
// height changes after its bitmap decodes — otherwise the reader jumps.
assert.ok(reader.includes("ratioTick"), "reader: ratio cache hydration must re-render pages");
assert.ok(
  reader.includes("maintainVisibleContentPosition"),
  "reader: continuous scroll must preserve its anchor across page resizes",
);

// Azora is intentionally gone.
for (const [name, source] of Object.entries({ api, types, hub, detail, reader, aggregate })) {
  assert.ok(!/azora/i.test(source), `${name}: azora source must stay removed`);
}
assert.ok(genres.includes("MANGA_GENRES"), "genres: catalog missing");

console.log(
  "Manga wiring: combined sources, merged chapters, filters, zoom arbitration, settings scroll, page quality passed",
);

require("./check-manga-recovery.cjs");

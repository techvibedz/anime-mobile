# Parallel Source Home Failover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate the existing home UI promptly from WitAnime, Anime4up, or Anime3rb when any source is blocked, while preserving valid hero, recent-episode, trending, TV, and movie data.

**Architecture:** Normalize every source to the existing `WitHome` shape. Start all three source loaders concurrently, briefly prefer WitAnime, then accept the first valid fallback within a bounded live-source deadline before using the existing cloud cache.

**Tech Stack:** Expo 54, React Native, TypeScript, hidden `react-native-webview` scraper, Node assertion tests.

---

### Task 1: Normalize Anime4up Home Data

**Files:**
- Modify: `lib/scraper/direct.ts:371-458,707-721`
- Modify: `lib/scraper/scripts.ts:142-169`
- Create: `lib/scraper/homeFallback.test.ts`

- [ ] **Step 1: Write a failing parser test**

Use representative Anime4up HTML containing a `lucodeia-slider-slide-item` episode slide and anime cards. Assert that `fetchAnime4upHomeDirect`'s parser contract produces a non-empty `featured`, `episodes`, and `animes` collection, with the episode title separated from the anime title.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npx tsx lib/scraper/homeFallback.test.ts`

Expected: FAIL because Anime4up currently returns only an anime-card array.

- [ ] **Step 3: Implement the shared Anime4up parser**

Export a pure `parseAnime4upHomeHtml(html: string): WitHome | null` function. Parse episode hero slides into:

```ts
{
  featured: [{ title: animeTitle, href: episodeHref, image, description: null, genres: [] }],
  episodes: [{ title: `الحلقة ${number}`, href: episodeHref, image, animeTitle, animeHref: "", isNew: true }],
  animes: parseAnime4upCards(html).map(...),
}
```

Return `null` only when all three collections are empty. Update `fetchAnime4upHomeDirect()` to return this normalized shape. Mirror the same fields in `EXTRACT_HOME_4UP` so a Cloudflare/WebView fallback has the identical contract.

- [ ] **Step 4: Run focused parser and injected-script checks**

Run: `npx tsx lib/scraper/homeFallback.test.ts`

Expected: PASS.

Run: `node scripts/check-injected-js.js`

Expected: every extractor, including `EXTRACT_HOME_4UP`, reports `OK`.

### Task 2: Race Complete Source Loaders

**Files:**
- Modify: `lib/api.ts:328-459`
- Modify: `lib/scraper/homeFallback.test.ts`

- [ ] **Step 1: Write a failing bounded-failover test**

Add a pure exported helper that accepts source promises and timing values. Test with a never-settling primary and an immediately valid secondary; assert the secondary resolves before the primary and retains its source label.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npx tsx lib/scraper/homeFallback.test.ts`

Expected: FAIL because source selection is still sequential.

- [ ] **Step 3: Implement concurrent source selection**

Start these promises together:

```ts
const witP = loadWitHome();
const up4P = loadAnime4upHome();
const a3rbP = loadAnime3rbHome();
```

Give `witP` a short preference window. If it does not yield valid content, accept the first valid result from all three promises. Cap live selection before consulting `readCloudHome`. Build the result through `buildHomePayload(home, [], source)` so every source feeds the same UI contract and source href metadata remains correct.

- [ ] **Step 4: Preserve UI section validity**

Extend `buildHomePayload`'s source union to include `anime4up`. Keep section guards unchanged: hero is capped at five; trending requires anime cards; recent requires episode cards; TV and movies require correctly typed anime cards.

- [ ] **Step 5: Run the focused test**

Run: `npx tsx lib/scraper/homeFallback.test.ts`

Expected: PASS, including the blocked-primary timing assertion and all three normalized payload shape assertions.

### Task 3: Verify OTA Safety And Regression Coverage

**Files:**
- Modify: `package.json:11`

- [ ] **Step 1: Add the focused test to the existing test command**

Insert `npx --yes tsx lib/scraper/homeFallback.test.ts` alongside the other scraper tests.

- [ ] **Step 2: Run the complete verification command**

Run: `npm test`

Expected: TypeScript, injected scripts, wrapped scripts, source-domain tests, DoH generation checks, and all unit tests pass.

- [ ] **Step 3: Confirm OTA-only diff**

Run: `git diff --stat` and `git diff -- app.json plugins modules android ios`.

Expected: no native configuration, plugin, Android, iOS, permission, or dependency changes. Do not publish the OTA or create a commit without explicit user instruction.

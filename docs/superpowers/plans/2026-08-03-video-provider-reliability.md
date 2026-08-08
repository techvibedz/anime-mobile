# Video Provider Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Subagents are prohibited by the user.

**Goal:** Centralize provider behavior, remove duplicate/stale video work, and return a complete bounded server list with reliable direct and WebView fallback resolution.

**Architecture:** A pure provider-policy module owns classification, ranking, normalization, fallback mode, validation, and playback metadata. A small request cache coalesces identical async work. `lib/api.ts` coordinates complete cross-source discovery and media resolution, while the watch screen performs one generation-guarded list load and resolves only the selected server.

**Tech Stack:** TypeScript, React Native, Expo Video, React Native WebView, AsyncStorage, Node assert tests.

---

## File Map

- Create `lib/videoProviders.ts`: pure provider registry and shared helpers.
- Create `lib/videoProviders.test.ts`: registry, classifier, ordering, normalization, and validation tests.
- Create `lib/requestCache.ts`: bounded in-memory TTL and in-flight request coalescing.
- Create `lib/requestCache.test.ts`: concurrent-call, force, validity, and expiry tests.
- Modify `lib/scraper/direct.ts`: consume shared classification and expose deterministic direct extraction results unchanged.
- Modify `lib/scraper/scripts.ts`: generate its injected provider classifier from shared policy.
- Modify `lib/api.ts`: preserve all valid providers, use true cache hits, coalesce resolution, and add complete source discovery.
- Modify `app/watch/[episode].tsx`: one complete generation-guarded load, no duplicate enrichment or speculative pre-resolution.
- Modify `package.json`: include new tests.

### Task 1: Provider Policy

**Files:**
- Create: `lib/videoProviders.test.ts`
- Create: `lib/videoProviders.ts`
- Modify: `lib/scraper/direct.ts`
- Modify: `lib/scraper/scripts.ts`

- [ ] **Step 1: Write failing policy tests**

Test that every live provider host classifies consistently, WebView-only providers are supported, Vid3rb quality fragments remain distinct, duplicate ordinary URLs normalize together, ranking is deterministic, and media validation rejects embeds/decoys.

- [ ] **Step 2: Verify red**

Run: `npx --yes tsx lib/videoProviders.test.ts`

Expected: FAIL because `videoProviders.ts` does not exist.

- [ ] **Step 3: Implement the pure registry**

Define `PROVIDER_POLICIES`, `classifyProvider`, `providerRank`, `providerFailureMode`, `providerClassifierScript`, `normalizeServerUrl`, `sortVideoServers`, `validateMediaUrl`, `videoPlaybackHeaders`, and `videoContentType`. Unknown valid providers must remain `generic`; only `yonaplay` is marked blocked.

- [ ] **Step 4: Replace duplicated classifier code**

Import `classifyProvider` in `direct.ts`. Interpolate `providerClassifierScript("provider")` into `EXTRACT_VIDEO_SERVERS` so injected JavaScript uses the same ordered patterns.

- [ ] **Step 5: Verify green and injected syntax**

Run: `npx --yes tsx lib/videoProviders.test.ts; node scripts/check-injected-js.js`

Expected: all provider tests pass and every injected script reports `OK`.

### Task 2: Request Coalescing

**Files:**
- Create: `lib/requestCache.test.ts`
- Create: `lib/requestCache.ts`

- [ ] **Step 1: Write failing request-cache tests**

Cover two concurrent calls invoking one loader, a fresh cached hit invoking no loader, `force` invoking a new loader, invalid results not caching, and expired values reloading.

- [ ] **Step 2: Verify red**

Run: `npx --yes tsx lib/requestCache.test.ts`

Expected: FAIL because `requestCache.ts` does not exist.

- [ ] **Step 3: Implement the minimal cache**

Expose `createRequestCache<T>(ttlMs, now?)` with `run(key, load, { force, valid })`, `delete(key)`, and `clear()`. Forced calls bypass values but still replace/share the key's in-flight promise.

- [ ] **Step 4: Verify green**

Run: `npx --yes tsx lib/requestCache.test.ts`

Expected: all request-cache tests pass.

### Task 3: API Discovery and Resolution

**Files:**
- Modify: `lib/api.ts`
- Modify: `lib/scraper/embedExtract.test.ts`

- [ ] **Step 1: Extend failing behavior tests**

Add fixtures asserting non-direct providers remain in merged lists, provider media validation is applied, and complete-list merging keeps successful sources while deduplicating equivalent URLs.

- [ ] **Step 2: Verify red**

Run: `npx --yes tsx lib/scraper/embedExtract.test.ts`

Expected: FAIL on provider preservation or complete-list helper imports.

- [ ] **Step 3: Fix lower-level server caching**

Replace server-list SWR with request coalescing plus a real six-hour TTL: a cache hit performs no scrape, a force refresh bypasses it, and partial cross-source results are not stored as complete.

- [ ] **Step 4: Add complete source coordination**

Implement `fetchCompleteVideoServers({ episodeUrl, url4up, url3rb, animeHref, animeTitle, episodeNumber, force })`. Start primary, Anime4up sibling lookup, and Anime3rb discovery concurrently; await all applicable work with settled-result semantics; preserve every valid non-blocked provider; normalize, deduplicate, and sort through shared policy.

- [ ] **Step 5: Centralize media resolution**

Keep provider-specific direct extractors, but route them through one coalesced `resolveVideo`. Run one hidden-WebView fallback when policy allows, validate its media URL, and accept `fresh=true` for token recovery. Remove watch-level extraction retries.

- [ ] **Step 6: Make downloads reuse complete discovery**

Run Anime3rb and primary discovery concurrently and reuse shared sorting/download eligibility. Do not persist resolved media URLs.

- [ ] **Step 7: Verify green**

Run: `npx --yes tsx lib/scraper/embedExtract.test.ts; npx --yes tsc --noEmit`

Expected: provider tests pass and TypeScript reports no errors.

### Task 4: Watch-Screen Race Removal

**Files:**
- Modify: `app/watch/[episode].tsx`

- [ ] **Step 1: Add a pure stale-generation assertion**

Add the generation helper to `videoProviders.ts` and a failing test proving an old generation cannot commit after a newer episode starts.

- [ ] **Step 2: Verify red**

Run: `npx --yes tsx lib/videoProviders.test.ts`

Expected: FAIL because the generation helper is missing.

- [ ] **Step 3: Replace overlapping discovery effects**

Call `fetchCompleteVideoServers` once from `loadServers`, pass all known source identifiers, increment a generation before each load/refresh, and ignore stale completions. Delete separate Anime4up append and Anime3rb retry effects.

- [ ] **Step 4: Remove speculative pre-resolution**

Delete the top-four background resolver. Mark only the selected/automatic server `resolving`, call `resolveVideo` once, and serially advance after failure. Keep visible WebView fallback for policy-approved providers.

- [ ] **Step 5: Preserve recovery and prefetch**

Player self-heal calls `resolveVideo(..., { priority: true, fresh: true })`; neighbouring Anime3rb server-list prefetch remains fire-and-forget and coalesced.

- [ ] **Step 6: Verify TypeScript and focused tests**

Run: `npx --yes tsc --noEmit; npx --yes tsx lib/videoProviders.test.ts; npx --yes tsx lib/requestCache.test.ts`

Expected: no type errors and all focused tests pass.

### Task 5: Full Verification

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add new tests to the project test command**

Append `npx --yes tsx lib/videoProviders.test.ts` and `npx --yes tsx lib/requestCache.test.ts` to `npm test`.

- [ ] **Step 2: Run all deterministic checks**

Run: `npm test`

Expected: TypeScript, injected JavaScript checks, wrapped-script checks, and all tests pass.

- [ ] **Step 3: Run live provider diagnostics**

Run: `npx --yes tsx scripts/test-direct-providers.ts`

Expected: source server lists are discovered. Individual direct providers may report current upstream parse misses; those providers must remain available through bounded WebView fallback.

- [ ] **Step 4: Inspect the final diff**

Run: `git diff --check` and `git status --short`.

Expected: no whitespace errors. Existing unrelated dirty files remain untouched. Do not commit and do not publish an OTA.

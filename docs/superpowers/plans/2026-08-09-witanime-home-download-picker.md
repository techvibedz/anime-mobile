# Witanime-Only Home and Download Picker Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Home on Witanime only and make downloadable server choices appear within a bounded wait.

**Architecture:** Replace the generic Home source race with a sequential Witanime direct/WebView loader. Reuse the existing raw server discovery APIs for downloads, but stop before expensive video resolution and media probes; filter and order candidates with a small pure helper. Add retry state to the existing picker.

**Tech Stack:** Expo 54, React Native, TypeScript, plain `tsx` assertion tests, EAS Update.

---

## File Map

- Modify `lib/homeSourceSelection.ts`: expose only the Witanime direct/WebView loading policy.
- Modify `lib/scraper/homeFallback.test.ts`: regress Witanime-only loading and direct-to-WebView fallback.
- Modify `lib/api.ts`: remove Home replacement sources and use bounded raw download discovery.
- Modify `lib/videoProviders.ts`: filter, sort, deduplicate, and label downloadable candidates.
- Modify `lib/videoProviders.test.ts`: cover downloadable candidate selection.
- Modify `components/DownloadPicker.tsx`: show retry after an empty or timed-out lookup.
- Modify `package.json`: keep focused tests in the standard suite if a new test command is needed.

### Task 1: Witanime-Only Home

- [ ] **Step 1: Write the failing Home policy test**

Replace source-race assertions in `lib/scraper/homeFallback.test.ts` with assertions that `loadWitanimeHome()` returns direct content without calling WebView, falls back to WebView after an empty direct result, and returns `null` when both fail.

- [ ] **Step 2: Verify the focused test fails**

Run: `npx --yes tsx lib/scraper/homeFallback.test.ts`

Expected: FAIL because `loadWitanimeHome` is not exported.

- [ ] **Step 3: Implement the minimal Witanime loader**

Replace `selectHomeSource()` in `lib/homeSourceSelection.ts` with:

```ts
export async function loadWitanimeHome<T>(
  direct: () => Promise<T | null>,
  webView: () => Promise<T | null>,
): Promise<T | null> {
  return await direct().catch(() => null) || await webView().catch(() => null);
}
```

Update `fetchHomeFresh()` in `lib/api.ts` to call this helper with `fetchWitHomeDirect()` and `scrapeWitanimeHome()`, validating each result with `sourceHomeHasContent`. Remove Anime4up, Anime3rb, and cloud fallback branches from this function. Preserve local cache writes and cloud scout uploads for successful Witanime payloads, but never read the cloud feed as a Home replacement.

- [ ] **Step 4: Verify the focused test passes**

Run: `npx --yes tsx lib/scraper/homeFallback.test.ts`

Expected: `home fallback tests passed` and exit 0.

### Task 2: Fast Download Candidate Discovery

- [ ] **Step 1: Write the failing candidate-selection test**

Add assertions in `lib/videoProviders.test.ts` for a new `selectDownloadCandidates()` helper. Given mixed `vid3rb`, `mp4upload`, HLS-only, duplicate, and empty candidates, it must return only unique `vid3rb`/`mp4upload` entries, with `vid3rb` first and quality labels `FHD`, `HD`, `SD`, or empty.

- [ ] **Step 2: Verify the focused test fails**

Run: `npx --yes tsx lib/videoProviders.test.ts`

Expected: FAIL because `selectDownloadCandidates` is not exported.

- [ ] **Step 3: Implement candidate selection**

Add `selectDownloadCandidates()` to `lib/videoProviders.ts`, reusing `mergeVideoServers()`, `isDownloadProvider()`, and `qualityScore()` rather than duplicating provider policy.

Change `listDownloadServers()` in `lib/api.ts` to start these operations concurrently:

```ts
const primary = withTimeout(fetchVideoServers(episodeHref, url4up).catch(() => null), 15_000, null);
const anime3rb = withTimeout(
  (url3rb
    ? fetchAnime3rbServersByUrl(url3rb)
    : animeTitle && epNum != null
      ? fetchAnime3rbServers(animeTitle, epNum)
      : Promise.resolve([] as RawServer[])
  ).catch(() => [] as RawServer[]),
  15_000,
  [] as RawServer[],
);
```

Await both, pass their raw servers to `selectDownloadCandidates()`, and return immediately. Do not call `fetchCompleteVideoServers()`, `resolveVideo()`, or `probeMediaUrl()` while opening the picker.

- [ ] **Step 4: Verify the focused test passes**

Run: `npx --yes tsx lib/videoProviders.test.ts`

Expected: all video-provider assertions pass.

### Task 3: Retryable Picker State

- [ ] **Step 1: Add bounded retry behavior**

In `components/DownloadPicker.tsx`, add an integer retry generation to the existing effect dependencies. When `servers` is an empty array, keep the existing error text and render a `t.retry` button that increments the generation. Preserve the existing `alive` cleanup so late responses cannot overwrite a newer attempt or a closed picker.

- [ ] **Step 2: Typecheck the component**

Run: `npx --yes tsc --noEmit`

Expected: exit 0 with no errors.

### Task 4: Full Verification and Preview OTA

- [ ] **Step 1: Run the complete repository checks**

Run: `npm test`

Expected: TypeScript, injected JavaScript checks, and every assertion script exit 0.

- [ ] **Step 2: Inspect only intended changes**

Run: `git diff --check` and `git status --short`.

Expected: no whitespace errors; unrelated pre-existing changes remain untouched.

- [ ] **Step 3: Publish the current app runtime to preview**

Run: `npx eas-cli update --branch preview --platform android --message "fix: Witanime-only home and reliable downloads" --non-interactive`

Expected: EAS reports a successful Android update group for runtime `3.3.1`. Do not use the all-runtime publish script because this request targets only the latest preview version.

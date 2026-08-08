# Mp4upload Direct Playback And Fast MAL Scores Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore mp4upload as a direct-only native player provider and show MAL scores before slower full anime information finishes loading.

**Architecture:** Reuse the existing mp4upload static/WebView extraction pipeline and expose it by updating the two existing provider allowlists. Extract the existing MAL prefix request into one testable function, use it before Jikan for score-only requests, and let the Info tab retain the full enrichment path.

**Tech Stack:** Expo 54, React Native, TypeScript, Node assert tests, AsyncStorage

---

## File Map

- `lib/scraper/direct.ts`: shared visible direct-provider allowlist.
- `app/watch/[episode].tsx`: direct-only playback policy and fast header rating request.
- `lib/scraper/embedExtract.test.ts`: provider visibility regression.
- `lib/animeInfo.ts`: reusable MAL prefix lookup and score-first network order.
- `lib/animeInfo.test.ts`: lightweight prefix lookup regression.

### Task 1: Restore Mp4upload Visibility

**Files:**
- Modify: `lib/scraper/embedExtract.test.ts:101-107`
- Modify: `lib/scraper/direct.ts:544`
- Modify: `app/watch/[episode].tsx:71-76`

- [ ] **Step 1: Write the failing provider test**

Change the direct-provider assertion to require mp4upload and remove it from the rejected list:

```ts
assert.equal(isDirectVideoProvider("mp4upload"), true);
for (const provider of ["dailymotion", "voe", "doodstream", "okru", "yonaplay", "generic", "vk", "mega"])
  assert.equal(isDirectVideoProvider(provider), false, `${provider} should stay hidden`);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx --yes tsx lib/scraper/embedExtract.test.ts`

Expected: FAIL because `isDirectVideoProvider("mp4upload")` is currently false.

- [ ] **Step 3: Add mp4upload to both direct allowlists**

In `lib/scraper/direct.ts`:

```ts
const DIRECT_VIDEO_PROVIDERS = new Set(["vid3rb", "mp4upload", "streamwish", "videa", "videas"]);
```

In `app/watch/[episode].tsx`:

```ts
const DIRECT_ONLY = new Set([
  "vid3rb",
  "mp4upload",
  "streamwish",
  "videa",
  "videas",
]);
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npx --yes tsx lib/scraper/embedExtract.test.ts`

Expected: all provider and parser checks pass.

### Task 2: Load MAL Score Before Full Details

**Files:**
- Modify: `lib/animeInfo.test.ts:1-86`
- Modify: `lib/animeInfo.ts:428-472`
- Modify: `app/anime/[id].tsx:130-138`

- [ ] **Step 1: Write the failing lightweight lookup test**

Import `fetchMalPrefix` and add a request-recorder test using the existing One Piece prefix fixture:

```ts
async function testFastPrefix() {
  const prefixUrls: string[] = [];
  const fastPrefix = await fetchMalPrefix("One Piece", async (url) => {
    prefixUrls.push(url);
    return JSON.stringify({ categories: [{ type: "anime", items: [
      { id: 21, name: "One Piece", url: "https://myanimelist.net/anime/21", payload: { score: "8.73" } },
    ] }] });
  });
  assert.equal(fastPrefix?.data.score, 8.73);
  assert.equal(prefixUrls.length, 1);
  assert.match(prefixUrls[0], /search\/prefix\.json/);
}

void testFastPrefix().then(() => console.log("anime info tests passed"));
```

Replace the test file's existing final `console.log` with the invocation above.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx --yes tsx lib/animeInfo.test.ts`

Expected: compilation fails because `fetchMalPrefix` is not exported yet.

- [ ] **Step 3: Extract the prefix lookup and prefer it for score-only requests**

Add a small exported function around the existing prefix loop:

```ts
export async function fetchMalPrefix(
  title: string,
  getText: (url: string) => Promise<string | null> = fetchText,
): Promise<MalPrefixResult | null> {
  const cleaned = cleanQuery(title);
  const queries = [cleaned, title.trim()].filter((q, i, all) => q && all.indexOf(q) === i);
  for (const q of queries) {
    const raw = await getText(`https://myanimelist.net/search/prefix.json?type=anime&keyword=${encodeURIComponent(q)}&v=1`);
    if (!raw) continue;
    try {
      const hit = parseMalPrefix(JSON.parse(raw), title);
      if (hit) return hit;
    } catch {}
  }
  return null;
}
```

Use `fetchMalPrefix(title)` in `fetchMalFallback` instead of its duplicated loop. At the start of `doFetch`, add:

```ts
if (!full) {
  const hit = await fetchMalPrefix(title);
  if (hit) return hit.data;
}
```

Keep Jikan and the existing AniList/MAL-page fallback after this fast path.

- [ ] **Step 4: Stop the detail header from requesting full fields**

In `app/anime/[id].tsx`, change:

```ts
fetchAnimeMal(data.title, true)
```

to:

```ts
fetchAnimeMal(data.title)
```

`InfoTab` already calls `fetchAnimeInfo(data.title)`, which retains `full=true` and fetches complete fields only when that tab mounts.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `npx --yes tsx lib/animeInfo.test.ts`

Expected: `anime info tests passed`.

### Task 3: Verify Without Publishing

**Files:**
- Verify only: `app.json`
- Verify only: `version.json`

- [ ] **Step 1: Run the full suite**

Run: `npm test`

Expected: TypeScript, injected-JavaScript checks, and all assertion suites pass.

- [ ] **Step 2: Check formatting and release files**

Run: `git diff --check`

Expected: no whitespace errors.

Run: `git diff -- app.json version.json`

Expected: no output.

- [ ] **Step 3: Leave the work local**

Do not run `npm run publish-ota`, do not modify version files, and do not commit. Report the files changed and that the app is ready for device testing.

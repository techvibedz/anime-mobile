# Pantoufa Reliability, Catalogue, and Downloads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix provider reliability, make catalogue interactions and ratings fast, add Android system-owned episode downloads, and ship a matching 3.3.0 preview APK/OTA.

**Architecture:** Keep `lib/api.ts` as the public scraper/download boundary and add provider-specific bounded parsing below it. Reuse the existing Jikan cache and search query deep link rather than adding services. Add one local Android Expo module wrapping `DownloadManager`; JavaScript resolves signed URLs and reconciles native jobs while Android owns transfers and notifications.

**Tech Stack:** Expo SDK 54, React Native 0.81, TypeScript 5.9, Expo Modules API/Kotlin, Android `DownloadManager`, Expo Router, Jikan, AniList, `node:assert` tests, EAS Build/Update.

---

## File Map

**Scraper reliability**

- Modify `lib/scraper/direct.ts`: bounded mp4upload fetch/parser; semantic WitAnime probing; shared in-flight resolution; URL rewriting.
- Modify `lib/scraper/index.ts`: rewrite incoming WitAnime detail/episode URLs before WebView jobs.
- Modify `lib/scraper/scripts.ts`: resolve relative episode links from `location.origin`.
- Modify `lib/scraper/embedExtract.test.ts`: characterize inline and packed mp4upload markup.
- Create `lib/scraper/witFailover.test.ts`: test semantic validation and host rewriting.
- Modify `package.json`: include focused tests in the standard test command.

**Catalogue and artwork**

- Modify `components/CatalogCard.tsx`: one MAL hook invocation with AniList fallback.
- Modify `app/anime/[id].tsx`: seed detail rating from the synchronous MAL cache.
- Modify `app/title/[id].tsx`: show MAL on AniList detail and related cards.
- Modify `app/schedule.tsx`: show MAL on schedule anime cards.
- Modify `app/seasons.tsx`: remove source verification and navigate directly to prefilled search.
- Modify `lib/img.ts`: add a larger image bucket used only when requested.
- Modify `lib/img.test.ts`: verify the hero bucket without changing card buckets.
- Modify `app/(tabs)/index.tsx`: request the larger hero rendition.

**Native downloads and release**

- Create `modules/pantoufa-downloads/package.json`: local package metadata.
- Create `modules/pantoufa-downloads/expo-module.config.json`: Android module registration.
- Create `modules/pantoufa-downloads/android/build.gradle`: Expo Android library setup.
- Create `modules/pantoufa-downloads/android/src/main/AndroidManifest.xml`: library manifest.
- Create `modules/pantoufa-downloads/android/src/main/java/expo/modules/pantoufadownloads/PantoufaDownloadsModule.kt`: `DownloadManager` bridge.
- Create `modules/pantoufa-downloads/index.ts`: typed optional native wrapper.
- Create `lib/downloadStatus.ts`: pure native-to-app status mapping.
- Create `lib/downloadStatus.test.ts`: status mapping tests.
- Modify `lib/downloads.ts`: enqueue, persist, poll, reconcile, retry, and delete native jobs.
- Modify `app/_layout.tsx`: reconcile downloads on startup and foreground.
- Modify `package.json` and `package-lock.json`: local module dependency and tests.
- Modify `app.json` and `package.json`: native preview/runtime version 3.3.0 metadata.

Do not modify or revert unrelated user changes in these files. Do not commit unless the user explicitly requests it.

---

### Task 1: Characterize Mp4upload Parsing

**Files:**
- Modify: `lib/scraper/embedExtract.test.ts`

- [ ] **Step 1: Add failing inline and packed mp4upload tests**

Import `extractMp4uploadUrl` from `./direct` and add:

```ts
const MP4UPLOAD = "https://s14.mp4upload.com:282/d/video.mp4?token=abc";

test("mp4upload inline player.src object yields the direct mp4", () => {
  const html = `<script>player.src({type:"video/mp4",src:"${MP4UPLOAD}"});</script>`;
  assert.equal(extractMp4uploadUrl(html), MP4UPLOAD);
});

test("mp4upload packed player.src yields the direct mp4", () => {
  const html = `<script>${pack(`player.src({type:"video/mp4",src:"${MP4UPLOAD}"});`)}</script>`;
  assert.equal(extractMp4uploadUrl(html), MP4UPLOAD);
});

test("mp4upload parser rejects sample files", () => {
  assert.equal(extractMp4uploadUrl('player.src({src:"https://x.mp4upload.com/sample-video.mp4"})'), null);
});
```

- [ ] **Step 2: Run the focused test and verify red**

Run: `npm exec --no -- tsx lib/scraper/embedExtract.test.ts`

Expected: TypeScript/import failure because `extractMp4uploadUrl` is not exported.

- [ ] **Step 3: Add the pure parser**

In `lib/scraper/direct.ts`, after `extractFromPacked`, add:

```ts
export function extractMp4uploadUrl(html: string): string | null {
  const plain = pickMediaUrl(html);
  if (plain && /mp4upload\.com/i.test(plain) && !DECOY_RE.test(plain)) return plain;
  const packed = extractFromPacked(html);
  return packed && /mp4upload\.com/i.test(packed) && !DECOY_RE.test(packed) ? packed : null;
}
```

Keep `DECOY_RE`, `pickMediaUrl`, and `extractFromPacked` as the shared parser implementation; do not duplicate regex sets.

- [ ] **Step 4: Run the focused test and verify green**

Run: `npm exec --no -- tsx lib/scraper/embedExtract.test.ts`

Expected: all tests pass and the process exits 0.

---

### Task 2: Bound Mp4upload Resolution

**Files:**
- Modify: `lib/scraper/direct.ts:1650-1682`
- Modify: `lib/api.ts:1612-1619`

- [ ] **Step 1: Replace nested retries with bounded embed fetches**

Replace `extractMp4upload()` with:

```ts
export async function extractMp4upload(iframeUrl: string): Promise<{ url: string; type: "mp4" } | null> {
  const embedUrl = normalizeEmbedUrl(iframeUrl);
  for (const timeoutMs of [8000, 15000]) {
    const html = await fetchEmbed(embedUrl, timeoutMs, "https://www.mp4upload.com/");
    if (!html) continue;
    const url = extractMp4uploadUrl(html);
    if (url) return { url, type: "mp4" };
  }
  return null;
}
```

Function declarations are hoisted, so the existing later `fetchEmbed()` declaration can be reused without moving code.

- [ ] **Step 2: Log direct misses without changing fallback behavior**

In `resolveVideo()` keep the WebView fallback, but after a null direct result add:

```ts
void remoteLog("warn", "video", "mp4upload direct extraction missed; using WebView", {
  iframeUrl: iframeUrl.slice(0, 200),
});
```

- [ ] **Step 3: Run parser and injected-script checks**

Run:

```powershell
npm exec --no -- tsx lib/scraper/embedExtract.test.ts
node scripts/test-packed-extract.js
node scripts/check-injected-js.js
node scripts/check-wrapped-js.js
```

Expected: every command exits 0; direct failure reaches WebView after at most about 23 seconds rather than nested multi-minute retries.

---

### Task 3: Make WitAnime Failover Semantic and Shared

**Files:**
- Create: `lib/scraper/witFailover.test.ts`
- Modify: `lib/scraper/direct.ts:13-92`

- [ ] **Step 1: Add failing pure-helper tests**

Create `lib/scraper/witFailover.test.ts`:

```ts
import assert from "node:assert";
import { isWitAnimeHtml, rewriteWitUrl } from "./direct";

assert.equal(isWitAnimeHtml('<div class="anime-card-container"></div>'), true);
assert.equal(isWitAnimeHtml('<html><title>Watch Anime Online Free</title></html>'), false);
assert.equal(
  rewriteWitUrl("https://witanime.you/anime/test/?x=1#episodes", "https://witanime.life"),
  "https://witanime.life/anime/test/?x=1#episodes",
);
assert.equal(rewriteWitUrl("https://anime3rb.com/anime/test", "https://witanime.life"), "https://anime3rb.com/anime/test");
console.log("wit failover tests passed");
```

- [ ] **Step 2: Run and verify red**

Run: `npm exec --no -- tsx lib/scraper/witFailover.test.ts`

Expected: import failure for the missing helpers.

- [ ] **Step 3: Implement semantic helpers and remove the incompatible mirror**

In `lib/scraper/direct.ts`:

```ts
import AsyncStorage from "@react-native-async-storage/async-storage";

export const WIT_DOMAINS = [
  "https://witanime.you",
  "https://witanime.life",
];

export function isWitAnimeHtml(html: string): boolean {
  return /anime-card-container|episodes-card-container|lucodeia-slider-slide-item|وايت\s*انمي/i.test(html);
}

export function rewriteWitUrl(raw: string, base: string): string {
  try {
    const url = new URL(raw);
    if (!/(^|\.)witanime\./i.test(url.hostname)) return raw;
    const target = new URL(base);
    url.protocol = target.protocol;
    url.host = target.host;
    return url.toString();
  } catch {
    return raw;
  }
}
```

Make `probeWit()` read the body and accept only semantic hits:

```ts
const res = await fetch(base + "/", { signal: ctrl.signal, headers: { "User-Agent": BROWSER_UA } });
if (!res.ok) return null;
return isWitAnimeHtml(await res.text()) ? base : null;
```

Always clear the timeout in `finally`.

- [ ] **Step 4: Deduplicate concurrent base resolution**

Add `let _witBaseInflight: Promise<string> | null = null;`. Move the existing persisted-base and parallel-probe body into `resolveWitBase()`. Make `getWitBase()` return the cached base, the short failure fallback, or one shared promise:

```ts
export async function getWitBase(): Promise<string> {
  if (_resolvedWitBase) return _resolvedWitBase;
  if (Date.now() < _witFailUntil) return WIT_DOMAINS[0];
  if (_witBaseInflight) return _witBaseInflight;
  _witBaseInflight = resolveWitBase().finally(() => { _witBaseInflight = null; });
  return _witBaseInflight;
}
```

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```powershell
npm exec --no -- tsx lib/scraper/witFailover.test.ts
npx tsc --noEmit
```

Expected: tests pass and the previous missing `AsyncStorage` type error is gone.

---

### Task 4: Rewrite All WitAnime Loads to the Working Mirror

**Files:**
- Modify: `lib/scraper/direct.ts`
- Modify: `lib/scraper/index.ts`
- Modify: `lib/scraper/scripts.ts:214-225`

- [ ] **Step 1: Canonicalize direct fetch inputs**

Before direct-fetching externally supplied WitAnime URLs, resolve the base and rewrite them:

```ts
const base = await getWitBase();
const url = rewriteWitUrl(episodeUrl, base);
const html = await fetchHtml(url, base + "/");
```

Apply this to `fetchWitListingDirect()` and `scrapeWitanimeEpisodePageDirect()` while preserving each caller's original return shape.

- [ ] **Step 2: Canonicalize WebView detail and server jobs**

In `lib/scraper/index.ts`, import `rewriteWitUrl`. For functions receiving an anime/episode URL, compute:

```ts
const base = await getWitBase();
const url = rewriteWitUrl(rawUrl, base);
```

Pass `url` to `enqueue()` for WitAnime jobs. Do not rewrite anime4up or anime3rb URLs.

- [ ] **Step 3: Remove the injected `.you` hardcode**

In `lib/scraper/scripts.ts`, replace:

```js
url = 'https://witanime.you/' + url.replace(/^\//, '');
```

with:

```js
url = location.origin + '/' + url.replace(/^\//, '');
```

- [ ] **Step 4: Run all scraper checks**

Run:

```powershell
npm exec --no -- tsx lib/scraper/witFailover.test.ts
node scripts/check-injected-js.js
node scripts/check-wrapped-js.js
npx tsc --noEmit
```

Expected: all commands exit 0.

---

### Task 5: Complete Fast MAL Coverage

**Files:**
- Modify: `components/CatalogCard.tsx`
- Modify: `app/anime/[id].tsx`
- Modify: `app/title/[id].tsx`
- Modify: `app/schedule.tsx`

- [ ] **Step 1: Remove the duplicate catalogue-card rating hook**

Change `MalCardBadge` to accept an already-resolved score:

```ts
export function MalCardBadge({ title, score, style }: { title?: string | null; score?: number | null; style?: ViewStyle }) {
  const resolved = useMalRating(score === undefined ? title : null);
  const shown = score === undefined ? resolved : score;
  if (shown == null) return null;
  // render fmt(shown)
}
```

Then in `CatalogCard.ScoreCorner` use the one hook result:

```tsx
const mal = useMalRating(title);
if (mal != null) return <MalCardBadge score={mal} />;
```

Keep the existing unlabeled AniList star fallback while MAL is unresolved.

- [ ] **Step 2: Seed the source detail page from memory**

In `app/anime/[id].tsx`, when a new scraped title arrives, call `setMalScore(peekMalRating(data.title) ?? null)` before the asynchronous `fetchAnimeMal(data.title)` update. This uses the existing imported helper and never blocks detail rendering.

- [ ] **Step 3: Add MAL to AniList title details**

Import `MalBadge`, `MalCardBadge`, and `useMalRating` in `app/title/[id].tsx`. Compute `const malScore = useMalRating(title);`. Render `<MalBadge score={malScore} />` before the existing unlabeled AniList score pill, hiding the fallback once MAL exists. Add `<MalCardBadge title={r.title} />` inside each related-anime image plate.

- [ ] **Step 4: Add MAL to schedule cards**

Import `MalCardBadge` in `app/schedule.tsx` and render `<MalCardBadge title={item.title} />` over each poster. Keep the current AniList score visible only until MAL resolves if the card component has room for one score; never show two rating pills simultaneously.

- [ ] **Step 5: Typecheck the rating surfaces**

Run: `npx tsc --noEmit`

Expected: exit 0, with no unused `peekMalRating` import and no `MalCardBadge` prop errors.

---

### Task 6: Make Season Taps Instant

**Files:**
- Modify: `app/seasons.tsx`

- [ ] **Step 1: Delete source verification state and imports**

Remove `filterAvailableItems`, `useOpenSource`, `rawByKey`, `availByKey`, `partial`, `verifyingKey`, and `verify()`. Retain one `itemsByKey` cache populated by `fetchSeasonAnime()`.

- [ ] **Step 2: Load the selected AniList season only**

Use one effect keyed by `key`:

```ts
useEffect(() => {
  if (itemsByKey[key]) return;
  let cancelled = false;
  setLoadingKey(key);
  fetchSeasonAnime(active.season, active.year)
    .then((rows) => { if (!cancelled) setItemsByKey((p) => ({ ...p, [key]: rows })); })
    .catch(() => { if (!cancelled) setError(true); })
    .finally(() => { if (!cancelled) setLoadingKey(null); });
  return () => { cancelled = true; };
}, [active.season, active.year, itemsByKey, key]);
```

- [ ] **Step 3: Navigate directly to prefilled search**

Import `router` from `expo-router` and use:

```ts
const openItem = useCallback((c: CatalogCardData) => {
  router.push(`/(tabs)/search?q=${encodeURIComponent(c.title)}`);
}, []);
```

Pass no loading spinner to `CatalogCard`.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`

Expected: exit 0 and no stale verification imports/state.

---

### Task 7: Increase Only Hero Image Quality

**Files:**
- Modify: `lib/img.test.ts`
- Modify: `lib/img.ts`
- Modify: `app/(tabs)/index.tsx:146-148`

- [ ] **Step 1: Add a failing larger-bucket test**

In `lib/img.test.ts` add:

```ts
test("hero-size requests can reach 1200px", () => {
  assert.match(buildPhotonUrl("https://witanime.you/a.jpg", 1000), /\?w=1200&/);
});
```

- [ ] **Step 2: Run and verify red**

Run: `npm exec --no -- tsx lib/img.test.ts`

Expected: failure because the current maximum bucket is 800.

- [ ] **Step 3: Add the bucket and request it only from the hero**

Change `BUCKETS` to `[180, 240, 320, 420, 560, 800, 1200]`. In the home hero use:

```tsx
source={{ uri: posterUrl(item.image, SW * 1.5) }}
```

The `PixelRatio` cap makes this request the 1200 bucket on normal Android phones; existing card calls remain in their existing buckets.

- [ ] **Step 4: Run image tests**

Run: `npm exec --no -- tsx lib/img.test.ts`

Expected: all image tests pass.

---

### Task 8: Create the Android DownloadManager Module

**Files:**
- Create: `modules/pantoufa-downloads/package.json`
- Create: `modules/pantoufa-downloads/expo-module.config.json`
- Create: `modules/pantoufa-downloads/index.ts`
- Create: `modules/pantoufa-downloads/android/build.gradle`
- Create: `modules/pantoufa-downloads/android/src/main/AndroidManifest.xml`
- Create: `modules/pantoufa-downloads/android/src/main/java/expo/modules/pantoufadownloads/PantoufaDownloadsModule.kt`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Add local package metadata**

`modules/pantoufa-downloads/package.json`:

```json
{
  "name": "pantoufa-downloads",
  "version": "1.0.0",
  "main": "index.ts",
  "peerDependencies": { "expo": "*" }
}
```

`modules/pantoufa-downloads/expo-module.config.json`:

```json
{
  "platforms": ["android"],
  "android": { "modules": ["expo.modules.pantoufadownloads.PantoufaDownloadsModule"] }
}
```

- [ ] **Step 2: Add Android library files**

`android/build.gradle`:

```gradle
plugins {
  id 'com.android.library'
  id 'expo-module-gradle-plugin'
}

group = 'expo.modules.pantoufadownloads'
version = '1.0.0'

android { namespace "expo.modules.pantoufadownloads" }
```

`android/src/main/AndroidManifest.xml`:

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android" />
```

- [ ] **Step 3: Implement the minimal Kotlin bridge**

Implement `PantoufaDownloadsModule.kt` with `Name("PantoufaDownloads")` and three async functions:

```kotlin
AsyncFunction("enqueue") { url: String, headers: Map<String, String>, fileName: String, title: String ->
  require(fileName.matches(Regex("^[A-Za-z0-9._-]+$"))) { "Invalid download filename" }
  val request = DownloadManager.Request(Uri.parse(url))
    .setTitle(title)
    .setMimeType("video/mp4")
    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
    .setAllowedOverMetered(true)
    .setAllowedOverRoaming(false)
    .setDestinationInExternalFilesDir(context, Environment.DIRECTORY_MOVIES, "downloads/$fileName")
  headers.forEach { (key, value) -> request.addRequestHeader(key, value) }
  downloadManager.enqueue(request).toDouble()
}

AsyncFunction("query") { id: Double ->
  downloadManager.query(DownloadManager.Query().setFilterById(id.toLong())).use { cursor ->
    if (!cursor.moveToFirst()) return@AsyncFunction null
    mapOf(
      "id" to id,
      "status" to cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)),
      "reason" to cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON)),
      "bytes" to cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)).toDouble(),
      "totalBytes" to cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)).toDouble(),
      "localUri" to cursor.getString(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI))
    )
  }
}

AsyncFunction("remove") { id: Double -> downloadManager.remove(id.toLong()) }
```

Define `context` from `appContext.reactContext` and `downloadManager` from `Context.DOWNLOAD_SERVICE`. Import `android.app.DownloadManager`, `android.content.Context`, `android.net.Uri`, `android.os.Environment`, `expo.modules.kotlin.exception.Exceptions`, `expo.modules.kotlin.modules.Module`, and `ModuleDefinition`.

- [ ] **Step 4: Add the typed optional JS wrapper**

`modules/pantoufa-downloads/index.ts`:

```ts
import { requireOptionalNativeModule } from "expo-modules-core";

export type NativeDownload = {
  id: number;
  status: number;
  reason: number;
  bytes: number;
  totalBytes: number;
  localUri: string | null;
};

type Module = {
  enqueue(url: string, headers: Record<string, string>, fileName: string, title: string): Promise<number>;
  query(id: number): Promise<NativeDownload | null>;
  remove(id: number): Promise<number>;
};

export default requireOptionalNativeModule<Module>("PantoufaDownloads");
```

- [ ] **Step 5: Install the local package**

Add `"pantoufa-downloads": "file:./modules/pantoufa-downloads"` to dependencies, then run `npm install`.

Expected: lockfile records the local module; no unrelated dependency upgrades.

- [ ] **Step 6: Verify native autolinking in a disposable prebuild output**

Run: `npx expo prebuild --platform android --clean`

Expected: generated Android settings include `pantoufa-downloads`, and Gradle recognizes `PantoufaDownloadsModule`. Do not hand-edit generated `android/` files.

---

### Task 9: Map and Reconcile Native Download Jobs

**Files:**
- Create: `lib/downloadStatus.ts`
- Create: `lib/downloadStatus.test.ts`
- Modify: `lib/downloads.ts`
- Modify: `app/_layout.tsx`

- [ ] **Step 1: Add failing status tests**

`lib/downloadStatus.test.ts`:

```ts
import assert from "node:assert";
import { mapNativeDownload } from "./downloadStatus";

assert.deepEqual(mapNativeDownload({ status: 1, bytes: 0, totalBytes: -1, localUri: null }), { status: "downloading", progress: 0 });
assert.deepEqual(mapNativeDownload({ status: 2, bytes: 50, totalBytes: 100, localUri: null }), { status: "downloading", progress: 0.5 });
assert.deepEqual(mapNativeDownload({ status: 8, bytes: 100, totalBytes: 100, localUri: "file:///x.mp4" }), { status: "completed", progress: 1 });
assert.deepEqual(mapNativeDownload({ status: 16, bytes: 10, totalBytes: 100, localUri: null }), { status: "failed", progress: 0.1 });
console.log("download status tests passed");
```

- [ ] **Step 2: Implement the pure mapping**

`lib/downloadStatus.ts`:

```ts
export type AppDownloadStatus = "downloading" | "completed" | "failed";

export function mapNativeDownload(job: { status: number; bytes: number; totalBytes: number; localUri: string | null }) {
  const progress = job.totalBytes > 0 ? Math.min(1, job.bytes / job.totalBytes) : 0;
  if (job.status === 8 && job.localUri) return { status: "completed" as const, progress: 1 };
  if (job.status === 16) return { status: "failed" as const, progress };
  return { status: "downloading" as const, progress };
}
```

- [ ] **Step 3: Verify the focused test**

Run: `npm exec --no -- tsx lib/downloadStatus.test.ts`

Expected: exit 0.

- [ ] **Step 4: Replace the FileSystem transfer with native enqueue**

In `lib/downloads.ts`:

- import `PantoufaDownloads` and `mapNativeDownload`;
- add `downloadId?: number` and persisted `server?: DownloadMeta["server"]` to `DownloadItem`;
- replace the `active` resumable map with a `Set<string>` that only deduplicates URL resolution/enqueue;
- after `resolveDownloadUrl()`, require the native module, call `enqueue(resolved.url, resolved.headers, `${id}.mp4`, meta.episodeTitle)`, and persist `downloadId`, `server`, and `status: "downloading"`;
- do not persist the expiring resolved URL;
- keep completed legacy FileSystem records readable.

If the native module is unavailable, mark the record failed with no attempt to fake kill-resilient behavior.

- [ ] **Step 5: Add reconciliation and monitoring**

Export `syncDownloads()` that queries every non-completed item carrying `downloadId`, applies `mapNativeDownload`, updates bytes/total/progress/local URI, and persists once when any record changed. For a successful native status, call `FileSystem.getInfoAsync(localUri)` and accept completion only when the file exists and has `size > 0`; otherwise mark failed.

Start one module-level 1-second interval while any native job is pending/running. Stop it when no active jobs remain. `startDownload()` starts monitoring after enqueue; `getDownloads()` performs one reconciliation before returning.

- [ ] **Step 6: Preserve retry and delete behavior**

`retryDownload()` passes the persisted `server` back into `startDownload()` so quality/provider selection survives. `deleteDownload()` calls native `remove(downloadId)` before deleting metadata and deletes `fileUri` when it is a `file://` URI.

- [ ] **Step 7: Reconcile on foreground**

In `app/_layout.tsx`, import `syncDownloads`. Call it once after app readiness and from an `AppState` listener when state becomes `active`:

```ts
useEffect(() => {
  if (!ready) return;
  syncDownloads().catch(() => {});
  const sub = AppState.addEventListener("change", (state) => {
    if (state === "active") syncDownloads().catch(() => {});
  });
  return () => sub.remove();
}, [ready]);
```

- [ ] **Step 8: Run TypeScript and status tests**

Run:

```powershell
npm exec --no -- tsx lib/downloadStatus.test.ts
npx tsc --noEmit
```

Expected: exit 0.

---

### Task 10: Put Focused Tests in the Standard Gate

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Extend `npm test`**

Append these commands to the existing test script:

```json
"&& npx --yes tsx lib/img.test.ts && npx --yes tsx lib/scraper/embedExtract.test.ts && npx --yes tsx lib/scraper/witFailover.test.ts && npx --yes tsx lib/downloadStatus.test.ts"
```

- [ ] **Step 2: Run the complete test gate**

Run: `npm test`

Expected: TypeScript and every listed test/check exit 0.

---

### Task 11: Bump the Native Runtime to 3.3.0

**Files:**
- Modify: `app.json`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Align application metadata**

Set `app.json`, `package.json`, and the lockfile root package version to `3.3.0`. Keep `runtimeVersion.policy` as `appVersion`, which makes the new native binary runtime `3.3.0`.

- [ ] **Step 2: Preserve production APK prompt metadata**

Leave `version.json` at `3.2.0`. This task creates a preview APK, not a hosted GitHub production release; advertising a nonexistent 3.3.0 APK would give production users a broken update prompt.

- [ ] **Step 3: Verify effective Expo config**

Run: `npx expo config --type public`

Expected: version/runtime policy resolves to 3.3.0, Android package remains `com.anime.mobile`, and the local native module is discoverable during prebuild.

---

### Task 12: Final Verification and Preview Release

**Files:**
- Verify all changed files.

- [ ] **Step 1: Review the worktree without reverting unrelated edits**

Run:

```powershell
git status --short
git diff --check
git diff -- app components lib modules package.json package-lock.json app.json version.json docs
```

Expected: only intended changes plus pre-existing user changes; no whitespace errors.

- [ ] **Step 2: Run full local verification**

Run:

```powershell
npm test
npx expo-doctor
node scripts/test-packed-extract.js
npm exec --no -- tsx scripts/test-direct-providers.ts
```

Expected: tests/typecheck pass; Expo Doctor reports no blocking native/config issue; live provider script resolves at least one current provider and exercises mp4upload when a live server is available.

- [ ] **Step 3: Build the matching preview APK**

Run:

```powershell
eas build --platform android --profile preview --non-interactive
```

Expected: successful Android APK build on channel `preview`, app/runtime version 3.3.0. Record the EAS build URL.

- [ ] **Step 4: Perform physical-device acceptance checks**

Install the APK and verify:

- current mp4upload playback resolves without multi-minute direct retries;
- WitAnime works when `.you` or `.life` is unavailable and does not select `.club`;
- visible anime cards/details show cached MAL instantly and uncached ratings stream without blocking;
- a season card immediately opens search with the title and starts results;
- hero artwork is visibly sharp without card bandwidth regression;
- a large episode download continues after Home, recents removal, and `adb shell am kill com.anime.mobile`;
- Android shows progress/completion notification;
- reopening Pantoufa reconciles progress/completion and offline playback works;
- cancel, retry, network interruption, and zero-byte/error responses do not produce false completion.

- [ ] **Step 5: Publish only to the matching preview runtime**

After the 3.3.0 preview APK exists and passes device checks, run:

```powershell
eas update --channel preview --platform android --message "fix: provider reliability, fast ratings, and background downloads" --non-interactive
```

Do not use `npm run publish-ota`; it fans bundles across legacy runtimes.

- [ ] **Step 6: Confirm the published update**

Run:

```powershell
eas branch:view preview --json --non-interactive
eas update:list --branch preview --limit 5 --json --non-interactive
```

Expected: newest preview update targets runtime 3.3.0. Return the preview APK build URL and update ID to the user.

# Source Network Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Do not dispatch subagents.

**Goal:** Make all three source families recover from DNS poisoning, unreachable IPs, SSL failures, and domain outages while preserving TLS, Cloudflare browser state, and the app's backend-free architecture.

**Architecture:** Add one source-domain registry used by both native-fetch and hidden-WebView paths. Harden the existing generated Android DoH resolver with bounded TTL caching and multi-address connection attempts; retry source mirrors in the same WebView slot so the User-Agent and shared Chromium cookie store remain stable.

**Tech Stack:** Expo 54 config plugins, React Native 0.81, TypeScript, react-native-webview, Android Kotlin, OkHttp, AndroidX WebKit, Node assert tests.

---

## File Map

- Create `lib/scraper/sourceDomains.ts`: source recognition, URL rewriting, persisted healthy-mirror preference, semantic response validation, and retry classification.
- Create `lib/scraper/sourceDomains.test.ts`: pure routing, expiry, validation, and classification checks.
- Modify `lib/scraper/direct.ts`: route source fetch attempts through the registry and preserve candidate-specific referers.
- Modify `lib/scraper/bus.ts`: prepare fallback URLs before a WebView job enters the queue.
- Modify `lib/scraper/ScraperHost.tsx`: retry fallback URLs in the same slot and log classified terminal errors.
- Modify `plugins/withAndroidDoH.js`: add DNS TTLs, multiple DoH providers, and all-address tunnel connection attempts.
- Create `plugins/withAndroidDoH.test.js`: verify generated Kotlin contains the native invariants.
- Modify `package.json`: run the two new checks from `npm test`.

### Task 1: Source Domain Registry

**Files:**
- Create: `lib/scraper/sourceDomains.ts`
- Create: `lib/scraper/sourceDomains.test.ts`

- [ ] **Step 1: Write failing routing tests**

Cover these exact behaviors with `node:assert/strict`:

```ts
assert.deepEqual(sourceCandidates("https://witanime.you/anime/x?y=1", null), [
  "https://witanime.you/anime/x?y=1",
  "https://witanime.life/anime/x?y=1",
]);
assert.deepEqual(sourceCandidates("https://w1.anime4up.rest/home8/", "anime4up.rest"), [
  "https://anime4up.rest/home8/",
  "https://w1.anime4up.rest/home8/",
]);
assert.deepEqual(sourceCandidates("https://anime3rb.com/titles/x", "www.anime3rb.com"), [
  "https://www.anime3rb.com/titles/x",
  "https://anime3rb.com/titles/x",
]);
assert.deepEqual(sourceCandidates("https://example.com/x", null), ["https://example.com/x"]);
assert.equal(isValidSourceHtml("witanime", '<div class="anime-card-container">'), true);
assert.equal(isValidSourceHtml("anime4up", "Attention Required | Cloudflare"), false);
assert.equal(classifySourceFailure("net::ERR_CERT_AUTHORITY_INVALID"), "ssl");
assert.equal(classifySourceFailure("net::ERR_NAME_NOT_RESOLVED"), "dns");
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx --yes tsx lib/scraper/sourceDomains.test.ts`

Expected: failure because `sourceDomains.ts` does not exist.

- [ ] **Step 3: Implement the minimal registry**

Define the three source records and pure helpers. Keep candidate rewriting host-only and preserve URL path, query, and fragment. Add async wrappers around `AsyncStorage` using one JSON value per source:

```ts
type SourceId = "witanime" | "anime4up" | "anime3rb";
type Preference = { host: string; expiresAt: number };

const MIRROR_PREFERENCE_MS = 30 * 60 * 1000;
const SOURCES: Record<SourceId, readonly string[]> = {
  witanime: ["witanime.you", "witanime.life"],
  anime4up: ["w1.anime4up.rest", "anime4up.rest"],
  anime3rb: ["anime3rb.com", "www.anime3rb.com"],
};
```

Export:

```ts
identifySource(rawUrl: string): SourceId | null
sourceCandidates(rawUrl: string, preferredHost?: string | null): string[]
rewriteToCandidate(rawUrl: string, candidateUrl: string): string
getSourceCandidates(rawUrl: string): Promise<string[]>
markSourceHealthy(rawUrl: string): Promise<void>
clearSourcePreference(rawUrl: string): Promise<void>
isValidSourceHtml(source: SourceId, html: string): boolean
classifySourceFailure(message: string, statusCode?: number): "dns" | "network" | "timeout" | "ssl" | "http" | "cloudflare" | "invalid-content"
```

Do not log or persist full URLs, cookies, query strings, or headers.

- [ ] **Step 4: Run the focused test**

Run: `npx --yes tsx lib/scraper/sourceDomains.test.ts`

Expected: all assertions pass and the script prints `sourceDomains tests passed`.

### Task 2: Direct Fetch Mirror Strategy

**Files:**
- Modify: `lib/scraper/direct.ts:23-154`
- Test: `lib/scraper/sourceDomains.test.ts`

- [ ] **Step 1: Add failing request-order tests around an exported pure attempt planner**

Assert that three attempts over two candidates produce `[primary, mirror, primary]`, that `404/410` are terminal, and that DNS/SSL/timeout/`403/429/5xx` are retryable.

- [ ] **Step 2: Run the test and confirm the new assertions fail**

Run: `npx --yes tsx lib/scraper/sourceDomains.test.ts`

Expected: failure because the attempt planner/status helper is not implemented.

- [ ] **Step 3: Route `fetchHtml` through source candidates**

At the start of `fetchHtml`, await `getSourceCandidates(url)`. Keep the existing three growing timeouts, but select candidates round-robin so retries do not multiply:

```ts
const candidates = await getSourceCandidates(url);
const attemptUrl = candidates[(attempt - 1) % candidates.length];
const attemptReferer = referer ? rewriteToCandidate(referer, attemptUrl) : undefined;
```

On `res.ok`, read the body once. For recognized sources, reject Cloudflare/invalid-source HTML and continue; otherwise mark the candidate healthy and return it. Return immediately on `404/410`. Clear the saved preference after a qualifying failure. Preserve existing headers and `BROWSER_UA` exactly.

Update `rawGetA3rb` to use the same candidate ordering and candidate-specific referer while retaining its `{ html, status }` contract.

- [ ] **Step 4: Run focused and existing scraper tests**

Run: `npx --yes tsx lib/scraper/sourceDomains.test.ts`

Run: `npx --yes tsx lib/scraper/witFailover.test.ts`

Expected: both pass.

### Task 3: WebView Mirror Retry With Shared Browser State

**Files:**
- Modify: `lib/scraper/bus.ts:7-113`
- Modify: `lib/scraper/ScraperHost.tsx:80-205`
- Test: `lib/scraper/sourceDomains.test.ts`

- [ ] **Step 1: Add failing fallback-order assertions**

Test that source jobs receive all source candidates while provider/non-source jobs receive only their original URL.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npx --yes tsx lib/scraper/sourceDomains.test.ts`

Expected: fallback preparation helper is missing.

- [ ] **Step 3: Prepare candidates once in `enqueue`**

Add `urls: string[]` to `ScrapeJob`. Make `enqueue` async, call `getSourceCandidates(job.url)`, and queue `{ ...job, urls, id }`. This keeps all existing caller signatures Promise-compatible and avoids mirror logic in every scraper function.

- [ ] **Step 4: Retry inside the existing `ScraperSlot`**

Track the current candidate index per job. Use `job.urls[index]` for `WebView.source`. On WebView `onError`, terminal injected-script error, timeout, or retryable non-Cloudflare HTTP failure, advance to the next candidate instead of rejecting when one remains. Reset the timer and early-injection URL for each attempt.

Do not remount into a different slot. Keep these properties unchanged:

```tsx
userAgent={VIDEO_USER_AGENT}
thirdPartyCookiesEnabled
sharedCookiesEnabled
cacheEnabled
incognito={false}
```

Continue allowing `403/429/503` to wait for Chromium's Cloudflare challenge flow; if the attempt eventually times out, then rotate. On success, call `markSourceHealthy(currentUrl)` without awaiting it. On terminal failure, call `remoteLog` with source, hostname, and failure class only.

- [ ] **Step 5: Run TypeScript and injected-script checks**

Run: `npx --yes tsc --noEmit`

Run: `node scripts/check-injected-js.js`

Run: `node scripts/check-wrapped-js.js`

Expected: no new errors. The known unrelated `lib/updater.ts` error may remain only if it is still present in the untouched baseline.

### Task 4: Native DoH TTL And Multi-IP Fallback

**Files:**
- Modify: `plugins/withAndroidDoH.js:35-315`
- Create: `plugins/withAndroidDoH.test.js`

- [ ] **Step 1: Write a failing generated-source test**

Export the two Kotlin source generators as properties on the plugin function for test access. Assert generated source contains:

```js
assert.match(dns, /data class CacheEntry/);
assert.match(dns, /expiresAt/);
assert.match(dns, /1\.1\.1\.1\/dns-query/);
assert.match(dns, /8\.8\.8\.8\/resolve/);
assert.match(proxy, /for \(addr in addresses\)/);
assert.doesNotMatch(dns, /hostnameVerifier|trustAll|X509TrustManager/);
```

- [ ] **Step 2: Run the native-source test and confirm failure**

Run: `node plugins/withAndroidDoH.test.js`

Expected: failure because TTL cache, second provider, multi-IP loop, and generator exports are absent.

- [ ] **Step 3: Add bounded positive TTL caching**

Replace the forever cache with entries containing addresses and expiry. Parse TTL from successful A answers, choose the minimum answer TTL, and clamp it to 30 seconds through 10 minutes:

```kt
private data class CacheEntry(val addresses: List<InetAddress>, val expiresAt: Long)
private val cache = ConcurrentHashMap<String, CacheEntry>()
private fun ttlMillis(seconds: Long): Long = seconds.coerceIn(30L, 600L) * 1000L
```

Expired entries are removed and resolved again. Do not cache empty answers or exceptions.

- [ ] **Step 4: Add a second DoH provider without recursive system DNS**

Try Cloudflare `https://1.1.1.1/dns-query` and Google `https://8.8.8.8/resolve`. Keep HTTPS certificate validation enabled. Parse only A records with valid literal addresses and return all addresses plus TTL.

- [ ] **Step 5: Make the WebView tunnel try every address**

Change `resolve(host)` to return a list. In `handle`, create/connect a socket for each address until one succeeds; close each failed socket. If none connect, close the client and return. The proxy remains bound only to `127.0.0.1` and continues tunneling TLS bytes unchanged.

- [ ] **Step 6: Run the native-source test**

Run: `node plugins/withAndroidDoH.test.js`

Expected: all assertions pass and the script prints `withAndroidDoH tests passed`.

### Task 5: Test Integration And Native Generation Check

**Files:**
- Modify: `package.json:11`

- [ ] **Step 1: Add the focused checks to `npm test`**

Append these commands without removing existing checks:

```json
"npx --yes tsx lib/scraper/sourceDomains.test.ts && node plugins/withAndroidDoH.test.js"
```

- [ ] **Step 2: Run the complete test command**

Run: `npm test`

Expected: all checks pass, except any explicitly confirmed pre-existing `lib/updater.ts` TypeScript error.

- [ ] **Step 3: Generate Android files in the project and inspect the native wiring**

Run: `npx expo prebuild --platform android --no-install`

Verify generated files contain `PantoufaDohOkHttpClientFactory`, `PantoufaDohProxy.start()`, `ProxyController.setProxyOverride`, TTL cache entries, both DoH endpoints, and the multi-address connect loop.

Do not run `eas update`, `eas build`, `eas submit`, `npm run publish-ota`, or any release command. Leave APK generation to the user's requested test step unless the user separately asks to build it.

### Task 6: Final Verification

**Files:**
- Review only the files listed in the File Map.

- [ ] **Step 1: Inspect the diff without altering unrelated work**

Run: `git diff -- lib/scraper/sourceDomains.ts lib/scraper/sourceDomains.test.ts lib/scraper/direct.ts lib/scraper/bus.ts lib/scraper/ScraperHost.tsx plugins/withAndroidDoH.js plugins/withAndroidDoH.test.js package.json docs/superpowers/specs/2026-08-03-source-network-resilience-design.md docs/superpowers/plans/2026-08-03-source-network-resilience.md`

Expected: only source networking, tests, and approved documentation changes. Do not revert or stage unrelated dirty files.

- [ ] **Step 2: Confirm forbidden actions were not performed**

Confirm no OTA publish, EAS build/submission, release commit, TLS bypass, external proxy, or subagent dispatch occurred.

- [ ] **Step 3: Report the local test result and native-build requirement**

State which checks passed, any baseline failure that remains, and that affected-network validation requires installing a newly built APK because native DoH changes are not OTA-deliverable.

# Video Provider Reliability Design

## Goal

Make episode server discovery and media URL resolution faster and more reliable while preserving the current player, server picker, downloads, source coverage, and WebView fallbacks. The server picker must prefer a complete, bounded list over showing the first partial source.

No backend or OTA publishing is part of this work.

## Observed Problems

1. Provider rules are duplicated across the direct scraper, injected WebView script, API, download path, and watch screen. The copies disagree about which providers are supported and which can resolve directly.
2. The current server merge drops providers without a proven direct extractor, even though the live source pages still expose working WebView-capable servers.
3. The watch screen can resolve the same idle server from both its background pre-resolver and active-server effect. Retries are then repeated by the direct extractor, watch screen, and player recovery.
4. Async resolution writes results by array index without tying them to an episode generation. A result from a previous episode can update the next episode after navigation.
5. Anime4up sibling discovery is duplicated across effects. Anime3rb deterministic misses retry for up to two minutes, and stable server-list cache hits trigger unnecessary background scrapes.
6. Current live pages show that static extraction can miss Streamwish, Uqload, and Doodstream even when server discovery succeeds. Static parsing therefore needs a bounded WebView fallback, not removal or repeated identical requests.

## Architecture

### Provider Policy

Add one pure TypeScript provider registry containing:

- canonical provider id and host patterns;
- display/playback rank;
- resolution strategy: direct-only, direct-then-WebView, or WebView-only;
- retry and timeout budgets;
- direct-media validation rules;
- playback headers and content type detection;
- download eligibility;
- canonical server URL normalization.

The registry's host patterns generate the provider classifier embedded in the hidden WebView script. This keeps native and injected classification aligned without maintaining a second handwritten provider table.

Unknown valid hosts remain `generic` and retain WebView playback. Known ad/tracker and malformed hosts remain rejected.

### Media Resolver

Add one resolver boundary used by playback and downloads. It will:

1. Normalize and validate the embed URL.
2. Coalesce concurrent requests for the same provider and embed URL.
3. Run the provider's direct extractor when one exists.
4. Stop retrying when HTML was fetched successfully but parsing deterministically missed.
5. Retry only transport/transient failures within the provider budget.
6. Run one bounded priority-aware WebView fallback when policy permits.
7. Validate the returned media URL before exposing it.
8. Cache successful resolutions briefly to absorb duplicate taps while allowing player recovery to request a fresh token.
9. Return structured failure categories for logging and fallback decisions.

Vid3rb keeps its existing source and CDN validation caches. Token-bearing media URLs are never persisted to AsyncStorage.

### Server Discovery Coordinator

Provide one episode-server operation used by the watch screen and download picker. Given the known episode URL, Anime4up URL, Anime3rb URL/title, and episode number, it will:

- start all applicable source discoveries concurrently;
- use static HTML first and each source's existing bounded WebView fallback;
- await the complete bounded result set with `Promise.allSettled`;
- retain successful source results when another source fails;
- normalize and deduplicate embed URLs while preserving Vid3rb quality fragments;
- sort through the shared provider policy;
- coalesce concurrent identical discovery calls;
- use true TTL cache hits without automatic network revalidation;
- cache only non-empty useful results and never freeze a partial cross-source result as complete;
- bypass caches for explicit refresh.

The existing lower-level source scrapers remain focused on parsing one source. Cross-source orchestration moves out of React effects.

### Watch Screen

Replace overlapping server-loading and enrichment effects with one generation-guarded operation:

- increment a generation whenever the episode changes or a refresh begins;
- ignore every async completion whose generation is no longer current;
- set the complete ordered server list once discovery settles;
- resolve only the selected server, or the top-ranked server during autoplay;
- mark a server as resolving before starting work;
- attempt each failed fallback server serially;
- use forced fresh resolution only for token-expiry/player recovery;
- preserve the picker, WebView player, native player, history, watch party, downloads, and next/previous behavior.

Remove speculative background resolution of four servers. It consumes network/WebView capacity before the user chooses and is the main duplicate-resolution race. Existing Anime3rb neighbouring-episode prefetch remains, but duplicate calls are coalesced by the coordinator.

## Error Handling

- Invalid embed/media URLs fail immediately.
- HTTP 404/410 and successful parse misses are deterministic and are not retried.
- DNS failures, aborts, 429, 403/503 challenge responses, and 5xx responses can retry only within policy budgets.
- A failed source does not erase servers returned by other sources.
- Direct-only providers never open an unsafe embed fallback.
- WebView-capable providers remain selectable when direct extraction fails.
- Explicit refresh clears short negative state and bypasses list caches.
- Logs record provider, stage, duration, attempt count, and failure category without full signed media URLs.

## Performance Constraints

- Identical in-flight discovery or resolution requests execute once.
- Cache hits perform no source-network request until expiry or explicit refresh.
- Independent source discovery is concurrent; provider fallback within one selected server is sequential.
- No retry layer may wrap another retry layer. The resolver owns media retries; source scrapers own source-fetch retries.
- WebView priority capacity remains reserved for user-selected media extraction.

## Testing

Add runnable tests that first fail against current behavior and cover:

- shared provider classification, ranking, fallback mode, and media validation;
- preservation of WebView-only and generic servers;
- canonical URL deduplication without collapsing Vid3rb qualities;
- in-flight request coalescing and short success caching;
- deterministic parse misses not retrying;
- transient failures respecting retry limits;
- stale episode generations being ignored;
- direct failure falling back once to WebView when allowed;
- current packed/static parser fixtures and injected-script syntax.

Run the full `npm test` suite and the network-dependent direct-provider diagnostic. The live diagnostic may report provider-side extraction misses, but it must still prove server discovery, bounded completion, and fallback availability. No OTA command will be run.

## Out of Scope

- Adding a backend, proxy, or server URL.
- Replacing Expo Video or React Native WebView.
- Removing providers solely because they are currently flaky.
- UI redesign or changing the server-selection flow.
- Persisting signed media URLs.
- Publishing an OTA or release build.

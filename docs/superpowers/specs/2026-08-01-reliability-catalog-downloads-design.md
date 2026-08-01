# Pantoufa Reliability, Catalogue, and Downloads Design

Date: 2026-08-01
Status: Approved

## Goal

Improve playback reliability and catalogue responsiveness, show MyAnimeList ratings throughout anime surfaces, make season-card taps instant, improve home hero artwork, and provide Android downloads that continue after Pantoufa's process closes with system progress notifications.

## Scope

- Mp4upload direct video extraction and WebView fallback.
- WitAnime mirror selection and URL failover.
- MAL rating badges on anime detail pages and anime poster cards.
- Season catalogue navigation to prefilled search.
- Android-native episode downloads through `DownloadManager`.
- Higher-resolution home hero artwork.
- Preview APK and matching preview OTA release.

Episode cards are not anime catalogue cards and do not receive MAL badges. Existing unrelated working-tree changes remain untouched.

## Architecture

### Mp4upload

`resolveVideo()` remains the single public resolution path. `extractMp4upload()` performs a bounded provider-specific fetch, extracts current inline `player.src` markup, and also unpacks legacy Dean-Edwards scripts using the parser already present in `direct.ts`. Only a genuine direct miss falls through to the existing hidden WebView.

The direct stage must not call the general three-attempt `fetchHtml()` loop from inside another retry loop. A failed provider fetch must reach fallback within seconds rather than minutes. The existing 40-second WebView timeout is not increased.

### WitAnime Failover

Known compatible Arabic mirrors are probed in parallel. A mirror is accepted only when the response is successful and contains WitAnime-specific page markers. Concurrent callers share one in-flight probe. The working base is cached for the session and persisted for future cold starts, but a total failure is cached only briefly so transient network failures recover.

Before loading a WitAnime URL through direct fetch or WebView, its host is rewritten to the selected mirror while preserving path, query, and fragment. Relative URLs extracted inside the WebView use `location.origin`; no extractor hardcodes `.you`.

Warnings are emitted once per bounded failure window and contain the mirrors tried. An HTTP-200 page from an unrelated site must never count as success.

### MAL Ratings

The existing Jikan-backed rating service remains the source of MyAnimeList scores. It keeps its in-memory/in-flight deduplication, three-request concurrency limit, and seven-day disk cache.

Anime detail pages seed from the synchronous memory cache and fetch without blocking page content. Anime poster cards render cached MAL scores immediately. Catalogue cards with an AniList score display that score while MAL is unresolved, then replace it with MAL when available. Cards without a fallback render normally and gain the badge when the background lookup completes.

Each card performs one rating hook call. No screen waits for ratings before rendering, navigating, or becoming interactive.

### Season Navigation

The seasons screen loads the cached AniList catalogue and does not verify every title against scraper sources. Pressing any anime card immediately navigates to `/(tabs)/search?q=<title>`. The existing search deep-link effect pre-fills the field and runs progressive source search.

This removes the 12-second availability verification and per-tap source resolution from the seasons route.

### Background Downloads

A local Android Expo module wraps the platform `DownloadManager`. JavaScript resolves a progressive MP4 URL and required provider headers while Pantoufa is active, then enqueues the transfer natively. Android owns network transfer, retries, and the system progress/completion notification after enqueue.

The native module exposes the minimum surface:

- enqueue URL, headers, destination name, and title; return the Android download ID;
- query status, downloaded bytes, total bytes, and local URI;
- remove/cancel a download.

`lib/downloads.ts` persists the Android ID and selected provider metadata, polls native status while the app is active, and reconciles all records on startup/resume. Completed status is accepted only for an existing non-empty file. Failed or cancelled native jobs become failed records that can be retried with a freshly resolved signed URL.

Android Force Stop remains an operating-system boundary: no app service can continue after the user explicitly force-stops the package. Normal backgrounding, recents removal, and process reclamation are supported by `DownloadManager`.

### Hero Artwork

The scraper continues storing canonical full-resolution WordPress URLs. Only the home hero requests a larger Photon width bucket than poster cards. Card bandwidth and cache behavior remain unchanged.

## Error Handling

- Mp4upload reports direct misses separately from final WebView failure in remote logs.
- WitAnime ignores incompatible HTTP-200 mirrors and retries after the short failure window.
- MAL failures never block content and empty transient results are not persisted.
- Season search navigation is synchronous; source failures are handled by the search screen's existing empty/error state.
- Download enqueue failures remain retryable. Native failed, paused, pending, running, successful, and missing-job states are mapped explicitly.
- HTTP error bodies or zero-byte files never become completed downloads.

## Verification

- TypeScript compile and existing test suite.
- Injected JavaScript syntax checks and packed mp4upload extraction tests.
- New focused tests for packed/current mp4upload parsing, WitAnime semantic mirror validation/URL rewriting, and download status mapping.
- Real provider checks for a current mp4upload embed and active WitAnime mirrors.
- Physical Android preview testing: foreground, Home, screen off, recents removal, process kill, network interruption, retry, cancel, completion notification, and offline playback.
- Verify season taps immediately open a prefilled active search.
- Verify cached ratings paint immediately and uncached ratings do not delay cards/details.
- Verify hero requests the larger rendition and retains raw-image fallback.

## Release

The native downloader requires a new binary. Bump app/runtime version from `3.2.0` to `3.3.0`, build the Android `preview` APK, install and test it, then publish the verified JavaScript bundle only to the matching `preview` channel/runtime. Do not fan native-dependent JavaScript out to legacy runtimes.

## Out of Scope

- iOS background downloads.
- Custom WorkManager/foreground-service download engine.
- HLS playlist downloads.
- Pause/resume controls in the Pantoufa UI.
- Changes to unrelated local edits or release channels other than preview.

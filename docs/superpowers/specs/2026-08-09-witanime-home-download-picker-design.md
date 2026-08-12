# Witanime-Only Home and Download Picker Reliability

Date: 2026-08-09
Status: Approved design

## Goal

Keep Home exclusively sourced from Witanime while retaining Witanime, Anime4up,
and Anime3rb everywhere else. Make the episode download picker return usable
servers promptly instead of waiting on the full playback-validation pipeline.

## Home

`fetchHomeFresh()` uses Witanime's direct scraper first and its WebView scraper
second. A successful Witanime payload is cached and may be shown stale while a
background Witanime refresh runs.

Anime4up, Anime3rb, and the crowdsourced cloud feed must never replace Home.
When no cached Witanime payload exists and both live Witanime paths fail, Home
returns an empty payload for the existing UI state. Other application surfaces
continue using all three sources.

## Downloads

`listDownloadServers()` discovers raw downloadable candidates without resolving
and probing every video URL. Anime3rb and the episode's primary/Anime4up server
lists are collected concurrently, merged with existing provider rules, and
returned in preferred order. Only progressive-download providers are shown.

The picker has a bounded wait. A timeout or empty result displays the existing
failure message with a retry action instead of showing an indefinite spinner.
Choosing a candidate starts the existing background-download flow. The chosen
server is resolved first; its existing automatic fallback remains available if
that provider fails.

## Error Handling

- Witanime Home failures do not trigger another source.
- Download source failures are isolated so one source can still populate the picker.
- Late picker responses are ignored after close or retry.
- Repeated download requests remain protected by the existing idempotency logic.

## Verification

- Replace the Home fallback regression test with Witanime-only selection coverage.
- Add a focused test for prompt candidate filtering/order where practical.
- Run `npm test`, including TypeScript and injected-script checks.
- Publish the verified JavaScript update only to the `preview` branch for app
  runtime `3.3.1`; no native build or app-version bump is required.

## Out of Scope

- Removing Anime4up or Anime3rb from search, details, playback, or downloads.
- HLS/offline playlist support, pause/resume UI, or a new native downloader.
- Changes to unrelated existing worktree edits.

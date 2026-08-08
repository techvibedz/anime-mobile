# Mp4upload Direct Playback And Fast MAL Scores

## Goal

Restore mp4upload as a visible direct-player provider and make MAL ratings appear quickly, without publishing an OTA update or changing release versions.

This approved follow-up supersedes the mp4upload visibility decision in `2026-08-02-direct-servers-mal-details-design.md` after successful app testing of the other playback repairs.

## Mp4upload

- Add `mp4upload` to the shared visible direct-provider allowlist.
- Add `mp4upload` to the player direct-only set so it never falls back to the ad-filled embed page.
- Keep the existing static HTML extractor, hidden WebView extraction fallback, canonical mp4upload Referer, retries, and native progressive playback.
- If both direct extraction paths fail, mark the provider failed and continue to another server.

## MAL Loading

- Anime detail headers request lightweight score data, not full MAL information.
- Score-only lookups try MAL's fast public prefix response before slower Jikan and full-page fallbacks.
- Full MAL fields are fetched only when the Info tab opens.
- Existing memory and AsyncStorage caches continue to make repeat views immediate.

## Verification

- Add a regression check that `mp4upload` is an approved direct provider.
- Add a regression check for score-first lookup ordering using injected request functions rather than live network timing.
- Run focused tests and the full `npm test` command.
- Confirm `app.json` and `version.json` are unchanged and do not publish OTA.

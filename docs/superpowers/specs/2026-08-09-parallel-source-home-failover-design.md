# Parallel Source Home Failover Design

## Goal

Let a reachable Anime4up or Anime3rb source populate the home screen promptly when WitAnime is blocked or slow, using an OTA-safe TypeScript change only.

## Design

- Start the direct WitAnime, Anime4up, and Anime3rb home requests together.
- Preserve WitAnime as the preferred payload when it succeeds promptly.
- Use Anime4up or Anime3rb content as soon as WitAnime is empty or unavailable.
- Normalize every source into the existing `featured`, `animes`, and `episodes`
  home model before it reaches the UI.
- Parse Anime4up's episode hero slides into both the hero carousel and recent
  episode cards; keep its anime cards available for trending, TV, and movie
  sections. Anime3rb already supplies all three home collections.
- Omit a section only when the selected source genuinely has no valid items;
  never fabricate malformed cards or pass anime cards into an episode rail.
- Run each source's existing WebView fallback only when that source's direct request is empty.
- Preserve the local cache and authenticated Supabase home-feed fallback when every live source is empty.
- Keep the operation bounded by the home screen's existing cold-start deadline; no source waits for another source to time out before starting.

## Constraints

- No native Android or iOS changes.
- No new dependency, backend, proxy, permission, or APK build.
- No video-provider or playback changes.
- Existing source-domain rotation, DoH, retries, validation, and Cloudflare handling remain unchanged.

## Verification

- Add a focused test proving a reachable secondary source is not delayed by a blocked primary source.
- Add parser/normalization checks proving Anime4up and Anime3rb fallback payloads
  contain UI-safe hero, anime, and recent-episode shapes.
- Run TypeScript checking, scraper checks, source-domain tests, and the full existing test command.
- Confirm the final diff contains only OTA-deliverable JavaScript/TypeScript and tests.

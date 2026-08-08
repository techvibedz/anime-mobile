# Anime4up Server Validation Fix

## Problem

Anime4up episode responses contain valid `#episode-servers` markup, but Cloudflare appends a `challenge-platform` telemetry script. The shared source validator treats that script as proof that the whole response is a challenge page, rejects the usable HTML, and forces a WebView fallback that misses the server-discovery deadline.

## Design

Keep source-specific content markers authoritative. A response is valid when it contains the expected source marker, even if it also contains Cloudflare telemetry. A response with Cloudflare challenge markers and no source content remains invalid.

Change only the shared HTML validation condition and add one regression case covering a valid Anime4up server list followed by the Cloudflare script. Existing challenge-page coverage remains the safety check for real blocks.

## Verification

Run the focused source-domain test first, then TypeScript and the existing injected-script checks. Do not publish an OTA update; runtime verification remains for Expo Go.

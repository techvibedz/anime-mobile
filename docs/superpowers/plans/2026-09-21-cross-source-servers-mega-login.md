# Cross-source servers, native MEGA and login — root causes and fixes (2026-09-21)

Shipped in mobile **3.4.2** (APK) + OTA, desktop **0.7.8/0.7.9**.

Every item below was reproduced against the live sites (or the live Supabase
project) before it was changed, and re-verified after.

## 1. Witanime servers only appeared when the episode was opened from Witanime

Three independent causes, all in the cross-source lookup
(`lib/witanimeMatch.ts` + `fetchCompleteVideoServers` in `lib/api.ts`):

| Cause | Evidence | Fix |
| --- | --- | --- |
| The title handed over by anime4up/anime3rb is mixed script (`"ون بيس One Piece"`). The symmetric score against the site's card (`"One Piece"`) is **0.615**, below the 0.8 accept bar, so no card ever matched. | live run: `rank()` printed `0.615 One Piece → /anime/one-piece`, `resolveWitanimeEpisode → NULL` | score the **Arabic-only / Latin-only halves** of a title as their own variants (`witTitleVariants`); a card whose season matches *any* known spelling is accepted |
| The lookup fired four `/search` queries in parallel. The site answers **HTTP 429** to that burst, and `fetchHtml`'s 0.6s×attempt backoff retried inside the same window, so *all four* queries failed. | live: five consecutive searches → `429 193ms len=4086` each | one serialized search queue with a 350 ms gap and a shared cooldown that honours `Retry-After`; 429/503 now back off 1.2s×attempt in `fetchHtml` |
| Witanime prints season numerals as **Unicode roman characters** (`"Mushoku Tensei Ⅲ"`, U+2162) while lookups say `III` → the season filter rejected every candidate. | card title read as season 1 against a season-3 lookup | fold U+2160–U+217F to ASCII before season matching (`tm_asciiRomans`) |

Extra hardening: the resolved anime page is remembered per title
(`@wit_anime_v1:`, 24 h) so every later episode of that anime skips the
rate-limited search, and a stale remembered page falls back to a fresh search.

Verification: `lib/witanimeMatch.test.ts`, `scripts/check-server-discovery.cjs`
(also asserts the mobile/desktop shared modules are byte-identical), plus a live
run where `"ون بيس One Piece"` ep 1179 now resolves to
`https://witanime.site/watch/one-piece/1179` in ~1.4 s (previously NULL).

## 2. MEGA never played in the native player

The Android DoH resolver resolved **every** hostname over HTTPS DNS first, and
`1.1.1.1`/`8.8.8.8` answer **NXDOMAIN (Status 3)** for `127.0.0.1` — verified with
a raw DoH query. The native MEGA decrypter serves playback from
`http://127.0.0.1:PORT/mega/<token>.mp4`, so every request to it paid two dead
DoH round-trips (up to 5 s each on a network that blocks 1.1.1.1) before the
system resolver was tried — which blew the 8 s availability probe and stalled
ExoPlayer.

Fix (`plugins/withAndroidDoH.js`): literal IPv4/IPv6 addresses and `localhost`
short-circuit straight to the OS resolver, in the OkHttp client and the WebView
proxy alike. Guarded by `plugins/withAndroidDoH.test.js` (the short-circuit must
run before any DoH call). Native change → new APK required.

## 3. mp4upload felt slow to appear

A single 6–8 s embed GET was the only direct attempt; a transient miss fell
through to the WebView fallback (up to 40 s). Two bounded attempts are restored
(`6s`, then `12s`) while a Cloudflare challenge still bails immediately — it
cannot clear on an immediate retry. The CDN also returns **HTTP 403 without the
app's Referer/UA headers** (measured: 206 with them, 403 without), which the
player already sends.

## 4. Login failed

`GET /auth/v1/settings` on the project returns `"mailer_autoconfirm": false`:
password sign-in is rejected with `email_not_confirmed` until the address is
confirmed, and the app showed that raw English string with no way out.

Fixes: GoTrue failures are mapped to translatable reasons (`lib/authErrors.ts`);
the login screen offers "resend the confirmation link" and "send me a one-time
sign-in link" for exactly that case; sign-up now sends the confirmation link back
into the app (`emailRedirectTo`) instead of the project Site URL, and detects the
already-registered case Supabase reports as a fake success. The real reason is
recorded in `device_logs` for diagnosis.

Operator follow-up (needs dashboard access, cannot be done from code): either
turn **Confirm email** off in Authentication → Providers → Email, or setup custom
SMTP — the default mailer is rate-limited to a few messages per hour.

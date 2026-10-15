# Source network recovery — 10 October 2026

## Scope and behavior

This update fixes shared JavaScript request and browser paths for WitAnime,
Anime4up, Anime3rb, Manga Al-Asq, Mangalik, and Mangawy. It keeps the existing
on-device encrypted DNS, source registry, cookies, and TLS validation.

- Direct HTML and WitAnime session requests keep their abort timer active until
  the response body finishes. A stalled body cannot hold subsequent work forever.
- Short Anime4up requests try both configured hosts with a bounded retry budget.
  Missing pages (404/410) still stop without probing other hosts.
- Challenge pages that mention the source hostname no longer count as healthy
  source content. Browser extraction rejects unresolved verification and missing
  content instead of returning an error page as a successful scrape.
- All catalog browsers, including Anime3rb, retain the actual WebView identity
  for verification. A killed Android renderer is replaced for subsequent jobs.
- Priority source discovery keeps its reserved slot without cancelling unrelated
  manga/home requests. The selected playback collector can still cancel background
  work to start playback promptly.
- Mangawy JSON APIs can recover through browser verification; JSON is extracted
  from Chromium's `pre` element as text without HTML/entity corruption.
- Manga browsing allows the direct/browser recovery time to finish and does not
  cache an empty failed result for ten minutes after a network switch.
- The anime home starts secondary source fallbacks concurrently, prefers a prompt
  WitAnime response, and restores the existing authenticated shared-feed fallback.
  A shared feed upgrades through the existing callback when live data recovers.

## Verification

- `npm test` passed on the current SDK 57 dependency stack.
- `npm test` also passed on the separate SDK 54 release dependency stack,
  including TypeScript, the actual Android Babel transforms, fonts loaded from
  OTA assets, manga reader checks, and every networking/player regression check.
- `scripts/check-source-network.cjs` exercises network failures, stalled bodies,
  alternate hosts, real 404s, invalid content, Cloudflare rejection, manga JSON
  recovery, request deduplication, renderer recovery, empty-cache recovery, and
  primary/secondary/cloud home selection. It is included in `npm test`.
- Scraper queue tests verify that source discovery preserves another source's
  in-flight work while playback still interrupts background jobs.
- Live desktop requests loaded all six catalogs. Anime4up exposed 13 episode
  servers. All three manga sources loaded a series, chapter, and original page
  image (HTTP 200). Asq and Mangalik searches returned results.
- WitAnime's direct desktop server extraction returned no usable servers: the
  session-bound browser path remains necessary. Its browser protocol is covered
  by the existing server-discovery tests. No Android device was connected.

## OTA compatibility

SDK 57 production builds 3.4.3–4.0.0 use matching dependencies. SDK 54 builds
require a separate SDK 54 bundle; the SDK 57 Hermes bundle must not be reused for
them. The existing release worktree preserves its dependency lock and native
configuration. Its JSX compilation uses React for inline styles while retaining
the SDK 54 Reanimated plugin and explicit NativeWind opt-ins.

## Limits

An OTA can improve retry, verification, source selection, and cached metadata.
It cannot guarantee reachability when a carrier blocks the source IP/TLS route,
when a source is offline, or when the device has no Internet connection. A shared
home feed supplies metadata; it does not relay video or manga page bytes. There
is no new external content relay, certificate bypass, or native dependency.

## Production Android OTA publications

| Runtime | Expo stack | Update group |
| --- | --- | --- |
| 4.0.0 | SDK 57 | `5acde541-1504-4919-a065-26d2a219ce12` |
| 3.4.6 | SDK 57 | `84a966bd-da28-4180-8fbf-4b979d5ee2b3` |
| 3.4.5 | SDK 57 | `d617e0e7-a7f6-4e1d-a80d-421888f948f5` |
| 3.4.4 | SDK 57 | `6a2cdb50-c10b-4a14-be8b-91562269d0df` |
| 3.4.3 | SDK 57 | `ac3736cf-5fa9-4ea6-a365-4801a09f00a8` |
| 3.4.2 | SDK 54 | `b0581161-17ab-4852-ba76-5ee13cf8774e` |

The production update endpoint was checked with each runtime's Android install
headers. All six returned HTTP 200 with the exact published update ID and correct
Expo SDK. Versions before 3.4.2 and preview/iOS installs are outside this rollout.

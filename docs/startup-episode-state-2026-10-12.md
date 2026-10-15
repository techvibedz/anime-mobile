# Startup and episode-state fixes — 12 October 2026

## Behavior

- Home anime/episode/recommendation rails use horizontal FlatLists with three
  initial cards and three cards per batch. Speculative recommendation detail
  scrapes are removed. Cloud hydration and episode reporting are deferred, and
  cache housekeeping reads twenty entries at a time with a yield between batches.
- Detail pages refresh on navigation focus, app resume and every minute while
  focused. Manual refresh requests live primary and secondary episode lists.
  Anime4up and Anime3rb cached enrichment pushes fresh results to the open screen,
  with shared requests and guards against results from a blurred page. Empty
  scrapes preserve cached playable episodes.
- Stored completion hrefs/titles are normalized before matching. Source aliases
  and rotated domains reuse the same anime records, including legacy duplicates.
  Every matching record updates, and duplicate completed records count once.
- Caught-up saves immediately from local watch evidence. A bounded, deduplicated
  airing lookup can upgrade that exact record to finished, even after navigation;
  unmarks and newer episodes invalidate its response. Older episode payloads
  cannot re-mark a newer, unwatched episode.
- The provider follows history changes independently of Home/detail. It preserves
  durable marks when the finale has aged out of bounded history, while clearing
  explicit unmarks and newly available episodes. Foreground detection runs from
  any screen at five-minute intervals and requests a live recent feed.
- Initial history/completion reads share their pending load. Completion writes
  are ordered and retry after pruning recoverable cache on a full storage DB.

## Verification

- `scripts/check-episode-refresh.cjs` runs the actual API and detail hooks against
  deterministic cache, cloud, source and lifecycle adapters. It covers all source
  refreshes, concurrent subscribers, manual refresh, empty/offline results, focus,
  resume, polling, obsolete callbacks and bounded startup card work.
- `scripts/check-watch-state.cjs` runs the actual history, completion provider and
  persistence code. It covers raw legacy records, source/title/domain aliases,
  new episodes with and without tracked history, late older detail results,
  delayed airing responses, explicit unmarks outside Home/detail, eviction,
  completed-count deduplication, full-storage recovery and bounded maintenance.
- Both full `npm test` suites passed on SDK 57 and the separate SDK 54 release
  dependencies, including TypeScript and Android Babel/UI/font checks. The final
  changes also passed the focused checks and TypeScript on both stacks.
- Read-only live schema queries succeeded for both history/completion tables;
  anonymous requests returned no user rows. No database write was performed.

## Delivery and limits

This is JavaScript-only; no native dependencies, versions, database schema or
access rules changed. Production Android SDK 57 runtimes 4.0.0 and 3.4.3–3.4.6
receive one compatible bundle; runtime 3.4.2 receives a separate SDK 54 bundle.
Older runtimes and preview/iOS are outside this rollout, matching the prior release.

No Android device was connected. Device startup timing, native interactions and
video playback are not hardware-verified. Live episode discovery still depends
on source reachability; "finished" requires confirmation from the airing service.
New releases may take up to a minute on an open detail page or five minutes in
other foreground screens to be detected, plus source response time.

## Published production Android OTA

| Runtime | SDK | Update group |
| --- | --- | --- |
| 4.0.0 | 57 | `aa2f6a17-3285-4ab5-9450-dc0fbf9279a9` |
| 3.4.6 | 57 | `f821fdf7-1d29-4392-b3a0-9b1f9c254064` |
| 3.4.5 | 57 | `1af74624-d358-4da1-b805-39d73b2d5c30` |
| 3.4.4 | 57 | `b8830625-05fd-48f1-a8dd-8db412bf9b76` |
| 3.4.3 | 57 | `c7025bce-a92f-4736-a543-03d627a43aab` |
| 3.4.2 | 54 | `7f69ae9d-b07c-40aa-b842-6c7abbad5a38` |

The production update endpoint returned HTTP 200 for all six installed-runtime
Android requests using Expo's multipart protocol. Each manifest matched its
published update ID, runtime and SDK. All five SDK 57 runtimes share the same
tested bundle hash; SDK 54 receives its separate compiled bundle.

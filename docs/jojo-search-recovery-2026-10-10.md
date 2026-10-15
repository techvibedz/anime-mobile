# Missing anime parts: multi-source search recovery

The search result list could show only Anime3rb while hiding reachable entries
from WitAnime and Anime4up. This explains the reported missing JoJo parts.

## Causes and changes

- A three-second orchestration timeout discarded a slower source's successful
  response, including its built-in browser verification. Each source now streams
  independently within a 60-second discovery budget.
- Browser recovery was conditional on the entire result list being empty. An
  Anime3rb hit disabled recovery for failed siblings. Anime4up search now uses
  the existing direct/browser HTML path regardless of another source's results;
  WitAnime retains its existing session-aware search/browser path.
- Anime3rb search used playback's one-title lookup. It now hydrates matching
  catalog entries with three concurrent requests, preserving franchise parts.
  Search uses the same complete-text/word query plan as the other sources. Exact
  franchise matches exclude unrelated fuzzy guesses. A source page is bounded
  to 40 candidates; playback's conservative one-title matching is unchanged.
- Title-only de-duplication discarded alternate source links. Search now
  de-duplicates URLs and labels each source on the result card, so users can
  open an alternate source even when another copy has the same title.
- Cached partial results previously returned immediately while revalidation
  updated only storage. Cached results now paint immediately, stream newly found
  entries into the active screen, and preserve earlier entries through outages.
  The search cache namespace changed from v3 to v4.
- Failed sources produce an explicit retry notice instead of silently presenting
  a partial list as complete. Editing, clearing, or selecting a genre invalidates
  obsolete searches/debounce callbacks.

## Verification

- `node scripts/check-anime-search.cjs --baseline` fails against the original
  committed orchestration: only Anime3rb survives when sibling sources take
  longer than the original timeout.
- `node scripts/check-anime-search.cjs` passes against the shipped implementation:
  slow siblings, independently verified Anime4up results, all 12 fixture JoJo
  entries, exact-family filtering, cross-language word queries, URL de-duplication,
  cache refresh, source outages, shared concurrent searches, late completions,
  and real search-screen callback races.
- Full `npm test` passed on both SDK 57 and SDK 54. TypeScript and Android UI
  checks also passed after the final screen adjustment.
- `node scripts/check-anime-search.cjs --live` executes the actual mobile search
  orchestration against public sources: WitAnime 7, Anime4up 10, Anime3rb 12;
  no incomplete sources in that run. These are source entries, including
  alternate copies and specials, not 29 unique JoJo seasons.
- Stone Ocean Part 2 opens with 12 episodes and Part 3 with 14 episodes on both
  Anime4up and Anime3rb. Their first listed episodes expose 11 Anime4up servers
  and 3 Anime3rb server choices. Live verification checks discovery and server
  extraction, not video decoding/playback on a phone.

## Scope and limits

No native API, dependency, TLS setting, backend, or database changed. No report
was modified and no message was sent to the reporter. No Android device was
connected, so execution on the reporter's device/network and actual native playback remain
unverified. Source outages and carrier blocking can still prevent a source from
responding; successful siblings and previously found entries remain available.

## Reporter evidence and follow-up

Read the actual report and device logs by the reporter's user ID using the
existing authenticated Supabase CLI session. No database, access policy or
report was changed; server credentials stayed in process memory.

- The attached screenshot shows the literal query `jojo`, three results and no
  source labels. The report says “لا أجد بقية أجزاء جوجو” (cannot find the remaining
  JoJo parts). It was submitted at 19:23:42 UTC on October 10, before the first
  JoJo OTA at 19:39:35 UTC. Native app version: 4.0.0; Samsung SM-M135FU,
  Android API 34.
- Seven retained logs belong to that user ID. One shows a WitAnime browser
  timeout at 15:31:38 UTC. A newer Anime3rb browser error at 19:47:04 UTC says
  `source content did not finish verification`. The older OK.ru extraction
  failures and a cancelled Share4max warmup are playback events, not evidence
  about the missing search entries.
- The old logs have no active OTA ID, search query or per-source result counts.
  Native version alone cannot establish whether the newer error occurred while
  running the published JoJo fix. Its missing email also explains why querying
  only the email returned six logs instead of seven.
- Code inspection found a separate timing defect: the HTML extractor stopped
  after 20 seconds although anime browser jobs allow 25 seconds and manga jobs
  allow 28. It now uses 24/27 seconds respectively, retaining the hard request
  deadline and rejecting unfinished verification. The actual log does not
  establish that its particular page would have finished in that extra time.
- Search completion logs now record query, source counts, incomplete sources,
  cached count and elapsed time. All existing device logs carry the active OTA
  ID, runtime and embedded/OTA launch state. Browser failures record the page
  path and last observed main-frame HTTP error, and distinguish a persistent
  challenge from a content timeout.
- Added checks reproduce a page completing at 22 seconds: it fails the former
  20-second extractor but succeeds within the existing 25-second job. Tests also
  assert search diagnostics, native/OTA version separation and preservation of
  HTTP 403 during a later failure.
- A fresh live `jojo` run again returned WitAnime 7, Anime4up 10, Anime3rb 12 and
  opened both Stone Ocean batches' episode/server lists. A separate earlier
  probe received transient Anime3rb HTTP 429; third-party availability remains
  outside the app's control.

## Production Android OTA

SDK 57 versions 3.4.3–3.4.6 and 4.0.0 receive the SDK 57 export. Version 3.4.2
receives a separately tested SDK 54 export from the existing release worktree.
All publications below completed successfully on the production Android branch.

| Runtime | Expo SDK | Update group |
| --- | --- | --- |
| 4.0.0 | 57 | `7e014b30-3023-4976-87a2-ce948e8f3cfb` |
| 3.4.6 | 57 | `02f4c106-a576-4c4d-9316-9d8aa681c7be` |
| 3.4.5 | 57 | `1c138da2-2b60-4c9b-9d75-02ba01a1593f` |
| 3.4.4 | 57 | `fde04b21-4d14-471e-b608-50a90415d1df` |
| 3.4.3 | 57 | `5701e7ab-1231-4e41-87b6-2929cf0f1151` |
| 3.4.2 | 54 | `447198a1-555f-4391-b4c0-67ea91254d23` |

Expo's production update endpoint returned HTTP 200 and the exact new update ID,
runtime and Expo SDK for all six installation-header combinations. The five
SDK 57 installs share one bundle; SDK 54 receives a different compiled bundle.
Both exports' source maps contain the verified search and screen changes.
Preview, iOS and Android versions older than 3.4.2 are outside this rollout.

### Follow-up OTA: verification deadlines and diagnostics

Full `npm test` passed with both SDK 57 and SDK 54 dependencies. Both exported
source maps were checked for the deadline correction and diagnostic fields.
The follow-up publications below supersede the first JoJo OTA. Expo's production
endpoint returned HTTP 200, the exact update ID and the correct SDK for every
runtime. SDK 57 shares launch asset `85702e65c932a2b6435bbbf722f2b3fd`; SDK 54
uses `0a1ac65157976743351659837abe5dd3`.

| Runtime | Update group | Update ID for device-log correlation |
| --- | --- | --- |
| 4.0.0 | `bd3fbde9-8318-4a2b-9bee-5e727439e9ff` | `01a12763-8c57-7464-8224-826bfc9c35af` |
| 3.4.6 | `089873b4-fa63-4c52-a86b-f0ac7a0a66de` | `01a12764-03d1-7261-b584-b5364d177ae4` |
| 3.4.5 | `0632e8f1-5061-4cef-a5f9-c9f1c85c6208` | `01a12764-6cc7-7090-a5b8-8e62f5a9bef9` |
| 3.4.4 | `cbb51b28-da2c-43dc-bbd3-18813a97774d` | `01a12764-bfdd-76b0-9301-9c38d2211b0f` |
| 3.4.3 | `3eb4a82d-f86f-45d7-9c0e-874299d2b894` | `01a12765-2921-76af-a686-f28be00c2f38` |
| 3.4.2 | `e1f6e7fe-7522-4631-bb9b-fbf72cd25148` | `01a12763-1825-7139-a78d-81718318ae07` |

A final read at 19:54:29 UTC found no logs newer than the reporter's 19:47:04
error. This is not confirmation of recovery; the reporter needs to run the
updated app before its new search diagnostics can establish device-level success.

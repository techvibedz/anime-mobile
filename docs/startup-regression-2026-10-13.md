# Startup regression correction — 13 October 2026

The previous OTA exposed a quadratic completion reconciliation path at startup
and on every history notification. For N completion records, it repeatedly
scanned N records for each of N items. The provider's new startup reconciliation
made this existing cost run before the first home paint.

Completion reconciliation now builds href/title indexes once, preserving every
matching legacy/source copy while visiting records linearly. The 2,500-record
regression check previously scans 6,250,000 rows and now scans 2,500, with 12,500
normalizations and roughly 20 ms execution on this Windows host. That timing is
not a phone startup measurement.

Ready home data no longer waits for Anime4up archive/airing enrichment. A shared
home hit renders immediately, without the extra three-second live-source grace
period, and seeds the local cache. The visible home exits its skeleton when the
first usable callback arrives, even if another startup promise is pending.

Fast returns to Home do not load it twice. Episode caches younger than one
minute do not start another primary/secondary scrape; manual refresh bypasses
that window, and the existing focus/resume/minute polling stays in place.

Explicit detail requests use the existing reserved browser capacity, while
daily verification stays in the background. Parallel catalog verification keeps
its existing concurrency and timeout budget. An actual host-dispatch test starts
a selected page in the reserved slot while three catalog jobs remain active.
Daily and recommendation work start after five seconds of Home focus and stop
starting new requests after navigation away. Initial episode sync/reporting
waits fifteen seconds; the five-minute foreground refresh remains active.

`check-startup-performance.cjs` tests the actual reconciliation function at scale,
ready-home behavior and early content display. Its `--baseline` run fails on the
quadratic scan count. Existing episode-refresh tests now check warm-cache reuse
and browser priority. Full SDK 57 and SDK 54 test suites passed, both Android
exports succeeded, and the final cache-race, navigation-dispatch, scale checks
and TypeScript passed on both stacks before the final production correction.

No physical Android device is connected. Native rendering, carrier/source
latency, and startup time on the user's phone remain unmeasured. No native
dependency, app version, database schema or access policy is changed.

## Final production Android OTA

| Runtime | SDK | Update group |
| --- | --- | --- |
| 4.0.0 | 57 | `b09cd9dd-ae7f-4058-ae43-92944808bb12` |
| 3.4.6 | 57 | `93b7822d-d30d-42a3-ad5b-5f122a52b147` |
| 3.4.5 | 57 | `fcdb3504-710d-41b9-8eb0-478915b2e9a9` |
| 3.4.4 | 57 | `d18e3f59-84f2-42f1-bb51-935419f78899` |
| 3.4.3 | 57 | `e1713fce-8753-4b5c-b3ef-e3640a9b3b1a` |
| 3.4.2 | 54 | `900207e8-e3de-4a80-a41d-5bfe457c1663` |

All six production Android update requests returned HTTP 200 with the exact
final update ID, runtime and SDK. The five SDK 57 manifests share the same tested
bundle hash; runtime 3.4.2 receives its separately compiled SDK 54 bundle.

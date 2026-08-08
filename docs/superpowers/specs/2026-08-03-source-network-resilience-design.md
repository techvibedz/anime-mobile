# Source Network Resilience Design

## Goal

Ensure Android users can reach WitAnime, Anime4up, and Anime3rb when an ISP resolver blocks or poisons a source domain, without adding a backend, weakening TLS, or publishing an OTA update.

## Existing System

- React Native `fetch` already uses a generated Android OkHttp client with `PantoufaDohDns`.
- Hidden scraper WebViews already use a localhost CONNECT tunnel so DNS is resolved by `PantoufaDohDns` while TLS remains end-to-end.
- WitAnime already probes two domains, but Anime4up and Anime3rb use fixed domains.
- DoH results are cached forever, and the WebView tunnel connects only to the first returned address.
- Most source failures collapse to `null`, so empty content does not identify DNS, SSL, HTTP, Cloudflare, timeout, or invalid HTML failures.

## Architecture

### Native DNS And IP Routing

Keep requests addressed to the original HTTPS hostname. Resolve that hostname through DoH and pass all returned addresses to OkHttp or the WebView CONNECT tunnel. This routes the socket to resolved IP addresses while preserving the hostname for TLS SNI and certificate validation.

Use more than one DoH endpoint. A failed endpoint falls through to the next endpoint, then to system DNS. Cache successful answers using a bounded TTL derived from the DNS response. Do not permanently cache failures.

The WebView tunnel tries each resolved address until one connects. It never terminates TLS and never accepts an invalid certificate.

### Source Domain Registry

Use one registry for source domains and semantic health checks:

| Source | Candidates | Valid response evidence |
| --- | --- | --- |
| WitAnime | `witanime.you`, `witanime.life` | WitAnime card/site markers |
| Anime4up | `w1.anime4up.rest`, `anime4up.rest` | Anime4up card/site markers |
| Anime3rb | `anime3rb.com`, `www.anime3rb.com` | Anime3rb JSON-LD/site markers |

Rewriting changes only the scheme/host of URLs belonging to that source. Paths, query strings, and fragments remain unchanged. The last healthy candidate is stored with a short preference TTL; after expiry, candidates may be probed again so a stale mirror does not become permanent.

### Request Strategy

Direct source fetches and source WebView jobs resolve their URL through the registry. A request may rotate to the next candidate after DNS/network failure, timeout, SSL failure, retryable `403/429/5xx`, or a successful HTTP response that lacks the expected source marker. Genuine `404/410` responses are not retried on another mirror.

Mirror fallback is bounded to the configured candidates. Existing per-request retry limits remain bounded and are not multiplied into an unbounded retry loop.

Provider embed and media domains are not rewritten as source mirrors. They continue to benefit from native DoH when applicable.

## Cloudflare Cookies And User-Agent

- Every WebView attempt uses the existing `VIDEO_USER_AGENT`, shared cookie store, persistent storage, and non-incognito mode.
- A retry within the same source keeps the same WebView slot where practical, preserving Chromium state and Cloudflare clearance cookies.
- Cookies remain scoped by browser cookie rules. A cookie for one mirror is not copied to an unrelated domain.
- Direct OkHttp fetches use the same User-Agent and referer policy as today, but do not attempt to extract or forge HttpOnly WebView cookies.
- If direct fetch receives a Cloudflare challenge or invalid source body, it falls back to the real-browser WebView path rather than weakening Cloudflare or TLS checks.

## TTL Handling

- Positive DoH answers use the minimum valid answer TTL, clamped to a safe lower and upper bound.
- DNS failures are not cached permanently; an optional short negative cooldown only prevents immediate request storms.
- Healthy mirror preference uses a separate short TTL and is cleared after qualifying failures.
- Changing network conditions can therefore recover without restarting the app.

## Failure Reporting

Classify and log source failures as `dns`, `network`, `timeout`, `ssl`, `http`, `cloudflare`, or `invalid-content`. Logs include the source and candidate hostname but no cookies, query values, authorization data, or resolved user data.

## Verification

- Unit tests cover source URL recognition/rewriting, candidate ordering, preference expiry, and retry classification.
- A generated-native-source check confirms the DoH providers, TTL cache, all-address iteration, OkHttp registration, and WebView proxy registration are present after Expo prebuild.
- Existing TypeScript and injected-script checks must continue to pass.
- A local Android APK is the acceptance artifact. Test with normal DNS and a DNS-blocking network before any release or OTA action.

## Constraints

- No subagents.
- No backend or external content proxy.
- No TLS certificate bypass or trust-all client.
- No OTA publish, EAS submission, release commit, or store deployment before user testing.
- Native networking changes require a new APK; they cannot be delivered by OTA alone.

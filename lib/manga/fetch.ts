// Manga network layer — the anime sources' resilience recipe, applied to
// manga: a plain GET first (fast path, RN fetch has no CORS), and when the
// direct page is missing or doesn't contain the expected marker (Cloudflare
// challenge, bot wall), render the URL in the hidden scraper WebView — a real
// browser that solves CF challenges naturally — then hand back the rendered
// HTML. Callers never care which path won.

import { fetchHtml, looksLikeCfChallenge } from "../scraper/direct";
import { enqueue } from "../scraper/bus";
import { EXTRACT_RENDERED_HTML } from "../scraper/scripts";
import { VIDEO_USER_AGENT } from "../videoProviders";

// Manga sites answer fast or not at all when Cloudflare is in the way; fail
// into the WebView quickly instead of burning a long retry ladder first.
const DIRECT_TIMEOUTS = [5000, 8000] as const;

// One in-flight WebView render per URL — the hub and a prefetch can ask for
// the same page at the same moment; both wait on the same browser trip.
const webViewInflight = new Map<string, Promise<string | null>>();

// ── per-host circuit breaker ─────────────────────────────────────────────────
// The scraper WebView bus is SERIAL and shared with anime scraping. A source
// that is down (mangawy's backend 500s, hijala behind an interactive Turnstile
// the hidden WebView can never click — both 2026-11-13) would otherwise queue a
// 28s browser job for every search/detail/match lookup, stalling the whole app.
// After BREAKER_THRESHOLD consecutive WebView failures on a host, skip its
// WebView fallback for BREAKER_COOLDOWN_MS. The cheap direct GET still runs
// every time, and any success (direct or WebView) closes the breaker at once.
const BREAKER_THRESHOLD = 2;
const BREAKER_COOLDOWN_MS = 10 * 60_000;
const hostFailures = new Map<string, { count: number; openUntil: number }>();

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www./, "");
  } catch {
    return url;
  }
}

/** True while the host's WebView fallback is suspended. */
export function isMangaHostDown(url: string): boolean {
  const state = hostFailures.get(hostOf(url));
  return !!state && state.openUntil > Date.now();
}

export function markHostOk(url: string): void {
  hostFailures.delete(hostOf(url));
}

/** Open the breaker at once — the site itself told us its backend is down. */
export function markHostDead(url: string): void {
  hostFailures.set(hostOf(url), { count: BREAKER_THRESHOLD, openUntil: Date.now() + BREAKER_COOLDOWN_MS });
}

export function markHostFailed(url: string): void {
  const host = hostOf(url);
  const state = hostFailures.get(host) ?? { count: 0, openUntil: 0 };
  state.count += 1;
  if (state.count >= BREAKER_THRESHOLD) state.openUntil = Date.now() + BREAKER_COOLDOWN_MS;
  hostFailures.set(host, state);
}

/** Test hook. */
export function resetMangaHostBreaker(): void {
  hostFailures.clear();
}

async function fetchViaWebView(url: string, marker: string, rawText = false): Promise<string | null> {
  if (isMangaHostDown(url)) return null;
  const key = `${rawText}|${marker}|${url}`;
  const existing = webViewInflight.get(key);
  if (existing) return existing;
  const pending = (async () => {
    let html: string | null = null;
    try {
      const result = (await enqueue({
        url,
        injectAfter: EXTRACT_RENDERED_HTML(marker, rawText, 27_000),
        timeoutMs: 28_000,
      })) as { html?: string } | null;
      const raw = result?.html;
      html = typeof raw === "string" && raw.length > 0 && !looksLikeCfChallenge(raw) && (!marker || raw.includes(marker)) ? raw : null;
      return html;
    } catch {
      return null;
    } finally {
      if (html) markHostOk(url);
      else markHostFailed(url);
      webViewInflight.delete(key);
    }
  })();
  webViewInflight.set(key, pending);
  return pending;
}

/**
 * Fetch a manga page as HTML. `marker` is a substring that must exist in a
 * VALID page (e.g. "wp-manga", "chapter/") — when the direct response is a
 * challenge/placeholder page that lacks it, the WebView fallback runs.
 * With no marker, any non-empty direct response wins.
 */
export async function fetchMangaHtml(
  url: string,
  referer?: string,
  marker = "",
  /** Text the site renders when its OWN backend failed. The browser would load
   * the same broken backend, so skip the 28s WebView trip and open the breaker. */
  deadMarker?: string,
): Promise<string | null> {
  const direct = await fetchHtml(url, referer, DIRECT_TIMEOUTS);
  if (direct && !looksLikeCfChallenge(direct) && (!marker || direct.includes(marker))) {
    markHostOk(url);
    return direct;
  }
  if (direct && deadMarker && direct.includes(deadMarker)) {
    markHostDead(url);
    return null;
  }
  return fetchViaWebView(url, marker);
}

/** JSON endpoints use the same browser verification fallback as HTML pages. */
export async function fetchMangaJson<T>(url: string, referer?: string): Promise<T | null> {
  const text = await fetchMangaRawText(url, referer);
  if (text == null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Raw text variant of fetchMangaJson (search APIs that parse their own body).
 * Short timeouts — a slow JSON endpoint must not stall the search page. */
export async function fetchMangaRawText(url: string, referer?: string): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), attempt === 0 ? 5000 : 9000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": VIDEO_USER_AGENT,
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "ar,en;q=0.9",
          ...(referer ? { Referer: referer } : {}),
        },
      });
      if (res.ok) {
        // Read the body BEFORE clearing the timer — a stalled body read is
        // bounded by the same abort window.
        const text = await res.text();
        if (text && !looksLikeCfChallenge(text)) {
          markHostOk(url);
          return text;
        }
        break;
      }
      if (res.status === 404 || res.status === 410) return null;
      if (res.status === 403 || res.status === 429 || res.status === 503) break;
    } catch {
      // The next attempt/browser uses the source's existing encrypted DNS.
    } finally {
      clearTimeout(timer);
    }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return fetchViaWebView(url, "", true);
}

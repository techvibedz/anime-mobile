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

async function fetchViaWebView(url: string, marker: string, rawText = false): Promise<string | null> {
  const key = `${rawText}|${marker}|${url}`;
  const existing = webViewInflight.get(key);
  if (existing) return existing;
  const pending = (async () => {
    try {
      const result = (await enqueue({
        url,
        injectAfter: EXTRACT_RENDERED_HTML(marker, rawText, 27_000),
        timeoutMs: 28_000,
      })) as { html?: string } | null;
      const html = result?.html;
      return typeof html === "string" && html.length > 0 && !looksLikeCfChallenge(html) && (!marker || html.includes(marker)) ? html : null;
    } catch {
      return null;
    } finally {
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
): Promise<string | null> {
  const direct = await fetchHtml(url, referer, DIRECT_TIMEOUTS);
  if (direct && !looksLikeCfChallenge(direct) && (!marker || direct.includes(marker))) return direct;
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
        if (text && !looksLikeCfChallenge(text)) return text;
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

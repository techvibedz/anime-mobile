// Direct (no-WebView) static-HTML scraping over React Native's native fetch.
//
// RN's fetch has no CORS, so a plain GET reads the source sites' static HTML
// straight from JS — no WebView slot, no render, no ad gates. anime4up serves
// its search results / episode lists / server lists in the initial HTML, and
// anime3rb is Laravel-rendered (the whole payload is in the first response),
// so everything here resolves in one or two cheap GETs where the WebView path
// takes many seconds and frequently comes back empty.
//
// Ported from the desktop app (pantoufa-desktop src/lib/scraper.ts +
// electron/main.ts) with window.pantoufa.fetchHtml replaced by fetchHtml().

import type { RawServer } from "./index";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { enqueue } from "./bus";
import { EXTRACT_RENDERED_HTML } from "./scripts";
import { fuzzyScore } from "../fuzzy";
import { remoteLog } from "../remoteLog";
import { classifyProvider, classifyProviderWithName, VIDEO_USER_AGENT as BROWSER_UA } from "../videoProviders";
import {
  candidateForAttempt,
  clearSourcePreference,
  getSourceCandidates,
  identifySource,
  isRetryableSourceStatus,
  isValidSourceHtml,
  markSourceHealthy,
  rewriteToCandidate,
  SOURCE_DOMAINS,
} from "./sourceDomains";

export { classifyProvider } from "../videoProviders";

const UP4_BASE = "https://w1.anime4up.rest";
const A3RB_BASE = "https://anime3rb.com";

// witanime rotates TLDs (”.you“ was current at build; ”.life“ is an earlier
// mirror). A non-standard TLD like “”.you“” may NOT resolve on every DNS
// resolver/ISP/VPN — the single-user “stuck on loading” cause where changing
// network/VPN changes nothing because the new DNS also doesn't know the TLD.
// Probe each known domain once per session, cache whichever answers, and
// route every witanime fetch through it. Add new mirrors here as they appear.
export const WIT_DOMAINS = SOURCE_DOMAINS.witanime.map((host) => `https://${host}`);
let _resolvedWitBase: string | null = null;
let _witBaseInflight: Promise<string> | null = null;
// After a total probe failure, don't re-probe (or re-log) on every call —
// but also don't poison the session with a permanent fallback. Calls inside
// this window get the primary domain back immediately; the next call after
// the window re-probes, so a transient outage self-heals.
let _witFailUntil = 0;
const WIT_FAIL_WINDOW_MS = 60_000;
const WIT_BASE_STORAGE_KEY = "@wit_base_v1";

export function isWitAnimeHtml(html: string): boolean {
  return /anime-card-container|episodes-card-container|lucodeia-slider-slide-item|وايت\s*انمي/i.test(html);
}

export function rewriteWitUrl(raw: string, base: string): string {
  try {
    const url = new URL(raw);
    if (!/(^|\.)witanime\./i.test(url.hostname)) return raw;
    const target = new URL(base);
    url.protocol = target.protocol;
    url.host = target.host;
    return url.toString();
  } catch {
    return raw;
  }
}

async function probeWit(base: string): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(base + "/", { signal: ctrl.signal, headers: { "User-Agent": BROWSER_UA } });
    if (!res.ok) return null;
    return isWitAnimeHtml(await res.text()) ? base : null;
  } catch {
    return null; // DNS fail / timeout / unreachable
  } finally {
    clearTimeout(t);
  }
}

async function resolveWitBase(): Promise<string> {
  let saved: string | null = null;
  try {
    const stored = await AsyncStorage.getItem(WIT_BASE_STORAGE_KEY);
    if (stored && WIT_DOMAINS.includes(stored)) saved = stored;
  } catch {
    // storage unreadable — use the normal preference order
  }

  const candidates = saved
    ? [saved, ...WIT_DOMAINS.filter((domain) => domain !== saved)]
    : WIT_DOMAINS;
  const results = await Promise.all(candidates.map(probeWit));
  const hit = candidates.find((_, i) => results[i]);
  if (hit) {
    _resolvedWitBase = hit;
    void AsyncStorage.setItem(WIT_BASE_STORAGE_KEY, hit).catch(() => {});
    return hit;
  }

  // None answered — return the primary WITHOUT caching it, and hold off
  // re-probing (and re-logging) for the failure window.
  _witFailUntil = Date.now() + WIT_FAIL_WINDOW_MS;
  remoteLog("warn", "scraper", "all witanime TLDs unreachable", { tried: WIT_DOMAINS });
  return WIT_DOMAINS[0];
}

/** Return a semantically-valid WitAnime mirror. Concurrent callers share one
 * probe so cold-start bursts cannot emit duplicate warnings or select different hosts. */
export async function getWitBase(): Promise<string> {
  if (_resolvedWitBase) return _resolvedWitBase;
  if (Date.now() < _witFailUntil) return WIT_DOMAINS[0];
  if (_witBaseInflight) return _witBaseInflight;
  _witBaseInflight = resolveWitBase().finally(() => { _witBaseInflight = null; });
  return _witBaseInflight;
}

// Must match the scraper WebView / native player UA (see ScraperHost.tsx and
// the watch screen's videoSource headers) — some CDNs bind tokens to the UA
// that minted them.
// Both sites are intermittently flaky: a single GET routinely hits a timeout,
// a 429 rate-limit (lookups fire several GETs in a burst), a 503, or a
// transient Cloudflare hiccup. Retry each GET a few times with a GROWING
// per-attempt timeout and a small growing backoff. A fixed short timeout loses
// on a consistently slow link: every attempt aborts mid-download at the same
// byte and the retry re-downloads from scratch, so all attempts fail
// identically. The first attempt stays short so a flaky link fails fast and
// retries quickly; later attempts give a slow-but-steady link room to finish.
// A hard 4xx (404/410 — e.g. a slug probe miss) won't change on retry, so bail
// fast.
const FETCH_ATTEMPT_TIMEOUTS = [8000, 16000, 24000];
export async function fetchHtml(url: string, referer?: string): Promise<string | null> {
  const ATTEMPTS = FETCH_ATTEMPT_TIMEOUTS.length;
  const candidates = await getSourceCandidates(url);
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const attemptUrl = candidateForAttempt(candidates, attempt);
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), FETCH_ATTEMPT_TIMEOUTS[attempt - 1]);
    try {
      const res = await fetch(attemptUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent": BROWSER_UA,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "ar,en;q=0.9",
          ...(referer ? { Referer: rewriteToCandidate(referer, attemptUrl) } : {}),
        },
      });
      clearTimeout(t);
      if (res.ok) {
        const html = await res.text();
        const source = identifySource(attemptUrl);
        if (!source || isValidSourceHtml(source, html)) {
          void markSourceHealthy(attemptUrl).catch(() => {});
          return html;
        }
        void clearSourcePreference(attemptUrl).catch(() => {});
        if (attempt === ATTEMPTS) return null;
        continue;
      }
      if (res.status === 404 || res.status === 410) return null;
      const retryable = isRetryableSourceStatus(res.status);
      if (!retryable || attempt === ATTEMPTS) return null;
    } catch {
      clearTimeout(t);
      void clearSourcePreference(attemptUrl).catch(() => {});
      if (attempt === ATTEMPTS) return null;
    }
    await new Promise((r) => setTimeout(r, 600 * attempt));
  }
  return null;
}

// ── anime3rb / vid3rb: CF-resilient HTML fetch ───────────────────────────────
// anime3rb is the ONLY source scraped over raw fetch instead of the hidden
// WebView. When Cloudflare challenges the on-device OkHttp client (its TLS/HTTP
// fingerprint differs from a desktop browser, so the residential-IP allowance
// isn't enough), the raw GET comes back as a 403/503 challenge page with NO real
// content — so the episode page yields no video_url and the player page yields
// no video_sources, and "no Anime3rb server shows up". The rest of the app dodges
// this by loading pages in a real-browser WebView, which solves the challenge
// naturally (see ScraperHost's 403/503 handling). These helpers give the
// anime3rb path the same escape hatch: try the fast raw GET first, and on a
// block/challenge fall through to a one-shot WebView render of the same URL.

// Raw GET that surfaces the final HTTP status (so callers can tell a genuine
// 404 "slug doesn't exist" apart from a 403/503 Cloudflare block — only the
// latter is worth escalating to the WebView). Second attempt gets a longer
// budget so a slow-but-steady link can finish instead of aborting mid-download
// (see fetchHtml above).
async function rawGetA3rb(url: string): Promise<{ html: string | null; status: number }> {
  const ATTEMPT_TIMEOUTS = [8000, 20000];
  const ATTEMPTS = ATTEMPT_TIMEOUTS.length;
  const candidates = await getSourceCandidates(url);
  let lastStatus = 0;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const attemptUrl = candidateForAttempt(candidates, attempt);
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUTS[attempt - 1]);
    try {
      const res = await fetch(attemptUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent": BROWSER_UA,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "ar,en;q=0.9",
          Referer: rewriteToCandidate(A3RB_BASE + "/", attemptUrl),
        },
      });
      clearTimeout(t);
      lastStatus = res.status;
      if (res.ok) {
        const html = await res.text();
        if (isValidSourceHtml("anime3rb", html)) {
          void markSourceHealthy(attemptUrl).catch(() => {});
          return { html, status: res.status };
        }
        void clearSourcePreference(attemptUrl).catch(() => {});
      }
      // 404/410 won't change on retry — bail immediately so a wrong slug probe
      // stays cheap and does NOT escalate to a WebView load.
      if (res.status === 404 || res.status === 410) return { html: null, status: res.status };
    } catch {
      clearTimeout(t);
      void clearSourcePreference(attemptUrl).catch(() => {});
    }
    if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, 500 * attempt));
  }
  return { html: null, status: lastStatus };
}

function looksLikeCfChallenge(html: string): boolean {
  return /just a moment|cf-browser-verification|challenge-platform|cf_chl_opt|id="cf-please-wait"|Checking your browser|Attention Required/i.test(
    html,
  );
}

// One-shot WebView render: loads the URL in the hidden real-browser pool and
// returns its fully-rendered HTML once `marker` appears (CF solved). Returns
// null on timeout/error so callers degrade gracefully.
async function fetchHtmlViaWebView(url: string, marker: string, priority = false, timeoutMs = 25000): Promise<string | null> {
  try {
    const r = (await enqueue({
      url,
      injectAfter: EXTRACT_RENDERED_HTML(marker),
      timeoutMs,
      priority,
    })) as { html?: string } | null;
    const html = r?.html || null;
    return html && !looksLikeCfChallenge(html) ? html : null;
  } catch {
    return null;
  }
}

// anime3rb/vid3rb HTML with automatic WebView escalation. `marker` is a
// substring that proves the real content rendered (e.g. "video_url" on an
// episode page, "video_sources" on a vid3rb player page, "og:title" on a title
// page). Fast path: a raw GET whose body carries the marker and isn't a
// challenge. Otherwise — block, challenge, timeout, or marker-missing — render
// it in the WebView. A clean 404 short-circuits to null (genuine miss).
async function fetchAnime3rbHtml(url: string, marker: string, priority = false): Promise<string | null> {
  const { html, status } = await rawGetA3rb(url);
  if (html && !looksLikeCfChallenge(html) && (!marker || html.indexOf(marker) >= 0)) return html;
  if (status === 404 || status === 410) return null;
  const viaWv = await fetchHtmlViaWebView(url, marker, priority);
  if (viaWv) return viaWv;
  // Last resort: hand back the raw body (may still parse) rather than nothing.
  return html;
}

/* ── witanime: direct static-HTML listings & search ──
 *
 * witanime serves its genre / all-anime / search pages as plain static HTML
 * (the anime cards are in the initial response — no JS gate, no CF challenge on
 * a residential IP). A genre page in particular is ONE huge page that lists
 * EVERY title in the genre (Action ≈ 900 cards, ~1.7 MB) with no server
 * pagination, so rendering it in the hidden WebView (which also tries to load
 * ~900 poster images) is slow and frequently times out — categories "never
 * showed". A plain GET + regex parse reads the same cards in one cheap request
 * with no rendering, so this is the fast path for those screens; the WebView
 * scrape stays as the fallback. */

export type WitCard = {
  title: string;
  href: string;
  image: string | null;
  type: string | null;
  status: string | null;
  synopsis: string | null;
};

function htmlDecode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// Strip WordPress' resize suffix (…-323x470.jpg → ….jpg) and CDN resize query
// params so the card shows a full-resolution poster (mirrors _upgradeImg in
// scripts.ts).
function witUpgradeImg(u: string | null): string | null {
  if (!u) return null;
  return String(u)
    .replace(/-\d+x\d+(\.\w+)$/, "$1")
    .replace(/\?resize=\d+,\d+/, "")
    .replace(/\?w=\d+/, "");
}

// Parse every .anime-card-container in a witanime listing/search page. Splitting
// on the container class keeps each card's image/title/type/status in scope
// without a brittle single mega-regex.
function parseWitCards(html: string): WitCard[] {
  const out: WitCard[] = [];
  const seen = new Set<string>();
  const blocks = html.split("anime-card-container");
  for (let i = 1; i < blocks.length; i++) {
    const b = blocks[i];
    const tm = b.match(
      /anime-card-title[^>]*>\s*<h3[^>]*>\s*<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!tm) continue;
    const href = (tm[1] || "").trim();
    if (href.indexOf("/anime/") < 0 || seen.has(href)) continue;
    const title = htmlDecode((tm[2] || "").replace(/<[^>]+>/g, ""));
    if (!title) continue;
    seen.add(href);
    const im = b.match(/<img[^>]*\b(?:data-src|data-original|data-image|src)=["']([^"']+)["']/i);
    const ty = b.match(/anime-card-type[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i);
    const st = b.match(/anime-card-status[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i);
    out.push({
      title,
      href,
      image: im ? witUpgradeImg(im[1]) : null,
      type: ty ? htmlDecode(ty[1].replace(/<[^>]+>/g, "")) : null,
      status: st ? htmlDecode(st[1].replace(/<[^>]+>/g, "")) : null,
      synopsis: null,
    });
  }
  return out;
}

// Fetch + parse a witanime listing page (genre or all-anime). Returns null on a
// fetch failure so the caller can fall back to the WebView scrape.
export async function fetchWitListingDirect(url: string): Promise<WitCard[] | null> {
  const base = await getWitBase();
  const html = await fetchHtml(rewriteWitUrl(url, base), base + "/");
  if (!html) return null;
  return parseWitCards(html);
}

/* ── witanime: direct static-HTML HOME ──
 *
 * The home page (witanime.you/) is the SAME static-HTML shape as the listing
 * pages — featured slider, anime cards, and recent-episode cards all ship in
 * the initial response (verified: residential IP passes CF). The app used to
 * render it in the hidden WebView, which paid the ~10-15s cold-start +
 * Cloudflare-clear tax on every launch (the single slowest screen). A plain
 * GET + regex parse reads the whole page in well under a second, so this is the
 * fast path for the home feed; the WebView scrape stays as the fallback. */

export type WitHomeFeatured = { title: string; href: string; image: string | null; description: string | null; genres: string[] };
export type WitHomeAnime = { title: string; href: string; image: string | null; type: string | null; status: string | null; description: string | null; isNew: boolean; rating: string | null };
export type WitHomeEpisode = { title: string; href: string; image: string | null; animeTitle: string; animeHref: string; isNew: boolean };
export type WitHome = { featured: WitHomeFeatured[]; animes: WitHomeAnime[]; episodes: WitHomeEpisode[] };

function parseHomeSlides(html: string): { featured: WitHomeFeatured[]; episodes: WitHomeEpisode[] } {
  const featured: WitHomeFeatured[] = [];
  const episodes: WitHomeEpisode[] = [];
  const seen = new Set<string>();
  const re = /<a\b([^>]*\bclass=["'][^"']*lucodeia-slider-slide-item[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tag = m[1] || "";
    const body = m[2] || "";
    const href = (tag.match(/\bhref=["']([^"']+)["']/i)?.[1] || "").trim();
    if (!href || seen.has(href)) continue;
    seen.add(href);
    const fullTitle = htmlDecode(
      tag.match(/\btitle=["']([^"']*)["']/i)?.[1] || body.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1]?.replace(/<[^>]+>/g, "") || "",
    ).trim();
    if (!fullTitle) continue;
    const episodeMatch = fullTitle.match(/^(.*?)\s+الحلقة\s*(\d+)/);
    const animeTitle = episodeMatch?.[1]?.trim() || fullTitle;
    const image = tag.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/i)?.[1]?.trim() || null;
    featured.push({ title: animeTitle, href, image, description: null, genres: [] });
    if (episodeMatch) {
      episodes.push({
        title: `الحلقة ${episodeMatch[2]}`,
        href,
        image,
        animeTitle,
        animeHref: "",
        isNew: true,
      });
    }
  }
  return { featured: featured.slice(0, 5), episodes };
}

// Parse the featured slider (<a class="lucodeia-slider-slide-item" …>). Static
// HTML carries only the title/href/background-image — the genres/description
// meta is injected by JS, so those come back empty (the hero still renders with
// its image + title). De-duped by href since the carousel clones edge slides.
function parseWitFeatured(html: string): WitHomeFeatured[] {
  const out: WitHomeFeatured[] = [];
  const seen = new Set<string>();
  const re = /<a\b([^>]*\bclass=["'][^"']*lucodeia-slider-slide-item[^"']*["'][^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tag = m[1] || "";
    const hrefM = tag.match(/\bhref=["']([^"']+)["']/i);
    const href = hrefM ? hrefM[1].trim() : "";
    if (!href || seen.has(href)) continue;
    seen.add(href);
    const titleM = tag.match(/\btitle=["']([^"']*)["']/i);
    const bgM = tag.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/i);
    out.push({
      title: titleM ? htmlDecode(titleM[1]) : "",
      href,
      image: bgM ? witUpgradeImg(bgM[1].trim()) : null,
      description: null,
      genres: [],
    });
  }
  return out.slice(0, 5);
}

// Parse the home anime cards into the home payload's anime shape. parseWitCards
// already extracts every .anime-card-container (title/href/image/type/status),
// so reuse it and derive isNew from the ongoing-status marker.
function parseWitHomeAnimes(html: string): WitHomeAnime[] {
  return parseWitCards(html).map((c) => ({
    title: c.title,
    href: c.href,
    image: c.image,
    type: c.type,
    status: c.status,
    description: null,
    isNew: (c.status || "").indexOf("مستمر") >= 0,
    rating: null,
  }));
}

// Parse the recent-episode cards (.episodes-card-container). Each block carries
// the episode link + label, a thumbnail, and the parent anime's title + URL.
function parseWitHomeEpisodes(html: string): WitHomeEpisode[] {
  const out: WitHomeEpisode[] = [];
  const seen = new Set<string>();
  const blocks = html.split("episodes-card-container");
  for (let i = 1; i < blocks.length; i++) {
    const b = blocks[i];
    const epM = b.match(/episodes-card-title[^>]*>\s*<h3[^>]*>\s*<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!epM) continue;
    const href = (epM[1] || "").trim();
    if (!href || seen.has(href)) continue;
    seen.add(href);
    const title = htmlDecode((epM[2] || "").replace(/<[^>]+>/g, ""));
    const imM = b.match(/<img[^>]*\b(?:data-src|data-original|data-image|src)=["']([^"']+)["']/i);
    const anM = b.match(/ep-card-anime-title[^>]*>\s*<h3[^>]*>\s*<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    out.push({
      title,
      href,
      image: imM ? witUpgradeImg(imM[1]) : null,
      animeTitle: anM ? htmlDecode((anM[2] || "").replace(/<[^>]+>/g, "")) : "",
      animeHref: anM ? (anM[1] || "").trim() : "",
      isNew: true,
    });
  }
  return out;
}

// Fetch + parse the witanime home page directly (no WebView). Returns null on a
// fetch failure OR when the page yielded no cards (a CF challenge / cold body),
// so the caller falls back to the WebView home scrape.
export async function fetchWitHomeDirect(): Promise<WitHome | null> {
  const base = await getWitBase();
  const html = await fetchHtml(base + "/", base + "/");
  if (!html) return null;
  const animes = parseWitHomeAnimes(html);
  const episodes = parseWitHomeEpisodes(html);
  if (animes.length === 0 && episodes.length === 0) return null;
  return { featured: parseWitFeatured(html), animes, episodes };
}

// Search witanime via its static-HTML results page.
export async function searchWitanimeDirect(query: string): Promise<WitCard[] | null> {
  if (!query) return null;
  const base = await getWitBase();
  const url = `${base}/?search_param=animes&s=${encodeURIComponent(query)}`;
  const html = await fetchHtml(url, base + "/");
  if (!html) return null;
  return parseWitCards(html);
}

/* ── Title matching (mirrors EXTRACT_TITLE_MATCH in scripts.ts) ── */

// Roman-numeral season markers ("Mushoku Tensei III", anime3rb's own lowercase
// "mushoku-tensei-ii-…" slug). MAL/witanime romaji titles number later seasons
// this way, never "season 3", and anime3rb slugs mirror it — so this MUST work
// case-insensitively (the catalog matcher lowercases both sides). Multi-letter
// romans (ii..ix) are unambiguous, so match any case. Single-letter V/X collide
// with real words, so only accept them UPPERCASE. "I" is season 1 (the default)
// and too collision-prone (English pronoun) to ever match.
// ponytail: a bare "VII"/"II" in a non-season title (e.g. "Final Fantasy VII")
// is misread as a season; acceptable — vanishingly rare in this catalog, and it
// only affects season-equality in matching. Extend the map for season XI+.
const ROMAN_SEASON: Record<string, number> = {
  II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10,
};
function tm_romanSeason(orig: string): number {
  const s = orig || "";
  const multi = s.match(/\b(VIII|VII|VI|IV|IX|III|II)\b/i);
  if (multi) return ROMAN_SEASON[multi[1].toUpperCase()];
  const single = s.match(/\b(X|V)\b/); // uppercase-only for the word-colliding singles
  return single ? ROMAN_SEASON[single[1]] : 0;
}
export function tm_seasonNum(orig: string): number {
  const s = (orig || "").toLowerCase();
  const m =
    s.match(/\b(?:season|s|part|cour)\s*(\d+)\b/) ||
    // Ordinal-before-keyword form: "7th Season", "2nd Part", "3rd Cour".
    s.match(/\b(\d+)(?:st|nd|rd|th)\s+(?:season|part|cour)\b/) ||
    s.match(/الموسم\s*([٠-٩\d]+)/) ||
    s.match(/الجزء\s*([٠-٩\d]+)/);
  if (m) {
    const n = m[1].replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
    const v = parseInt(n, 10);
    if (!isNaN(v)) return v;
  }
  return tm_romanSeason(orig) || 1;
}
function tm_normLatin(s: string): string {
  return String(s || "").toLowerCase()
    .replace(/\b(?:season|s|part|cour)\s*\d+\b/g, " ")
    .replace(/\b(?:the|a|an|of|to|wa|no|wo|ga|ni)\b/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ").trim();
}
function tm_normArabic(s: string): string {
  return String(s || "")
    .replace(/[ً-ٰٟ]/g, "")
    .replace(/[آأإ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^؀-ۿ ]+/g, " ")
    .replace(/\s+/g, " ").trim();
}
function tm_toks(s: string): string[] {
  return s ? s.split(" ").filter((w) => w.length >= 2) : [];
}
function tm_overlap(a: string, b: string): number {
  const A = tm_toks(a), B = tm_toks(b);
  if (!A.length || !B.length) return 0;
  const setB: Record<string, boolean> = {};
  B.forEach((w) => { setB[w] = true; });
  let common = 0;
  A.forEach((w) => { if (setB[w]) common++; });
  return common / Math.min(A.length, B.length);
}
function tm_score(want: string, title: string): number {
  const latinWant = tm_normLatin(want), latinGot = tm_normLatin(title);
  const arWant = tm_normArabic(want), arGot = tm_normArabic(title);
  const latinOverlap = tm_overlap(latinWant, latinGot);
  const arabicOverlap = tm_overlap(arWant, arGot);
  let s: number;
  if (latinWant && latinGot === latinWant) s = 100;
  else if (latinWant && latinGot.indexOf(latinWant) === 0) s = 85;
  else if (arWant && arGot === arWant) s = 95;
  else s = Math.round(Math.max(latinOverlap, arabicOverlap) * 75);
  const sw = tm_seasonNum(want), sg = tm_seasonNum(title);
  if (sw === sg) s += 8; else s -= 12;
  return s;
}

// Normalize mp4upload URLs to the canonical embed form so they autoplay
// (watch-page and bare-host embed URLs render blank/redirect otherwise).
function normalizeEmbedUrl(src: string): string {
  try {
    const u = new URL(src);
    if (/mp4upload/.test(u.hostname)) {
      const embedM = u.pathname.match(/\/embed-([a-z0-9]+)\.html/i);
      if (embedM) return `https://www.mp4upload.com/embed-${embedM[1]}.html`;
      const codeM = u.pathname.match(/^\/([a-z0-9]{8,})/i);
      if (codeM) return `https://www.mp4upload.com/embed-${codeM[1]}.html`;
    }
  } catch {}
  return src;
}

/* ── anime4up: direct search / episode list / server list ── */

// Search anime4up for `searchTitle` via a direct GET and return the best-scoring
// anime page URL (or null). Threshold matches EXTRACT_TITLE_MATCH (>=34).
//
// `scoreTitle` is what candidates are scored against and defaults to the search
// term. Callers that fall back to truncated search variants (e.g. "Boku no
// Hero" for "Boku no Hero Academia 7th Season") MUST pass the full title here —
// otherwise the season is stripped from the comparison and a different season's
// anime page outscores the correct one, so the episode lookup later fails.
export async function searchAnime4upDirect(
  searchTitle: string,
  scoreTitle: string = searchTitle,
): Promise<string | null> {
  if (!searchTitle) return null;
  const url = `${UP4_BASE}/?search_param=animes&s=${encodeURIComponent(searchTitle)}`;
  const html = await fetchHtml(url, UP4_BASE + "/");
  if (!html) return null;
  // anime4up cards expose the anime URL twice (overlay <a> + title <h3><a>).
  // Pull the title link so we get the URL and display title together.
  const re = /class=["'][^"']*anime-card-title[^"']*["'][^>]*>\s*<h3[^>]*>\s*<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  let best: { url: string | null; score: number } = { url: null, score: 0 };
  while ((m = re.exec(html))) {
    const href = (m[1] || "").trim();
    const cardTitle = (m[2] || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!href || href.indexOf("/anime/") < 0 || !cardTitle) continue;
    const s = tm_score(scoreTitle, cardTitle);
    if (s > best.score) best = { url: href.indexOf("http") === 0 ? href : UP4_BASE + href, score: s };
  }
  // Fallback: if the card markup didn't match (layout drift), scan every
  // /anime/ anchor and score it by its link text — failing that, by the
  // human-readable slug derived from the URL.
  if (!best.url || best.score < 34) {
    const seen = new Set<string>();
    const are = /<a[^>]*href=["']([^"']*\/anime\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let a: RegExpExecArray | null;
    while ((a = are.exec(html))) {
      let href = (a[1] || "").trim();
      if (!href) continue;
      if (href.indexOf("http") !== 0) href = UP4_BASE + (href.charAt(0) === "/" ? "" : "/") + href;
      if (seen.has(href)) continue;
      seen.add(href);
      let label = (a[2] || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      if (!label) {
        try {
          const slug = decodeURIComponent(new URL(href).pathname.replace(/\/$/, "").split("/").pop() || "");
          label = slug.replace(/[-_]+/g, " ").trim();
        } catch {}
      }
      if (!label) continue;
      const s = tm_score(scoreTitle, label);
      if (s > best.score) best = { url: href, score: s };
    }
  }
  return best.score >= 34 ? best.url : null;
}

// Search anime4up via a direct GET and return the FULL card list (not just the
// best match), shaped like the WebView scraper's results. anime4up's search page
// ships its cards in the static HTML, so a plain GET + regex parse returns them
// in well under a second — the WebView render takes many seconds and often trips
// anime4up's ad gates. The caller uses this as the fast path and only falls back
// to the WebView scrape when it comes back empty (network / CF hiccup).
export async function searchAnime4upDirectList(
  query: string,
): Promise<{ title: string; href: string; image: string | null; type: string | null; status: string | null; synopsis: string | null }[] | null> {
  if (!query) return null;
  const url = `${UP4_BASE}/?search_param=animes&s=${encodeURIComponent(query)}`;
  const html = await fetchHtml(url, UP4_BASE + "/");
  if (!html) return null;
  const out: { title: string; href: string; image: string | null; type: string | null; status: string | null; synopsis: string | null }[] = [];
  const seen = new Set<string>();
  const blocks = html.split("anime-card-container");
  for (let i = 1; i < blocks.length; i++) {
    const b = blocks[i];
    const tm = b.match(/anime-card-title[^>]*>\s*<h3[^>]*>\s*<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!tm) continue;
    let href = (tm[1] || "").trim();
    if (href.indexOf("/anime/") < 0) continue;
    if (href.indexOf("http") !== 0) href = UP4_BASE + (href.charAt(0) === "/" ? "" : "/") + href;
    if (seen.has(href)) continue;
    const title = htmlDecode((tm[2] || "").replace(/<[^>]+>/g, ""));
    if (!title) continue;
    seen.add(href);
    const im = b.match(/<img[^>]*\b(?:data-src|data-original|data-image|src)=["']([^"']+)["']/i);
    const ty = b.match(/anime-card-type[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i);
    const st = b.match(/anime-card-status[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i);
    out.push({
      title,
      href,
      image: im ? witUpgradeImg(im[1]) : null,
      type: ty ? htmlDecode(ty[1].replace(/<[^>]+>/g, "")) : null,
      status: st ? htmlDecode(st[1].replace(/<[^>]+>/g, "")) : null,
      synopsis: null,
    });
  }
  return out;
}

/* ── Source-direct home rails (no AniList, no verification sweep) ──
 *
 * The "most popular" home rails used to pull AniList's global ranking and then
 * source-verify every title (50 searches × 3 rails) on the home screen — the
 * single biggest launch-time cost. These read a source's OWN listing page in
 * ONE static GET instead: each card already carries its real source URL, so the
 * rail opens the detail page directly with zero per-tap resolution. */

// Parse anime4up's standard .anime-card-container cards (season / movie listing
// pages and home widgets all use this markup) from static HTML. Same block-split
// shape as searchAnime4upDirectList.
function parseAnime4upCards(
  html: string,
): { title: string; href: string; image: string | null; type: string | null }[] {
  const out: { title: string; href: string; image: string | null; type: string | null }[] = [];
  const seen = new Set<string>();
  const blocks = html.split("anime-card-container");
  for (let i = 1; i < blocks.length; i++) {
    const b = blocks[i];
    const tm = b.match(/anime-card-title[^>]*>\s*<h3[^>]*>\s*<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!tm) continue;
    let href = (tm[1] || "").trim();
    if (href.indexOf("/anime/") < 0) continue;
    if (href.indexOf("http") !== 0) href = UP4_BASE + (href.charAt(0) === "/" ? "" : "/") + href;
    if (seen.has(href)) continue;
    const title = htmlDecode((tm[2] || "").replace(/<[^>]+>/g, ""));
    if (!title) continue;
    seen.add(href);
    const im = b.match(/<img[^>]*\b(?:data-src|data-original|data-image|src)=["']([^"']+)["']/i);
    const ty = b.match(/anime-card-type[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i);
    out.push({ title, href, image: im ? witUpgradeImg(im[1]) : null, type: ty ? htmlDecode(ty[1].replace(/<[^>]+>/g, "")) : null });
  }
  return out;
}

// witanime's full movie listing — every movie in ONE static GET (no server
// pagination), parsed by the shared card parser.
export async function fetchWitMoviesListing(): Promise<WitCard[] | null> {
  return fetchWitListingDirect(`${await getWitBase()}/anime-type/movie/`);
}

// anime4up home page via plain fetch (NO WebView). fetchHtml follows the home
// redirect (…/ → /home8/) and parseAnime4upCards reads the same
// .anime-card-container cards the WebView extractor waits for — but from the
// initial HTML, no rendering. This is the fallback for devices/users whose
// hidden WebView can't reach or solve witanime (or anime4up's WebView path):
// the direct fetch only needs the network, not a working WebView, so a brand-
// new user whose WebView is broken/outdated still gets a populated home.
export async function fetchAnime4upHomeDirect(): Promise<
  WitHome | null
> {
  const html = await fetchHtml(UP4_BASE + "/", UP4_BASE + "/");
  if (!html) return null;
  return parseAnime4upHomeHtml(html);
}

export function parseAnime4upHomeHtml(html: string): WitHome | null {
  const { featured, episodes } = parseHomeSlides(html);
  const animes: WitHomeAnime[] = parseAnime4upCards(html).map((card) => ({
    ...card,
    status: null,
    description: null,
    isNew: true,
    rating: null,
  }));
  return featured.length || episodes.length || animes.length ? { featured, animes, episodes } : null;
}

// The anime4up current-season catalogue, scraped directly. anime4up's main menu
// links the live season page (e.g. "ربيع 2026" → /anime-season/<slug>/), and the
// site's notion of "current" tracks the airing calendar — which disagrees with a
// device-clock season at the boundary (mid-June is still Spring on the site) — so
// read the link off the home page rather than constructing the slug. fetchHtml
// follows anime4up's home redirect (…/ → /home8/) automatically. One menu GET +
// one listing GET, both plain static HTML.
export async function fetchAnime4upSeasonListing(): Promise<
  { title: string; href: string; image: string | null; type: string | null }[] | null
> {
  const home = await fetchHtml(UP4_BASE + "/", UP4_BASE + "/");
  if (!home) return null;
  const m = home.match(/href=["'](https?:\/\/[^"']*\/anime-season\/[^"']+)["']/i);
  if (!m) return null;
  const html = await fetchHtml(m[1], UP4_BASE + "/");
  if (!html) return null;
  const cards = parseAnime4upCards(html);
  return cards.length ? cards : null;
}

/* ── anime3rb: direct static-HTML HOME (JSON-LD) ──
 *
 * Third, fully independent home source. anime3rb's Laravel home page embeds
 * schema.org JSON-LD ItemLists (latest episodes / latest added animes) with
 * clean titles, URLs and poster images — no fragile class scraping. Used only
 * when BOTH witanime and anime4up yield nothing (e.g. an ISP-level block on
 * those domains): anime3rb lives on a different domain, so a block list that
 * covers the two WordPress sources often misses it. Cards point at anime3rb
 * /titles/ and /episode/ URLs, which the detail and watch screens already
 * handle as first-class sources. */

// Recursively collect every schema.org ItemList node in a parsed JSON-LD doc.
function collectItemLists(node: any, out: any[]): void {
  if (!node || typeof node !== "object") return;
  if (node["@type"] === "ItemList" && Array.isArray(node.itemListElement)) out.push(node);
  for (const k of Object.keys(node)) collectItemLists(node[k], out);
}

// Strip the " - Anime3rb أنمي عرب" site suffix the JSON-LD names carry.
function a3rbCleanName(s: string): string {
  return (s || "").replace(/\s*[-–—]\s*Anime3rb[\s\S]*$/i, "").replace(/\s+/g, " ").trim();
}

// Fetch + parse anime3rb's home page. Laravel renders the whole payload into
// the first response, so one plain GET (with the usual WebView escalation on a
// CF challenge) is enough. Returns null on a fetch failure or when no usable
// list was found, so the caller can fall through to the next fallback.
export async function fetchAnime3rbHomeDirect(): Promise<WitHome | null> {
  const html = await fetchAnime3rbHtml(A3RB_BASE + "/", "itemListElement");
  if (!html) return null;
  const lists: any[] = [];
  const re = /<script[^>]*ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try { collectItemLists(JSON.parse(m[1]), lists); } catch {}
  }
  if (!lists.length) return null;

  // "أحدث الحلقات" carries flat episode ListItems ({position, url, name, image}).
  const epList = lists.find((l) => typeof l?.name === "string" && l.name.indexOf("الحلقات") >= 0);
  // "Latest Added Animes" wraps each entry in an `item` Movie/TVSeries object.
  const animeList = lists.find((l) => typeof l?.name === "string" && /latest added/i.test(l.name));

  const episodes: WitHomeEpisode[] = [];
  const seenEp = new Set<string>();
  for (const e of epList?.itemListElement ?? []) {
    const href = typeof e?.url === "string" ? e.url : "";
    if (!href || seenEp.has(href)) continue;
    const full = a3rbCleanName(typeof e?.name === "string" ? e.name : "");
    const numM = full.match(/الحلقة\s*(\d+)/);
    // /episode/<slug>/<n> → the anime's /titles/<slug> page.
    const slugM = href.match(/\/episode\/([^/]+)\/\d+/);
    if (!numM || !slugM) continue;
    seenEp.add(href);
    episodes.push({
      title: "الحلقة " + numM[1],
      href,
      image: typeof e?.image === "string" ? e.image : null,
      animeTitle: full.replace(/\s*الحلقة\s*\d+[\s\S]*$/, "").trim(),
      animeHref: `${A3RB_BASE}/titles/${slugM[1]}`,
      isNew: true,
    });
  }

  const animes: WitHomeAnime[] = [];
  const seenAn = new Set<string>();
  for (const e of animeList?.itemListElement ?? []) {
    const it = e?.item ?? e;
    const href = typeof it?.url === "string" ? it.url : "";
    const title = a3rbCleanName(typeof it?.name === "string" ? it.name : "");
    if (!href || !title || seenAn.has(href)) continue;
    seenAn.add(href);
    animes.push({
      title,
      href,
      image: typeof it?.image === "string" ? it.image : null,
      // The home rails filter on these exact markers ("TV"/"Movie").
      type: typeof it?.["@type"] === "string" && /movie/i.test(it["@type"]) ? "Movie" : "TV Series",
      status: null,
      description: typeof it?.description === "string" ? it.description : null,
      isNew: true,
      rating: null,
    });
  }

  if (!episodes.length && !animes.length) return null;
  // Hero: latest-added titles carry a real synopsis, so they fill the featured
  // slider better than the pinned-works episode list.
  const featured: WitHomeFeatured[] = animes.slice(0, 5).map((a) => ({
    title: a.title, href: a.href, image: a.image, description: a.description, genres: [],
  }));
  return { featured, animes, episodes };
}

// Episode number for an anime4up link. The URL slug is NOT reliable: anime4up
// uses random hash slugs (…-الحلقة-wtgjd/), so the number must come from the
// anchor's title attribute ("… الحلقة 20"). Falls back to the slug only when a
// title number is unavailable (older pages embed the number in the URL).
function up4EpisodeNumber(href: string, title?: string): number | null {
  if (title) {
    const tm = title.match(/الحلقة\s*(\d+)/) || title.match(/\bepisode\s*(\d+)/i) || title.match(/\bep\s*(\d+)/i);
    if (tm) return parseInt(tm[1], 10);
  }
  if (!href) return null;
  try {
    const d = decodeURIComponent(href);
    // Only trust a URL number when it directly follows الحلقة (…-الحلقة-21-…).
    // A bare trailing -\d+ would wrongly match hash slugs, so don't use it.
    const m = d.match(/الحلقة[\s-]+(\d+)\b/);
    if (m) return parseInt(m[1], 10);
  } catch {}
  return null;
}

// Parse an anime4up anime page's episode list straight from static HTML.
export function parseUp4Episodes(
  html: string,
): { title: string; number: number; type: string; screenshot: string; href: string }[] {
  // Current pages use a real .anime-grid element; matching the old class name
  // with indexOf hit its CSS declaration and sliced away every episode card.
  const grid = /<div[^>]*class=["'][^"']*\banime-grid\b[^"']*["'][^>]*>/i.exec(html);
  if (grid?.index != null) {
    const rest = html.slice(grid.index);
    const pagination = /<(?:div|nav)[^>]*class=["'][^"']*\bpagination\b/i.exec(rest);
    html = rest.slice(0, pagination?.index);
  }
  const out: { title: string; number: number; type: string; screenshot: string; href: string }[] = [];
  const seen = new Set<string>();
  // Match an episode anchor and grab the whole opening tag so title= (which may
  // appear before OR after href=) is in scope.
  const re = /<a\b([^>]*\bhref=["'][^"']*\/episode\/[^"']+["'][^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tag = m[1] || "";
    const hrefM = tag.match(/\bhref=["']([^"']+)["']/i);
    if (!hrefM) continue;
    let href = (hrefM[1] || "").trim();
    if (!href) continue;
    if (href.indexOf("http") !== 0) href = href.indexOf("//") === 0 ? "https:" + href : UP4_BASE + (href.charAt(0) === "/" ? "" : "/") + href;
    if (seen.has(href)) continue;
    const titleM = tag.match(/\btitle=["']([^"']*)["']/i);
    const title = titleM ? titleM[1] : undefined;
    const num = up4EpisodeNumber(href, title);
    if (num == null) continue;
    seen.add(href);
    out.push({ title: "الحلقة " + num, number: num, type: "", screenshot: "", href });
  }
  out.sort((a, b) => a.number - b.number);
  return out;
}

function up4PageUrl(animeUrl: string, page: number): string {
  const base = animeUrl.replace(/\/+$/, "");
  return page <= 1 ? base + "/" : `${base}/page/${page}/`;
}

function up4MaxPage(html: string): number {
  let max = 1;
  const re = /\/page\/(\d+)\//g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const v = parseInt(m[1], 10);
    if (!isNaN(v) && v > max) max = v;
  }
  return max;
}

// anime4up PAGINATES anime episode lists (newest-first, ~40 episodes per page;
// One Piece spans 25 pages), so a page-1 parse only ever sees the newest chunk.
// Episodes older than that chunk used to be unresolvable — the cross-source
// lookup found the anime page, parsed page 1, missed the episode, and anime4up
// servers NEVER showed for it no matter how often it retried. This walks the
// pagination toward the requested episode number instead: estimate the target
// page from the numbers on page 1, fetch it, and correct the estimate from
// what that page actually shows. Bounded to a handful of fetches.
export async function findUp4EpisodeAcrossPages(
  animeUrl: string,
  epNumber: number,
): Promise<string | null> {
  const html = await fetchHtml(animeUrl, UP4_BASE + "/");
  if (!html) return null;
  const eps = parseUp4Episodes(html);
  const hit = eps.find((e) => e.number === epNumber);
  if (hit) return hit.href;
  if (eps.length === 0) return null;
  const maxPage = up4MaxPage(html);
  if (maxPage <= 1) return null;
  const lo = eps[0].number;
  const hi = eps[eps.length - 1].number;
  const perPage = Math.max(eps.length, 1);
  // Episode within page 1's range but absent → a numbering gap (special /
  // movie), not a pagination miss; other pages won't have it either.
  if (epNumber >= lo && epNumber <= hi) return null;
  // First estimate. Direction-agnostic: newest-first lists put older episodes
  // on higher pages (epNumber < lo), oldest-first the reverse — the correction
  // loop below converges either way because it re-reads each page's range.
  const clamp = (p: number) => Math.min(Math.max(p, 2), maxPage);
  let page = clamp(
    1 + Math.ceil((epNumber < lo ? lo - epNumber : epNumber - hi) / perPage),
  );
  const visited = new Set<number>([1]);
  for (let i = 0; i < 5; i++) {
    if (visited.has(page)) break;
    visited.add(page);
    const ph = await fetchHtml(up4PageUrl(animeUrl, page), UP4_BASE + "/");
    if (!ph) return null;
    const pe = parseUp4Episodes(ph);
    if (pe.length === 0) return null;
    const phit = pe.find((e) => e.number === epNumber);
    if (phit) return phit.href;
    const plo = pe[0].number;
    const phi = pe[pe.length - 1].number;
    // Within this page's range but missing → a numbering gap, stop.
    if (epNumber >= plo && epNumber <= phi) return null;
    // Derive the sort order by comparing this page's numbers to page 1's:
    // anime4up lists newest-first (numbers DECREASE as the page increases),
    // but derive it rather than assume so an ordering flip can't strand us.
    const numbersDecreaseWithPage = phi < lo;
    const distance = epNumber < plo ? plo - epNumber : epNumber - phi;
    const step = Math.max(1, Math.ceil(distance / perPage));
    const needLowerNumbers = epNumber < plo;
    page = clamp(needLowerNumbers === numbersDecreaseWithPage ? page + step : page - step);
  }
  return null;
}

// Read anime4up's server list straight from the episode page HTML. anime4up
// serves every server as a <li data-watch="EMBED_URL"><a>NAME</a></li> in the
// initial response, so a single GET returns all servers fast and reliably —
// the WebView render trips anime4up's ad redirects / JS gates and frequently
// comes back empty.
export function parseUp4Servers(html: string): RawServer[] {
  // Constrain to the #episode-servers list when present to avoid menu/li noise.
  let scope = html;
  const segStart = html.indexOf('id="episode-servers"');
  if (segStart >= 0) {
    const segEnd = html.indexOf("</ul>", segStart);
    if (segEnd > segStart) scope = html.slice(segStart, segEnd);
  }
  const out: RawServer[] = [];
  const seen = new Set<string>();
  const re = /<li[^>]*\sdata-watch=["']([^"']+)["'][^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(scope))) {
    const src = normalizeEmbedUrl((m[1] || "").trim());
    if (!src || src.indexOf("http") !== 0 || seen.has(src)) continue;
    if (/google|facebook|pyppo|popads|disqus/.test(src)) continue;
    try {
      const h = new URL(src).hostname.toLowerCase();
      if (!h || h === "undefined" || h === "null" || h.indexOf(".") < 0) continue;
    } catch { continue; }
    seen.add(src);
    const name = (m[2] || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() || `Server ${out.length + 1}`;
    out.push({ id: String(out.length), name, iframeUrl: src, provider: classifyProviderWithName(src, name) });
  }
  return out;
}

// Full episode-page parse (servers + display titles) from a single static GET.
// Used when the episode is an anime4up URL: the WebView render takes many
// seconds and frequently trips anime4up's ad gates, while the static HTML
// reliably carries the entire server list — so this path shows servers
// near-instantly. Returns null when the fetch fails or no servers parse, in
// which case the caller falls back to the WebView scrape.
export async function scrapeAnime4upEpisodePageDirect(
  episodeUrl: string,
): Promise<{ servers: RawServer[]; episodeTitle: string; animeTitle: string } | null> {
  const html = await fetchHtml(episodeUrl, UP4_BASE + "/");
  if (!html) return null;
  const servers = parseUp4Servers(html);
  if (servers.length === 0) return null;
  const deent = (s: string) =>
    s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
  // Episode title: prefer the page heading, fall back to <title> minus the
  // site-name suffix.
  let episodeTitle = "";
  const h3 = html.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
  if (h3) episodeTitle = deent(h3[1].replace(/<[^>]+>/g, ""));
  if (!episodeTitle) {
    const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (t) episodeTitle = deent(t[1]).split(/\s*[|–-]\s*(?:anime4up|أنمي فور أب).*/i)[0].trim();
  }
  // Anime title: the breadcrumb/anime-page link, else strip "الحلقة N" off
  // the episode title.
  let animeTitle = "";
  const link = html.match(/anime-page-link[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)
    || html.match(/<a[^>]*href=["'][^"']*\/anime\/[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
  if (link) animeTitle = deent(link[1].replace(/<[^>]+>/g, ""));
  if (!animeTitle && episodeTitle) {
    animeTitle = episodeTitle.replace(/الحلقة\s*\d+.*$/, "").replace(/\bepisode\s*\d+.*$/i, "").trim();
  }
  return { servers, episodeTitle, animeTitle };
}

/* ── witanime direct server decode ── */
// witanime no longer ships plain server iframes. Each episode page carries an
// obfuscated registry — `_zX` = a base64 JSON array of reversed+base64 embed
// URLs, `_zK` = per-server decode config — that the site's gh100.js
// `renderModuleContent()` decodes on click. The WebView scrape depends on those
// clicks firing past witanime's Cloudflare gate and frequently comes back empty
// → "no servers". Decode the registry straight from the static HTML instead
// (mirrors the anime4up direct path). Ported 1:1 from gh100.js.
// ponytail: FRAMEWORK_HASH is hardcoded in gh100.js and only yonaplay embeds
// need it; if witanime rotates it, re-read gh100.js.
const WIT_FRAMEWORK_HASH = "23a97133-caf3-4eb4-9466-93d0a4ff8198";

// base64 → binary (latin1) string. Hand-rolled because atob/Buffer aren't
// reliably present in the RN runtime (same reason profile.ts hand-rolls it).
// Matches atob() output for witanime's registry (verified on live pages).
function b64ToBinary(b64: string): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const lookup: Record<string, number> = {};
  for (let i = 0; i < chars.length; i++) lookup[chars[i]] = i;
  const clean = String(b64).replace(/[^A-Za-z0-9+/]/g, "");
  let out = "";
  for (let i = 0; i < clean.length; i += 4) {
    const e1 = lookup[clean[i]], e2 = lookup[clean[i + 1]];
    const e3 = lookup[clean[i + 2]], e4 = lookup[clean[i + 3]];
    if (e1 === undefined || e2 === undefined) break;
    out += String.fromCharCode((e1 << 2) | (e2 >> 4));
    if (e3 !== undefined) out += String.fromCharCode(((e2 & 15) << 4) | (e3 >> 2));
    if (e4 !== undefined) out += String.fromCharCode(((e3 & 3) << 6) | e4);
  }
  return out;
}

function witDecodeServer(res: string, cfg: { d?: number[]; k?: string }): string | null {
  try {
    if (!res || !cfg || !Array.isArray(cfg.d) || !cfg.k) return null;
    const s = res.split("").reverse().join("").replace(/[^A-Za-z0-9+/=]/g, "");
    const off = cfg.d[parseInt(b64ToBinary(cfg.k), 10)];
    if (off == null || off < 0) return null;
    const decoded = b64ToBinary(s);
    let out = decoded.slice(0, decoded.length - off);
    if (/^https:\/\/yonaplay\.net\/embed\.php\?id=\d+$/.test(out)) out += "&apiKey=" + WIT_FRAMEWORK_HASH;
    return out;
  } catch { return null; }
}

export function parseWitServers(html: string): RawServer[] {
  const zx = html.match(/_zX\s*=\s*"([^"]+)"/) || html.match(/_zH\s*=\s*"([^"]+)"/);
  const zk = html.match(/_zK\s*=\s*"([^"]+)"/) || html.match(/_zW\s*=\s*"([^"]+)"/);
  if (!zx || !zk) return [];
  let reg: string[], cfg: { d?: number[]; k?: string }[];
  try {
    reg = JSON.parse(b64ToBinary(zx[1]));
    cfg = JSON.parse(b64ToBinary(zk[1]));
  } catch { return []; }
  if (!Array.isArray(reg) || !Array.isArray(cfg)) return [];
  // Server labels sit in <span class="ser"> in data-server-id (= registry) order.
  const names: string[] = [];
  const nre = /<span[^>]*class=["']ser["'][^>]*>([\s\S]*?)<\/span>/gi;
  let nm: RegExpExecArray | null;
  while ((nm = nre.exec(html))) names.push(nm[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
  const out: RawServer[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < reg.length; i++) {
    const url = witDecodeServer(reg[i], cfg[i]);
    if (!url || url.indexOf("http") !== 0 || seen.has(url)) continue;
    if (/google|facebook|pyppo|popads|disqus/.test(url)) continue;
    try {
      const h = new URL(url).hostname.toLowerCase();
      if (!h || h === "undefined" || h === "null" || h.indexOf(".") < 0) continue;
    } catch { continue; }
    seen.add(url);
    out.push({ id: String(out.length), name: names[i] || `Server ${out.length + 1}`, iframeUrl: normalizeEmbedUrl(url), provider: classifyProvider(url) });
  }
  return out;
}

// Full witanime episode-page parse (servers + display titles) from one static
// GET. Returns null on fetch/decode failure so the caller falls back to the
// WebView scrape (older episodes predating the _zX/_zK scheme still render
// plain iframes).
export async function scrapeWitanimeEpisodePageDirect(
  episodeUrl: string,
): Promise<{ servers: RawServer[]; episodeTitle: string; animeTitle: string } | null> {
  const base = await getWitBase();
  const html = await fetchHtml(rewriteWitUrl(episodeUrl, base), base + "/");
  if (!html) return null;
  const servers = parseWitServers(html);
  if (servers.length === 0) return null;
  const deent = (s: string) =>
    s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
  let episodeTitle = "";
  const h3 = html.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
  if (h3) episodeTitle = deent(h3[1].replace(/<[^>]+>/g, ""));
  let animeTitle = "";
  const link = html.match(/anime-page-link[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
  if (link) animeTitle = deent(link[1].replace(/<[^>]+>/g, ""));
  if (!animeTitle && episodeTitle) animeTitle = episodeTitle.replace(/الحلقة\s*\d+.*$/, "").trim();
  return { servers, episodeTitle, animeTitle };
}

/* ── anime3rb (third server source) ── */
// anime3rb serves its pages statically (Laravel/Livewire — the full payload
// is in the initial HTML) and uses PREDICTABLE URLs: /titles/<slug> for the
// anime page and /episode/<slug>/<number> for episodes, with clean
// Str::slug-style slugs ("Dr. Stone: Science Future Part 3" →
// dr-stone-science-future-part-3). So the whole resolution chain is: derive
// candidate slugs from the title → probe /titles/<slug> (a miss is a fast
// 404) → construct the episode URL directly. /search sits behind a Cloudflare
// managed challenge, so free-text search is replaced by sitemap catalog
// matching (below) — never the challenge-gated endpoint.

function a3rbSlugify(s: string): string {
  return (s || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics (é → e)
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function a3rbOrdinal(n: number): string {
  return n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;
}

// Candidate slugs for a title, most-specific first. anime3rb's season naming
// is inconsistent ("kanojo-okarishimasu-5th-season" but "dorohedoro-season-2"),
// so when the title carries a season marker we emit every common shape. The
// bare base name is only probed for season 1 — matching season 1's page for a
// later season would resolve to the WRONG episodes (numbering restarts).
// Parenthesized alternative names get their own variant set: witanime often
// appends the romaji original in parens ("Blades of the Guardians Season 2
// (Biao Ren 2)") and anime3rb may index the anime ONLY under that name.
// `full` = the slug is an EXACT, complete slugification of the whole title (or a
// whole parenthesized alt name) — not a colon-split / season / truncation form.
// An exact full slug landing on a live page is a confident match on its own
// (anime3rb slugs are unique, so there's nothing to collide with), so the caller
// can accept it WITHOUT the og:title language-match guard — which is what lets a
// cross-language title resolve (English "one piece" → anime3rb's Arabic-og:title
// /titles/one-piece page). Reduced forms keep the strict guard since a truncated
// slug ("kanojo" for "Kanojo, Okarishimasu") could land on a different anime.
function a3rbSlugVariants(title: string): { slug: string; full: boolean }[] {
  const out: { slug: string; full: boolean }[] = [];
  const add = (s: string, full: boolean) => {
    const v = a3rbSlugify(s);
    if (v && !out.some((o) => o.slug === v)) out.push({ slug: v, full });
  };
  const forms: string[] = [title];
  const reParen = /[\(\[]([^\)\]]+)[\)\]]/g;
  let pm: RegExpExecArray | null;
  while ((pm = reParen.exec(title))) { const p = pm[1].trim(); if (p) forms.push(p); }
  for (const form of forms) {
    const cleaned = form
      .replace(/[\(\[][^\)\]]*[\)\]]/g, " ")
      // Episode markers leak into titles derived from episode pages/URLs
      // ("… الحلقة 11", "… Episode 11") — and a percent-encoded الحلقة arrives
      // as "%D8%A7%D9%84… 11" junk. Strip all of it or every slug guess 404s.
      .replace(/الحلقة\s*\d+.*$/, " ")
      .replace(/\bepisodes?\s*\d+.*$/i, " ")
      .replace(/(?:%[0-9a-f]{2})+[\s\d]*$/gi, " ") // trailing junk drags its episode number along
      .replace(/(?:%[0-9a-f]{2})+/gi, " ")
      .replace(/\s+/g, " ").trim();
    // Exact, complete slugifications of the full form — confident on existence.
    add(cleaned, true);
    // Laravel's Str::slug DROPS a colon that touches both words instead of
    // dashing it: "Re:Zero kara…" lives at rezero-kara-…, not re-zero-kara-….
    add(cleaned.replace(/(\S)[:：](\S)/g, "$1$2"), true);
    // Dotted acronyms slugify letter-by-letter ("A.I.C.O." → a-i-c-o) but
    // anime3rb collapses them ("aico-incarnation"). Strip the dots inside any
    // run of single letters so the collapsed slug ("aico") is also probed.
    const collapsedAcr = cleaned.replace(/\b[a-z](?:\.[a-z]){1,}\.?/gi, (m) => m.replace(/\./g, ""));
    if (collapsedAcr !== cleaned) add(collapsedAcr, true);
    // Reduced / truncated forms — keep the strict title-score guard.
    add(cleaned.split(/\s*[:：]\s*/)[0], false);
    const seasonM =
      cleaned.match(/\b(\d+)(?:st|nd|rd|th)\s+season\b/i) ||
      cleaned.match(/\bseason\s+(\d+)\b/i) ||
      cleaned.match(/\bpart\s+(\d+)\b/i);
    if (seasonM) {
      const n = parseInt(seasonM[1], 10);
      const base = cleaned
        .replace(/\b(?:the\s+)?(?:\d+(?:st|nd|rd|th)\s+season|season\s+\d+|part\s+\d+)\b/i, " ")
        .replace(/\s+/g, " ").trim();
      if (base && !isNaN(n)) {
        add(`${base} ${a3rbOrdinal(n)} season`, false);
        add(`${base} season ${n}`, false);
        add(`${base} part ${n}`, false);
        add(`${base} ${n}`, false);
        if (n === 1) add(base, false);
      }
    }
  }
  return out.slice(0, 12);
}

// Probe /titles/<slug> and verify the page's own title actually matches the
// wanted anime (same >=34 threshold as the other cross-source matchers) so a
// coincidental slug can't hijack the match. Returns the page URL or null.
// `relaxed` skips the title-score guard for an exact full-title slug (see
// a3rbSlugVariants): the page exists, the slug is unique, so it IS the anime —
// even when its og:title is in a different language than the query.

// What the caller knows about the wanted anime beyond its name (AniList).
// Used to reject a same-name page from the WRONG franchise entry — an old
// film vs a new TV remake share the base name ("koukaku-kidoutai" 1995 vs
// "koukaku-kidoutai-tv" 2026), which title scoring alone can't tell apart.
export type A3rbWant = { year: number | null; isMovie: boolean | null } | null;

// anime3rb's SEO meta description ends with the airing season + year
// ("…أنميات خريف 1995" film, "…أنميات صيف 2026" series) and its og:title
// opens with the format word ("فيلم …" film, "أنمي …" series). Both are in
// <head>, so the first chunk of HTML is enough. Missing markers yield nulls
// (no rejection).
export function a3rbPageYearType(html: string): { year: number | null; isMovie: boolean | null } {
  const head = html.slice(0, 12000);
  const ym = head.match(/(?:أنميات\s+\S+|عام|سنة)\s+((?:19|20)\d{2})/);
  const tm =
    head.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) ||
    head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const og = tm ? tm[1].replace(/^\s+/, "") : "";
  const isMovie = /^فيلم\s/.test(og) ? true : (/^(?:أنمي|انمي)\s/.test(og) ? false : null);
  return { year: ym ? parseInt(ym[1], 10) : null, isMovie };
}

// Reject a page when the caller's known year/format contradicts it. A ±1-year
// tolerance absorbs premiere-year boundary cases (a show listed 2025 on one
// side and 2026 on the other); franchise entries are years apart, so the
// tolerance never saves a wrong one. Only the series→film direction is checked
// for format (the reported bug: a new TV series resolving to the old film).
export function a3rbWantRejects(want: A3rbWant, html: string): boolean {
  if (!want) return false;
  const pt = a3rbPageYearType(html);
  if (want.year != null && pt.year != null && Math.abs(pt.year - want.year) > 1) return true;
  if (want.isMovie === false && pt.isMovie === true) return true;
  return false;
}

async function probeA3rbTitlePage(slug: string, title: string, relaxed = false, want: A3rbWant = null): Promise<string | null> {
  const url = `${A3RB_BASE}/titles/${slug}`;
  const html = await fetchAnime3rbHtml(url, "og:title");
  if (!html) return null; // 404 / fetch failure
  if (a3rbWantRejects(want, html)) return null; // same base name, wrong franchise entry
  if (relaxed) return url; // exact full slug on a live page — confident match
  const tm =
    html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) ||
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  // anime3rb's og:title now uses a plain hyphen separator
  // ("<name> مترجم - Anime3rb أنمي عرب"), so the strip must include "-" (as the
  // sibling scrapeAnime3rbTitlePage already does) — otherwise the match score is
  // computed against the trailing "Anime3rb أنمي عرب" junk.
  const got = tm ? tm[1].replace(/\s*[|–-]\s*Anime3rb.*$/i, "").trim() : slug.replace(/-+/g, " ");
  return tm_score(title, got) >= 34 ? url : null;
}

// Probe /titles/<slug> for each candidate slug shape derived from the title.
export async function searchAnime3rbDirect(title: string, want: A3rbWant = null): Promise<string | null> {
  if (!title) return null;
  for (const { slug, full } of a3rbSlugVariants(title)) {
    const url = await probeA3rbTitlePage(slug, title, full, want);
    if (url) return url;
  }
  return null;
}

// The EXACT, complete slug guesses for a title (the `full` variants only). The
// watch path uses these to build an episode URL DIRECTLY and skip a separate
// title-page fetch — the episode page itself proves the slug. Reduced/season
// variants are intentionally excluded here (they could land on a different
// anime, which only the title-score guard catches).
export function anime3rbExactSlugs(title: string): string[] {
  return a3rbSlugVariants(title).filter((v) => v.full).map((v) => v.slug);
}

/* ── anime3rb catalog (sitemap) matching ── */
// /search sits behind a Cloudflare managed challenge, so free-text search is
// effectively dead. But anime3rb publishes a daily titles sitemap (~6300
// slugs, one plain GET, no Cloudflare) — fuzzy-matching the wanted title
// against the whole catalog finds anime whose slug can't be guessed from the
// witanime title: different romanization (Re:Zero → rezero-…), an anime
// indexed only under its alternative name, or a shortened witanime title
// ("Yuusha no Rokkotsu de" lives at megami-isekai-tensei-…-ore-yuusha-no-rokkotsu-de).
let a3rbCatalog: { slugs: string[]; ts: number } | null = null;
const A3RB_CATALOG_TTL = 6 * 60 * 60 * 1000;

async function fetchA3rbCatalog(): Promise<string[]> {
  if (a3rbCatalog && Date.now() - a3rbCatalog.ts < A3RB_CATALOG_TTL) return a3rbCatalog.slugs;
  const xml = await fetchHtml(
    `${A3RB_BASE}/storage/sitemaps/titles_sitemap.xml`,
    A3RB_BASE + "/",
  );
  if (!xml) return a3rbCatalog?.slugs ?? [];
  const slugs: string[] = [];
  const re = /<loc>\s*https?:\/\/anime3rb\.com\/titles\/([^<\s]+?)\/?\s*<\/loc>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    try { slugs.push(decodeURIComponent(m[1])); } catch { slugs.push(m[1]); }
  }
  if (slugs.length > 0) a3rbCatalog = { slugs, ts: Date.now() };
  return slugs;
}

// Season number for a catalog slug / title. Falls back to a small trailing
// number ("haikyuu-2" style naming) — capped low so number-bearing titles
// (mob-psycho-100) aren't misread as season markers.
function a3rbSeasonOf(label: string): number {
  const k = tm_seasonNum(label);
  if (k !== 1) return k;
  const t = label.match(/(?:^|[\s-])(\d{1,2})$/);
  if (t) {
    const v = parseInt(t[1], 10);
    if (v >= 2 && v <= 20) return v;
  }
  return 1;
}

// Conservative matcher: a wrong match plays the WRONG anime's episodes, so it
// requires near-total coverage of the wanted title's tokens, an exact season
// match, and (for short titles) near-total coverage of the slug's tokens too.
function a3rbCatalogMatch(title: string, slugs: string[]): string | null {
  // Want-forms: the full title, every parenthesized alternative name, and a
  // tight-colon-joined copy of each (Str::slug turns "Re:Zero" into "rezero").
  const rawForms: string[] = [title];
  const reParen = /[\(\[]([^\)\]]+)[\)\]]/g;
  let pm: RegExpExecArray | null;
  while ((pm = reParen.exec(title))) { const p = pm[1].trim(); if (p) rawForms.push(p); }
  type Want = { set: Record<string, true>; n: number; season: number };
  const wants: Want[] = [];
  for (const f of rawForms) {
    for (const v of [f, f.replace(/(\S)[:：](\S)/g, "$1$2")]) {
      const toks = tm_toks(tm_normLatin(v));
      if (!toks.length) continue;
      const set: Record<string, true> = {};
      toks.forEach((t) => { set[t] = true; });
      wants.push({ set, n: toks.length, season: a3rbSeasonOf(v.toLowerCase()) });
    }
  }
  if (!wants.length) return null;
  let best: { slug: string | null; score: number } = { slug: null, score: 0 };
  for (const slug of slugs) {
    const label = slug.replace(/[-_]+/g, " ");
    const gotToks = tm_toks(tm_normLatin(label));
    if (!gotToks.length) continue;
    const gotSeason = a3rbSeasonOf(label);
    for (const w of wants) {
      // Wrong season page = wrong episode numbering. Hard reject.
      if (gotSeason !== w.season) continue;
      let gc = 0;
      const gotSet: Record<string, true> = {};
      for (const t of gotToks) { gotSet[t] = true; if (w.set[t]) gc++; }
      let wc = 0;
      for (const t in w.set) { if (gotSet[t]) wc++; }
      const wantCov = wc / w.n;
      const gotCov = gc / gotToks.length;
      // Containment: the slug's ENTIRE name appears inside the wanted title
      // (with enough tokens to be non-coincidental). Catches witanime titles
      // that concatenate the English and romaji names — especially the
      // slug-derived title, where "X (Y)" arrives flattened as "x y" and no
      // single name covers 80% of the combined token set.
      const contained = gotCov === 1 && gc >= 4;
      const ok = contained || (
        w.n >= 3 ? wantCov >= 0.8 :
        w.n === 2 ? wantCov === 1 && gotCov >= 0.6 :
        wantCov === 1 && gotCov === 1);
      if (!ok) continue;
      const score = wantCov * 60 + gotCov * 40;
      if (score > best.score) best = { slug, score };
    }
  }
  return best.slug;
}

export async function searchAnime3rbCatalog(title: string, want: A3rbWant = null): Promise<string | null> {
  if (!title) return null;
  const slugs = await fetchA3rbCatalog();
  if (!slugs.length) return null;
  const slug = a3rbCatalogMatch(title, slugs);
  if (!slug) return null;
  // Confirm against the real page's own title before trusting the match.
  return probeA3rbTitlePage(slug, title, false, want);
}

// Family disambiguation: franchises with BOTH an old film and a new TV remake
// share one base slug ("koukaku-kidoutai" 1995 film vs "koukaku-kidoutai-tv"
// 2026 series). Neither the slug guesses (they never emit the "-tv" form) nor
// the strict catalog matcher (its token coverage rejects both) can find the
// new entry, so the resolver used to lock onto the OLD film and play its
// "episode 1". With a known year/format, scan the same-base slug family and
// take the entry whose page year/format matches — the only reliable
// discriminator. Runs only when a year/format is known AND the family has 2+
// entries, so ordinary anime pay zero extra fetches.
export async function searchAnime3rbFamily(title: string, want: A3rbWant): Promise<string | null> {
  if (!title || !want || (want.year == null && want.isMovie == null)) return null;
  const head = title.replace(/[\(\[][^\)\]]*[\)\]]/g, " ").split(/\s*[:：]\s*/)[0].trim();
  const base = a3rbSlugify(head);
  if (!base || base.length < 4) return null;
  const slugs = await fetchA3rbCatalog();
  const family = slugs.filter((s) => s === base || s.startsWith(base + "-")).slice(0, 15);
  if (family.length < 2) return null;
  let best: { url: string; score: number } | null = null;
  for (const slug of family) {
    const url = `${A3RB_BASE}/titles/${slug}`;
    const html = await fetchAnime3rbHtml(url, "og:title");
    if (!html || a3rbWantRejects(want, html)) continue;
    const tm =
      html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) ||
      html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const got = tm ? tm[1].replace(/\s*[|–-]\s*Anime3rb.*$/i, "").trim() : slug.replace(/-+/g, " ");
    const sc = tm_score(title, got);
    if (sc >= 34 && (!best || sc > best.score)) best = { url, score: sc };
  }
  return best?.url ?? null;
}

// Typo-tolerant catalog ranking for the SEARCH screen (not the watch path).
// a3rbCatalogMatch above is deliberately strict — a wrong match there plays the
// WRONG anime's episodes. But on the search screen the user PICKS from the
// list, so we can afford to be lenient: fuzzy-rank every catalog slug against
// the query (absorbing one-letter typos, dropped colons, and spacing
// differences via fuzzyScore) and return the strongest candidates so a
// misspelled / oddly-spaced query still surfaces the anime. Pure local compute
// over the cached sitemap — no extra network until the caller fetches a result
// it wants to show. The wanted-season is a soft preference (the user can pick a
// different season), not a hard filter.
export async function searchAnime3rbCatalogFuzzy(
  title: string,
  limit = 5,
): Promise<{ slug: string; score: number }[]> {
  if (!title) return [];
  const slugs = await fetchA3rbCatalog();
  if (!slugs.length) return [];
  const wantSeason = a3rbSeasonOf(title.toLowerCase());
  const scored: { slug: string; score: number }[] = [];
  for (const slug of slugs) {
    const label = slug.replace(/[-_]+/g, " ");
    const score = fuzzyScore(title, label);
    if (score < 0.62) continue;
    const adj = a3rbSeasonOf(label) === wantSeason ? 0.04 : -0.08;
    scored.push({ slug, score: score + adj });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/* ── anime3rb: anime (title) page → detail + full episode list ──
 * anime3rb `/titles/<slug>` pages are server-rendered, so a single GET carries
 * the poster (og:image), synopsis (og:description), and — crucially — every
 * episode as a predictable `/episode/<slug>/<n>` link. We parse those links to
 * build a complete, numbered, directly-playable episode list. Used both to add
 * anime3rb's episodes into the detail page's cross-source union (so episodes
 * missing from witanime/anime4up still show) and to open anime3rb-only anime
 * as a first-class detail page. */

export type A3rbEpisode = { title: string; number: number; type: string; screenshot: string; href: string };
export type A3rbDetail = {
  title: string;
  poster: string;
  synopsis: string;
  genres: string[];
  episodes: A3rbEpisode[];
};

function a3rbMetaContent(html: string, prop: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`,
    "i",
  );
  const m = html.match(re) || html.match(
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, "i"),
  );
  return m ? htmlDecode(m[1]) : null;
}

// Pull every episode number anime3rb links for THIS title's slug, then build
// the full contiguous 1..max list. anime3rb numbers episodes from 1 with no
// gaps for standard series, and its URLs are constructible, so filling the
// range guarantees the user sees every episode (including ones the page only
// exposes through its "load more" control) — each card is a valid, playable
// URL. The parsed set is used to cap the range so we never invent episodes
// beyond what the site actually has.
function parseA3rbEpisodesFromTitle(html: string, slug: string): A3rbEpisode[] {
  const nums = new Set<number>();
  // anime3rb is Livewire-rendered: episode links appear both as plain <a href>
  // and inside JSON snapshots where slashes are escaped (…\/episode\/slug\/11).
  // Unescape so a single scan catches both forms.
  html = html.replace(/\\\//g, "/");
  // Slug may be percent-encoded in the page's hrefs; compare decoded forms.
  const wantSlug = slug.toLowerCase();
  const re = /\/episode\/([^/"'\s\\]+)\/(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let s = m[1];
    try { s = decodeURIComponent(s); } catch {}
    if (s.toLowerCase() !== wantSlug) continue;
    const n = parseInt(m[2], 10);
    if (!isNaN(n) && n > 0 && n < 5000) nums.add(n);
  }
  if (nums.size === 0) return [];
  const max = Math.max(...nums);
  const out: A3rbEpisode[] = [];
  for (let n = 1; n <= max; n++) {
    out.push({
      title: "الحلقة " + n,
      number: n,
      type: "",
      screenshot: "",
      href: `${A3RB_BASE}/episode/${slug}/${n}`,
    });
  }
  return out;
}

// Pull the real story from an anime3rb title page body. The synopsis is split
// across `leading-loose text-justify` paragraphs (the page renders a collapsed
// first-paragraph copy plus a full copy under an Alpine toggle), so collect
// every distinct paragraph and join them. Returns "" when none are found.
function parseA3rbSynopsis(html: string): string {
  // CRUCIAL: scope to the story block only. anime3rb reuses the
  // `leading-loose text-justify` paragraph class for the cards in its
  // "related works" / seasons grid (genres + season + year + rating + episode
  // count + a synopsis snippet each). A page-wide scan swept those in and the
  // detail page showed a wall of per-season blocks instead of the real story.
  // The story lives in the default-visible block `<div … x-show="! summary">`;
  // its sibling `x-show="summary"` is the short version and the toggle button
  // follows — slice between them so only the real summary paragraphs match.
  const start = html.indexOf('x-show="! summary"');
  if (start < 0) return ""; // structure changed → caller falls back to og:description
  let end = html.indexOf('x-show="summary"', start);
  if (end < 0) end = html.indexOf("summary = ! summary", start);
  const scope = html.slice(start, end > start ? end : start + 8000);
  const re = /<p[^>]*class=["'][^"']*leading-loose[^"']*text-justify[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  const parts: string[] = [];
  // Belt-and-suspenders: even within the story block, reject any paragraph that
  // smells like a listing/card row — a rating label ("التقييم"), an episode
  // count ("N حلقات"), or an air-season+year badge ("صيف 1998"). This guarantees
  // a layout change can never leak the seasons/related grid into the synopsis.
  const JUNK = /التقييم|\d+\s*حلقات|(?:صيف|شتاء|ربيع|خريف)\s*\d{4}/;
  while ((m = re.exec(scope))) {
    const txt = htmlDecode(m[1].replace(/<[^>]+>/g, ""));
    if (!txt || seen.has(txt) || JUNK.test(txt)) continue;
    seen.add(txt);
    parts.push(txt);
  }
  return parts.join("\n\n");
}

// Scrape a full anime3rb anime page (detail + episodes). Returns null on a
// fetch/parse failure so callers degrade gracefully to the other sources.
export async function scrapeAnime3rbTitlePage(titleUrl: string): Promise<A3rbDetail | null> {
  const html = await fetchAnime3rbHtml(titleUrl, "og:title");
  if (!html) return null;
  const slug = decodeURIComponent(titleUrl.replace(/\/+$/, "").split("/").pop() || "");
  if (!slug) return null;

  const ogTitle = a3rbMetaContent(html, "og:title");
  let title = ogTitle || "";
  if (!title) {
    const tm = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (tm) title = htmlDecode(tm[1]);
  }
  title = title.replace(/\s*[|–-]\s*Anime3rb.*$/i, "").trim() || slug.replace(/-+/g, " ");

  const poster = a3rbMetaContent(html, "og:image") || "";
  // Story comes ONLY from the page-body story block (parseA3rbSynopsis). We do
  // NOT fall back to og:description: on anime3rb it's SEO boilerplate ("مشاهدة و
  // تحميل X - <alt names> - … Anime3rb أنمي عرب"), so falling back to it showed
  // that junk as the "synopsis". Better to leave it empty (the detail page just
  // hides the synopsis) than to display the boilerplate.
  const synopsis = parseA3rbSynopsis(html);

  // Genres: anime3rb links them under /genres/<name> (best-effort).
  const genres: string[] = [];
  const seenG = new Set<string>();
  const gre = /\/genres?\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/gi;
  let gm: RegExpExecArray | null;
  while ((gm = gre.exec(html)) && genres.length < 12) {
    const g = htmlDecode(gm[1].replace(/<[^>]+>/g, ""));
    if (g && !seenG.has(g)) { seenG.add(g); genres.push(g); }
  }

  const episodes = parseA3rbEpisodesFromTitle(html, slug);
  return { title, poster, synopsis, genres, episodes };
}

// Parse the anime3rb episode page's player out of the static HTML. The page
// is Livewire-rendered server-side: its wire:snapshot JSON carries video_url =
// https://video.vid3rb.com/player/<uuid>?token=…&expires=…, anime3rb's
// first-party player. That URL is both iframe-embeddable (the page serves
// X-Frame-Options: ALLOWALL) and the input extractVid3rb pulls direct
// tokenized .mp4 qualities from — so the native player path works end-to-end
// with two plain GETs.
export async function scrapeAnime3rbEpisodeServers(episodeUrl: string): Promise<RawServer[]> {
  const html = await fetchAnime3rbHtml(episodeUrl, "video_url");
  if (!html) return [];
  // The snapshot lives inside an HTML attribute, so quotes arrive as &quot;
  // and the URL as JSON-escaped https:\/\/… with &amp; between query params.
  const raw =
    html.match(/video_url&quot;:&quot;(https:[\s\S]*?)&quot;/)?.[1] ||
    html.match(/"video_url"\s*:\s*"(https:[\s\S]*?)"/)?.[1] ||
    null;
  if (!raw) return [];
  const playerUrl = raw.replace(/\\\//g, "/").replace(/&amp;/g, "&");
  try {
    const h = new URL(playerUrl).hostname.toLowerCase();
    if (!h || h.indexOf(".") < 0) return [];
  } catch { return []; }
  // Anime3rb is one server in the UI. Warm the player-source cache here so
  // playback still starts quickly, then let extractVid3rb choose the highest
  // available free quality internally. Individual 1080p/720p/480p entries made
  // quality look like separate servers and allowed accidental manual/automatic
  // quality switching while an episode was playing.
  await listVid3rbResolutions(playerUrl);
  return [{ id: "a3rb", name: "Anime3rb", iframeUrl: playerUrl, provider: "vid3rb" }];
}

// anime3rb's first-party video host (video.vid3rb.com). The /player/<uuid>
// page inlines a `video_sources` JSON array carrying direct tokenized .mp4
// URLs per quality (480p/720p/1080p), so a single cheap GET yields a stream
// the native player plays directly — the CDN URLs answer Range requests,
// need no Referer, and aren't IP-locked (their signed redirect carries
// noip=yes). Premium-gated qualities ship with an empty src and are skipped.
// Tokens expire in ~40 minutes, which is why extraction happens at play time
// rather than when the server list is built.
// mp4upload's embed page no longer ships its player config in Dean-Edwards
// packed JS — it now inlines `player.src({ type: "video/mp4", src: "…" })`
// in the initial static HTML (verified live 2026-06). The WebView extractor
// frequently times out on this page, so pull the URL with one plain GET the
// same way vid3rb/anime3rb is handled. The token in the .mp4 URL is bound to
// the UA that fetched the embed page — fetchHtml's BROWSER_UA matches the
// native player's playback UA, so the extracted URL stays valid.
export async function extractMp4upload(iframeUrl: string): Promise<{ url: string; type: "mp4" } | null> {
  const embedUrl = normalizeEmbedUrl(iframeUrl);
  for (const timeoutMs of [8000, 15000]) {
    const got = await fetchEmbed(embedUrl, timeoutMs, "https://www.mp4upload.com/");
    if (got.blocked) return null;
    const html = got.html;
    if (!html) continue;
    const url = extractMp4uploadUrl(html);
    if (url) return { url, type: "mp4" };
  }
  return null;
}

/* ── Direct embed resolvers: streamwish / doodstream ───────────────────────
 * These providers ship the real stream URL in the embed page's STATIC HTML
 * (packed JS / a pass_md5 endpoint), exactly like mp4upload. Resolving them
 * with one or two plain GETs takes ~1s where the WebView path burns up to 40s
 * (page + player JS + ads on a slow link, then the 28s collector loop) and
 * frequently times out — the "servers keep loading, then fail" complaint. The
 * WebView extractor stays as the fallback when the static parse comes back
 * empty (markup drift, new mirror, Cloudflare bot-block). */

const DECOY_RE =
  /test-videos\.co\.uk|bigbuckbunny|sample[-_.]|placeholder|tos\.mp4|googleapis\.com\/.*oggtheora|\/lol\/file\.mp4|doubleclick|adserv|\/vast|preroll|\/ads\//i;

// Embed hosts answer fast or not at all — a Cloudflare 403 won't clear on an
// immediate retry (the WebView fallback exists for exactly that case), so
// unlike fetchHtml this makes ONE attempt with the given budget and never
// retries statuses. Keeps the direct path cheap when a host is bot-blocking
// plain GETs: bail to the WebView in seconds instead of burning ~48s in
// escalating retries first.
// Returns the FINAL (post-redirect) URL too: doodstream mirrors 301 to a new
// domain (dsvplay → playmogo), and the pass_md5 endpoint + Referer must hit
// that final host, not the dead one. `blocked` marks a Cloudflare challenge
// (403/503 or a challenge body) so callers bail to the WebView NOW instead of
// spending their second attempt on a block that won't clear.
type EmbedPage = { html: string | null; finalUrl: string; blocked: boolean };
async function fetchEmbed(url: string, timeoutMs: number, referer?: string): Promise<EmbedPage> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ar,en;q=0.9",
        ...(referer ? { Referer: referer } : {}),
      },
    });
    const finalUrl = res.url || url;
    if (res.status === 403 || res.status === 503) return { html: null, finalUrl, blocked: true };
    if (!res.ok) return { html: null, finalUrl, blocked: false };
    const html = await res.text();
    if (looksLikeCfChallenge(html)) return { html: null, finalUrl, blocked: true };
    return { html, finalUrl, blocked: false };
  } catch {
    return { html: null, finalUrl: url, blocked: false };
  } finally {
    clearTimeout(t);
  }
}

function mediaType(url: string): "hls" | "mp4" {
  return /\.m3u8(\?|$)/i.test(url) ? "hls" : "mp4";
}

// Dean-Edwards unpacker — same algorithm as the WebView collector's.
function unpackPacked(p: string, a: number, c: number, k: string[]): string {
  const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const baseN = (n: number, r: number): string => {
    let s = "";
    while (n > 0) { s = chars[n % r] + s; n = Math.floor(n / r); }
    return s || "0";
  };
  while (c--) {
    if (k[c]) p = p.replace(new RegExp("\\b" + baseN(c, a) + "\\b", "g"), k[c]);
  }
  return p;
}

// Pull the first playable m3u8/mp4 out of arbitrary (possibly unpacked) text.
// Exported for the round-trip test in embedExtract.test.ts.
export function pickMediaUrl(text: string): string | null {
  const res = [
    /file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i,
    /file\s*:\s*["']([^"']+\.mp4[^"']*)["']/i,
    /sources\s*:\s*\[\s*\{\s*(?:type\s*:\s*["'][^"']*["']\s*,\s*)?file\s*:\s*["']([^"']+)["']/i,
    /src\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i,
    /src\s*:\s*["']([^"']+\.mp4[^"']*)["']/i,
    /source\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i,
    /source\s*:\s*["']([^"']+\.mp4[^"']*)["']/i,
  ];
  for (const re of res) {
    const m = text.match(re);
    if (m && /^https?:\/\//.test(m[1]) && !/\/embed|\/e\//i.test(m[1]) && !DECOY_RE.test(m[1])) return m[1];
  }
  const generic = text.match(/https?:\/\/[^"'\s<>\\]+\.(?:m3u8|mp4)[^"'\s<>\\]*/gi);
  if (generic) {
    for (const u of generic) {
      if (!/\/embed|\/e\//i.test(u) && !/google|facebook|cloudflare|analytics|tracker/i.test(u) && !DECOY_RE.test(u)) return u;
    }
  }
  return null;
}

// Exported for the round-trip test in embedExtract.test.ts.
export function extractFromPacked(html: string): string | null {
  const head = /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[dr]\s*\)/.exec(html);
  if (!head) return null;
  const m = html
    .slice(head.index)
    .match(/\}\s*\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\s*\.\s*split\s*\(\s*'\|'\s*\)/);
  if (!m) return null;
  try {
    const unpacked = unpackPacked(m[1].replace(/\\(.)/g, "$1"), +m[2], +m[3], m[4].split("|"));
    return pickMediaUrl(unpacked);
  } catch {
    return null;
  }
}

export function isMp4uploadMediaUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    return (host === "mp4upload.com" || host.endsWith(".mp4upload.com")) &&
      url.pathname.toLowerCase().endsWith(".mp4") &&
      !DECOY_RE.test(raw);
  } catch {
    return false;
  }
}

export function extractMp4uploadUrl(html: string): string | null {
  const decoded = String(html || "").replace(/\\\//g, "/").replace(/&amp;|&#0?38;/gi, "&");
  const plain = decoded.match(/https?:\/\/[^"'\s<>\\]+\.mp4[^"'\s<>\\]*/gi)?.find(isMp4uploadMediaUrl);
  if (plain) return plain;
  const packed = extractFromPacked(decoded);
  return packed && isMp4uploadMediaUrl(packed) ? packed : null;
}

export function extractVideasUrl(html: string): string | null {
  return pickMediaUrl(html);
}

// streamwish family (streamwish/hlswish/wishembed/wishfast/…): the master
// m3u8 lives in packed JS in the embed page's initial HTML.
export async function extractStreamwish(embedUrl: string): Promise<{ url: string; type: "hls" | "mp4" } | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const got = await fetchEmbed(embedUrl, attempt === 0 ? 8000 : 15000);
    if (got.blocked) return null;
    const html = got.html;
    if (!html) continue;
    const url = extractFromPacked(html) || pickMediaUrl(html);
    if (url) return { url, type: mediaType(url) };
    // Got a page but no URL — markup drift; retrying won't change it.
    return null;
  }
  return null;
}

export async function extractVideas(embedUrl: string): Promise<{ url: string; type: "hls" | "mp4" } | null> {
  const got = await fetchEmbed(embedUrl, 10000);
  const url = got.html ? extractVideasUrl(got.html) : null;
  return url ? { url, type: mediaType(url) } : null;
}

// NOTE: voe deliberately has NO direct resolver. Live testing (2026-07) shows
// voe.sx now answers a JS-redirect page whose mirror gates the player behind
// a session-sync interstitial (localStorage token + postMessage handshake) —
// a plain GET can never reach the sources, and trying costs 8-20s before the
// WebView fallback. voe resolves via the WebView extractor only.

// doodstream family: read /pass_md5/<…> + token from the embed page, then GET
// the endpoint (Referer = the embed page, like an in-page XHR) and decorate
// the returned base URL with a random tail + the page token — same recipe as
// the WebView collector's tryDood().
export async function extractDoodstream(embedUrl: string): Promise<{ url: string; type: "mp4" } | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const got = await fetchEmbed(embedUrl, attempt === 0 ? 8000 : 15000);
    if (got.blocked) return null;
    const html = got.html;
    if (!html) continue;
    const m = html.match(/['"]([^'"]*\/pass_md5\/[^'"]+)['"]/);
    if (!m) return null;
    const passUrl = m[1].startsWith("http") ? m[1] : new URL(m[1], got.finalUrl).toString();
    const tk = html.match(/token=([a-zA-Z0-9]+)/);
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 10000);
    try {
      const resp = await fetch(passUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent": BROWSER_UA,
          Referer: got.finalUrl,
          "X-Requested-With": "XMLHttpRequest",
        },
      });
      const base = (await resp.text()).trim();
      if (!base.startsWith("http")) continue;
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
      let rand = "";
      for (let i = 0; i < 10; i++) rand += chars.charAt(Math.floor(Math.random() * chars.length));
      const url = `${base}${rand}?token=${tk ? tk[1] : ""}&expiry=${Date.now()}`;
      return { url, type: "mp4" };
    } catch {
      continue;
    } finally {
      clearTimeout(t);
    }
  }
  return null;
}
// Resolve vid3rb's `/video` redirect to the FINAL files-N CDN URL, validating
// that the edge actually serves bytes.
//
// A source src is `https://video.vid3rb.com/video/<uuid>?speed&token&expires`,
// which 302-redirects to a per-request signed `https://files-N.vid3rb.com/…mp4?
// e&t&noip=yes` URL. That intermediate endpoint INTERMITTENTLY routes to a hung
// edge (measured live: ~1 in 6 requests never returns the files response and
// just hangs) — and the native player follows the redirect only ONCE with no
// retry, so it gets stuck buffering forever ("anime3rb not loading"). The final
// files-N URL itself is reliable (noip=yes, ~4h expiry, answers Range), so we
// follow + validate the redirect HERE and retry until an edge serves, then hand
// the player the resolved direct URL. RN's fetch follows redirects and exposes
// the final URL as `res.url`.
async function resolveVid3rbCdnUrl(src: string): Promise<string | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * attempt));
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(src, {
        signal: controller.signal,
        headers: {
          "User-Agent": BROWSER_UA,
          Referer: A3RB_BASE + "/",
          // Tiny range: confirms the resolved edge answers with a body (a hung
          // edge never gets here — the fetch aborts on the 8s timeout). Reading
          // the 2-byte body inside the timeout window catches a header-then-
          // hang edge too.
          Range: "bytes=0-1",
        },
      });
      const finalUrl = res.url || src;
      const okStatus = res.status === 206 || res.status === 200;
      if (okStatus && /vid3rb\.com/i.test(finalUrl)) {
        const buf = await res.arrayBuffer();
        clearTimeout(t);
        if (buf.byteLength > 0) return finalUrl;
        continue;
      }
      clearTimeout(t);
    } catch {
      clearTimeout(t);
    }
  }
  return null;
}

// Parse the non-premium playable sources from a vid3rb player page, highest
// resolution first. The page declares `video_sources` twice — an empty [] then
// the real array — so match the non-empty form (starts with `[{`); accept a
// trailing `;` or none (markup drift). The match is valid JSON as-is (URLs use
// JSON's escaped https:\/\/… slashes). Premium-gated tiers ship an empty src
// and are dropped.
function parseVid3rbSources(html: string): { src: string; res: number }[] {
  const m =
    html.match(/video_sources\s*=\s*(\[\{[\s\S]*?\}\])\s*;/) ||
    html.match(/video_sources\s*=\s*(\[\{[\s\S]*?\}\])/);
  if (!m) return [];
  let sources: { src?: string; res?: string; label?: string; premium?: boolean }[] = [];
  try { sources = JSON.parse(m[1]); } catch { return []; }
  return sources
    .filter((s) => s.src && /^https?:\/\//.test(s.src) && !s.premium)
    .map((s) => ({ src: s.src as string, res: parseInt(s.res || "0", 10) || 0 }))
    .sort((a, b) => b.res - a.res); // highest resolution first (1080p preferred)
}

// Order parsed sources so the requested quality (if any) is first, then the
// rest as fallbacks (exact res → closest at-or-below → highest).
function orderVid3rbSources(free: { src: string; res: number }[], desiredRes: number): { src: string; res: number }[] {
  if (desiredRes > 0 && free.length) {
    const pick =
      free.find((s) => s.res === desiredRes) ||
      free.find((s) => s.res > 0 && s.res <= desiredRes) ||
      free[0];
    return [pick, ...free.filter((s) => s !== pick)];
  }
  return free;
}

// Resolve the first source whose signed CDN redirect actually serves bytes.
// Returns the validated direct URL, or null if NONE could be validated (so the
// caller can decide whether to refetch fresh sources vs hand back a raw src).
async function resolveVid3rbFromSources(
  free: { src: string; res: number }[],
  desiredRes: number,
): Promise<{ url: string; type: "hls" | "mp4" } | null> {
  for (const q of orderVid3rbSources(free, desiredRes)) {
    const cdn = await resolveVid3rbCdnUrl(q.src);
    if (cdn) return { url: cdn, type: /\.m3u8(\?|$)/i.test(cdn) ? "hls" : "mp4" };
  }
  return null;
}

// Building the server list already fetches+parses the vid3rb player page (to
// enumerate qualities); the play-time extractor then fetched the SAME page
// again — a wasted round-trip that, when Cloudflare challenges the raw GET,
// escalates to a slow WebView render before the video can start. Cache the
// parsed sources from the list-build so extraction reuses them and plays
// (almost) immediately. The src URLs carry tokens that expire ~40min, so keep
// the cache well under that and refetch if a cached source can't be validated.
const _vid3rbSourcesCache = new Map<string, { sources: { src: string; res: number }[]; ts: number }>();
const VID3RB_SOURCES_TTL = 25 * 60 * 1000;
function cacheVid3rbSources(playerUrl: string, sources: { src: string; res: number }[]) {
  if (sources.length) _vid3rbSourcesCache.set(playerUrl, { sources, ts: Date.now() });
}
function getCachedVid3rbSources(playerUrl: string): { src: string; res: number }[] | null {
  const hit = _vid3rbSourcesCache.get(playerUrl);
  if (hit && Date.now() - hit.ts < VID3RB_SOURCES_TTL) return hit.sources;
  if (hit) _vid3rbSourcesCache.delete(playerUrl);
  return null;
}

// List the available free resolutions for an anime3rb episode (e.g. [1080, 720,
// 480]) from its player page. The server builder uses this only to warm the
// parsed-source cache; extractVid3rb then selects the highest stream internally.
// Returns [] on any fetch/parse miss so the caller can degrade gracefully.
export async function listVid3rbResolutions(playerUrl: string): Promise<number[]> {
  const html = await fetchAnime3rbHtml(playerUrl, "video_sources");
  if (!html) return [];
  const free = parseVid3rbSources(html);
  cacheVid3rbSources(playerUrl, free);
  return free.map((s) => s.res).filter((r) => r > 0);
}

export async function extractVid3rb(playerUrlWithHint: string): Promise<{ url: string; type: "hls" | "mp4" } | null> {
  // An optional `#vid3rb=<res>` fragment selects a specific quality (the
  // multi-quality server list encodes it there); without one we take the
  // highest. The fragment never reaches the network — strip it before the GET.
  let desiredRes = 0;
  let playerUrl = playerUrlWithHint;
  const hashIdx = playerUrlWithHint.indexOf("#vid3rb=");
  if (hashIdx >= 0) {
    desiredRes = parseInt(playerUrlWithHint.slice(hashIdx + "#vid3rb=".length), 10) || 0;
    playerUrl = playerUrlWithHint.slice(0, hashIdx);
  }
  // Fast path: reuse the sources the server-list build already parsed for this
  // player page — skips a full player-page re-fetch (and its potential WebView
  // CF escalation), so playback starts in just the redirect-resolve time. If
  // none of the cached sources can be validated (tokens expired), drop the
  // cache and fall through to a fresh fetch.
  const cached = getCachedVid3rbSources(playerUrl);
  if (cached) {
    const r = await resolveVid3rbFromSources(cached, desiredRes);
    if (r) return r;
    _vid3rbSourcesCache.delete(playerUrl);
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 600 * attempt));
    const html = await fetchAnime3rbHtml(playerUrl, "video_sources", true);
    if (!html) continue;
    const free = parseVid3rbSources(html);
    if (free.length === 0) return null;
    cacheVid3rbSources(playerUrl, free);
    // Hand the native player the RESOLVED files-N CDN URL. The reliability
    // problem was never the resolution — it was vid3rb's unretried redirect hop
    // (see resolveVid3rbCdnUrl) — so resolving it here makes every quality,
    // 1080p included, actually play.
    const r = await resolveVid3rbFromSources(free, desiredRes);
    if (r) return r;
    // No edge could be validated (network down?) — return the chosen src and
    // let the native player / self-heal retry, rather than failing the server.
    const top = orderVid3rbSources(free, desiredRes)[0];
    return { url: top.src, type: /\.m3u8(\?|$)/i.test(top.src) ? "hls" : "mp4" };
  }
  return null;
}

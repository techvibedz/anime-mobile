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

const UP4_BASE = "https://w1.anime4up.rest";
const A3RB_BASE = "https://anime3rb.com";
const WIT_BASE = "https://witanime.you";

// Must match the scraper WebView / native player UA (see ScraperHost.tsx and
// the watch screen's videoSource headers) — some CDNs bind tokens to the UA
// that minted them.
const BROWSER_UA =
  "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

// Both sites are intermittently flaky: a single GET routinely hits a timeout,
// a 429 rate-limit (lookups fire several GETs in a burst), a 503, or a
// transient Cloudflare hiccup. Retry each GET a few times with a short
// per-attempt timeout and a small growing backoff so a transient miss
// self-heals in well under a second instead of bubbling up. A hard 4xx
// (404/410 — e.g. a slug probe miss) won't change on retry, so bail fast.
export async function fetchHtml(url: string, referer?: string): Promise<string | null> {
  const ATTEMPTS = 3;
  const PER_ATTEMPT_TIMEOUT_MS = 9000;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), PER_ATTEMPT_TIMEOUT_MS);
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
      clearTimeout(t);
      if (res.ok) return await res.text();
      const retryable = res.status === 429 || res.status === 403 || res.status >= 500;
      if (!retryable || attempt === ATTEMPTS) return null;
    } catch {
      clearTimeout(t);
      if (attempt === ATTEMPTS) return null;
    }
    await new Promise((r) => setTimeout(r, 600 * attempt));
  }
  return null;
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
  const html = await fetchHtml(url, WIT_BASE + "/");
  if (!html) return null;
  return parseWitCards(html);
}

// Search witanime via its static-HTML results page.
export async function searchWitanimeDirect(query: string): Promise<WitCard[] | null> {
  if (!query) return null;
  const url = `${WIT_BASE}/?search_param=animes&s=${encodeURIComponent(query)}`;
  const html = await fetchHtml(url, WIT_BASE + "/");
  if (!html) return null;
  return parseWitCards(html);
}

/* ── Title matching (mirrors EXTRACT_TITLE_MATCH in scripts.ts) ── */

function tm_seasonNum(s: string): number {
  s = (s || "").toLowerCase();
  const m =
    s.match(/\b(?:season|s|part|cour)\s*(\d+)\b/) ||
    // Ordinal-before-keyword form: "7th Season", "2nd Part", "3rd Cour".
    s.match(/\b(\d+)(?:st|nd|rd|th)\s+(?:season|part|cour)\b/) ||
    s.match(/الموسم\s*([٠-٩\d]+)/) ||
    s.match(/الجزء\s*([٠-٩\d]+)/);
  if (!m) return 1;
  const n = m[1].replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  const v = parseInt(n, 10);
  return isNaN(v) ? 1 : v;
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

/* ── Provider classification (mirrors the injected scripts) ── */

export function classifyProvider(url: string): string {
  const u = (url || "").toLowerCase();
  if (/mp4upload/.test(u)) return "mp4upload";
  if (/dailymotion|dai\.ly/.test(u)) return "dailymotion";
  if (/streamwish|hlswish|wishembed|wishfast|hgcloud|jwembed|vibuxer|audinifer|masukestin|hanerix/.test(u)) return "streamwish";
  if (/voe\./.test(u)) return "voe";
  if (/share4max|megamax/.test(u)) return "share4max";
  if (/rubyvidhub|streamruby|rubystm|ruby/.test(u)) return "streamruby";
  if (/doodstream|dood\.|dsvplay|d-s\.io|vidply/.test(u)) return "doodstream";
  if (/uqload/.test(u)) return "uqload";
  if (/ok\.ru/.test(u)) return "okru";
  if (/videa\.|vidvaita|vidit/.test(u)) return "videa";
  if (/vk\.com/.test(u)) return "vk";
  if (/vid3rb|anime3rb/.test(u)) return "vid3rb";
  return "generic";
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
function parseUp4Episodes(
  html: string,
): { title: string; number: number; type: string; screenshot: string; href: string }[] {
  // Constrain to the episodes-list container when present. The page chrome
  // (the "latest episodes" rail on paginated pages) carries /episode/ links
  // from the NEWEST part of the series, which widen the parsed number range —
  // findUp4EpisodeAcrossPages then sees the wanted episode "within this
  // page's range but missing", concludes numbering gap, and gives up even
  // though the neighbouring page actually has it (verified live: One Piece
  // /page/16/ parses as 420–1165 unscoped, 420–467 scoped).
  const segStart = html.indexOf("episodes-list-content");
  if (segStart >= 0) {
    const segEnd = html.indexOf("pagination", segStart);
    html = html.slice(segStart, segEnd > segStart ? segEnd : undefined);
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
function parseUp4Servers(html: string): RawServer[] {
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
    out.push({ id: String(out.length), name, iframeUrl: src, provider: classifyProvider(src) });
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
function a3rbSlugVariants(title: string): string[] {
  const out: string[] = [];
  const add = (s: string) => { const v = a3rbSlugify(s); if (v && !out.includes(v)) out.push(v); };
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
    add(cleaned);
    // Laravel's Str::slug DROPS a colon that touches both words instead of
    // dashing it: "Re:Zero kara…" lives at rezero-kara-…, not re-zero-kara-….
    add(cleaned.replace(/(\S)[:：](\S)/g, "$1$2"));
    add(cleaned.split(/\s*[:：]\s*/)[0]);
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
        add(`${base} ${a3rbOrdinal(n)} season`);
        add(`${base} season ${n}`);
        add(`${base} part ${n}`);
        add(`${base} ${n}`);
        if (n === 1) add(base);
      }
    }
  }
  return out.slice(0, 12);
}

// Probe /titles/<slug> and verify the page's own title actually matches the
// wanted anime (same >=34 threshold as the other cross-source matchers) so a
// coincidental slug can't hijack the match. Returns the page URL or null.
async function probeA3rbTitlePage(slug: string, title: string): Promise<string | null> {
  const url = `${A3RB_BASE}/titles/${slug}`;
  const html = await fetchHtml(url, A3RB_BASE + "/");
  if (!html) return null; // 404 / fetch failure
  const tm =
    html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) ||
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const got = tm ? tm[1].replace(/\s*[|–]\s*Anime3rb.*$/i, "").trim() : slug.replace(/-+/g, " ");
  return tm_score(title, got) >= 34 ? url : null;
}

// Probe /titles/<slug> for each candidate slug shape derived from the title.
export async function searchAnime3rbDirect(title: string): Promise<string | null> {
  if (!title) return null;
  for (const slug of a3rbSlugVariants(title)) {
    const url = await probeA3rbTitlePage(slug, title);
    if (url) return url;
  }
  return null;
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

export async function searchAnime3rbCatalog(title: string): Promise<string | null> {
  if (!title) return null;
  const slugs = await fetchA3rbCatalog();
  if (!slugs.length) return null;
  const slug = a3rbCatalogMatch(title, slugs);
  if (!slug) return null;
  // Confirm against the real page's own title before trusting the match.
  return probeA3rbTitlePage(slug, title);
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

// Scrape a full anime3rb anime page (detail + episodes). Returns null on a
// fetch/parse failure so callers degrade gracefully to the other sources.
export async function scrapeAnime3rbTitlePage(titleUrl: string): Promise<A3rbDetail | null> {
  const html = await fetchHtml(titleUrl, A3RB_BASE + "/");
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
  const synopsis = a3rbMetaContent(html, "og:description") || a3rbMetaContent(html, "description") || "";

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
  const html = await fetchHtml(episodeUrl, A3RB_BASE + "/");
  if (!html) return [];
  // The snapshot lives inside an HTML attribute, so quotes arrive as &quot;
  // and the URL as JSON-escaped https:\/\/… with &amp; between query params.
  const raw =
    html.match(/video_url&quot;:&quot;(https:[\s\S]*?)&quot;/)?.[1] ||
    html.match(/"video_url"\s*:\s*"(https:[\s\S]*?)"/)?.[1] ||
    null;
  if (!raw) return [];
  const url = raw.replace(/\\\//g, "/").replace(/&amp;/g, "&");
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (!h || h.indexOf(".") < 0) return [];
  } catch { return []; }
  return [{ id: "0", name: "Anime3rb", iframeUrl: url, provider: "vid3rb" }];
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
  // Canonical www embed form — watch-page / bare-host URLs render a
  // download page or redirect instead of the player.
  const embedUrl = normalizeEmbedUrl(iframeUrl);
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 600 * attempt));
    const html = await fetchHtml(embedUrl, "https://www.mp4upload.com/");
    if (!html) continue;
    // Older mirrors may still serve the packed-JS player — the caller falls
    // back to the WebView path (which carries the unpacker) for those.
    if (/eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[dr]\s*\)/.test(html)) return null;
    const patterns = [
      /player\.src\(\s*["']([^"']+\.mp4[^"']*)["']/i,
      /(?:file|src)\s*:\s*["']([^"']+\.mp4[^"']*)["']/i,
      /<source[^>]+src\s*=\s*["']([^"']+\.mp4[^"']*)["']/i,
      /(https?:\/\/[^"'\s\\]+mp4upload\.com[^"'\s\\]*\.mp4[^"'\s\\]*)/i,
    ];
    for (const re of patterns) {
      const url = html.match(re)?.[1];
      if (url && /^https?:\/\//.test(url) && !/sample[-_.]|placeholder|bigbuckbunny|tos\.mp4/i.test(url)) {
        return { url, type: "mp4" };
      }
    }
  }
  return null;
}

export async function extractVid3rb(playerUrl: string): Promise<{ url: string; type: "hls" | "mp4" } | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 600 * attempt));
    const html = await fetchHtml(playerUrl, A3RB_BASE + "/");
    if (!html) continue;
    // The page declares `video_sources` twice — an empty [] then the real
    // array — so match the non-empty form. The match is valid JSON as-is
    // (URLs use JSON's escaped https:\/\/… slashes).
    const m = html.match(/video_sources\s*=\s*(\[\{[\s\S]*?\}\])\s*;/);
    if (!m) continue;
    let sources: { src?: string; res?: string; label?: string; premium?: boolean }[] = [];
    try { sources = JSON.parse(m[1]); } catch { continue; }
    const best = sources
      .filter((s) => s.src && /^https?:\/\//.test(s.src) && !s.premium)
      .sort((a, b) => (parseInt(b.res || "0", 10) || 0) - (parseInt(a.res || "0", 10) || 0))[0];
    if (!best?.src) return null;
    return { url: best.src, type: /\.m3u8(\?|$)/i.test(best.src) ? "hls" : "mp4" };
  }
  return null;
}

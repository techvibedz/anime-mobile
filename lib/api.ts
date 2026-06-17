// All data is scraped in-app via a hidden WebView (lib/scraper).
// No HTTP backend is required.

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  scrapeWitanimeHome,
  scrapeAnime4upHome,
  scrapeEpisodesPage,
  scrapeSearch,
  scrapeSearchUp4,
  scrapeRecent,
  scrapeGenre,
  scrapeAllAnime,
  scrapeGenreDirect,
  scrapeAllAnimeDirect,
  searchWitanimeDirectList,
  scrapeVideoServers,
  findCrossSourceUrl,
  extractVideoUrl as scrapeExtractVideoUrl,
  type RawServer,
} from "./scraper";
import {
  searchAnime4upDirect,
  scrapeAnime4upEpisodePageDirect,
  findUp4EpisodeAcrossPages,
  searchAnime3rbDirect,
  searchAnime3rbCatalog,
  scrapeAnime3rbEpisodeServers,
  scrapeAnime3rbTitlePage,
  extractVid3rb,
  extractMp4upload,
} from "./scraper/direct";
import { getAltTitles } from "./animeInfo";

const HOME_CACHE_KEY = "@home_cache_v1";
const HOME_CACHE_TTL = 30 * 60 * 1000; // 30 min
const DETAIL_CACHE_PREFIX = "@detail_v1:";
const DETAIL_CACHE_TTL = 30 * 60 * 1000; // 30 min
const UP4_CACHE_PREFIX = "@up4_eps_v2:";
const UP4_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 h
const SEARCH_CACHE_PREFIX = "@search_v1:";
const SEARCH_CACHE_TTL = 15 * 60 * 1000; // 15 min
const LISTING_CACHE_PREFIX = "@listing_v1:";
const LISTING_CACHE_TTL = 30 * 60 * 1000; // 30 min
const RECENT_CACHE_PREFIX = "@recent_v1:";
const RECENT_CACHE_TTL = 10 * 60 * 1000; // 10 min — new episodes land often
const SERVERS_CACHE_PREFIX = "@servers_v2:";
const SERVERS_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 h — embed URLs are stable
const XSOURCE_CACHE_KEY = "@xsource_v1";

async function readCache<T>(key: string, ttlMs: number): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.ts > ttlMs) return null;
    return parsed.data as T;
  } catch {
    return null;
  }
}
async function writeCache(key: string, data: unknown) {
  try {
    await AsyncStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
  } catch {}
}

// Stale-while-revalidate: cached payload renders instantly; a background
// refresh keeps the cache fresh for the next visit. `valid` gates what gets
// cached so transient empty scrapes aren't frozen for the whole TTL.
const _swrInFlight = new Set<string>();
async function swr<T>(
  key: string,
  ttlMs: number,
  fresh: () => Promise<T>,
  valid: (d: T) => boolean = () => true,
): Promise<T> {
  const cached = await readCache<T>(key, ttlMs);
  if (cached) {
    if (!_swrInFlight.has(key)) {
      _swrInFlight.add(key);
      void fresh()
        .then((data) => { if (valid(data)) return writeCache(key, data); })
        .catch(() => {})
        .finally(() => _swrInFlight.delete(key));
    }
    return cached;
  }
  const data = await fresh();
  if (valid(data)) void writeCache(key, data);
  return data;
}

const WIT_BASE = "https://witanime.you";
const UP4_BASE = "https://w1.anime4up.rest";

/* ── Home types ─────────────────────────────── */

export interface FeaturedItem {
  title: string;
  href: string;
  image: string | null;
  description: string | null;
  genres: string[];
}

export interface AnimeItem {
  title: string;
  href: string;
  image: string;
  type: string | null;
  status: string | null;
  description: string | null;
  rating: string | null;
  isNew: boolean;
  sources?: string[];
  sourceHrefs?: Record<string, string>;
}

export interface MergedAnimeItem extends AnimeItem {
  sources: string[];
  sourceHrefs: Record<string, string>;
}

export interface EpisodeItem {
  title: string;
  href: string;
  image: string;
  animeTitle: string;
  animeHref: string;
  isNew: boolean;
}

export interface HomeSection {
  id: string;
  title: string;
  type: "anime" | "episode";
  items: (AnimeItem | EpisodeItem)[];
}

/* ── Detail types ───────────────────────────── */

export interface Episode {
  title: string;
  number: number;
  type: string;
  screenshot: string;
  href: string | null;
}

export interface RelatedAnime {
  title: string;
  href: string;
  image: string;
  type: string | null;
}

export interface AnimeDetail {
  title: string;
  poster: string;
  banner: string;
  synopsis: string;
  genres: string[];
  rating: string | null;
  metadata: Record<string, string>;
  externalLinks: { label: string; href: string }[];
  relatedAnime: RelatedAnime[];
  totalEpisodes: number;
  episodes: Episode[];
}

/* ── Video types ────────────────────────────── */

export interface VideoServer {
  id: string;
  name: string;
  iframeUrl: string;
  provider: string;
}

/* ── Search types ───────────────────────────── */

export interface SearchResult {
  title: string;
  href: string;
  image: string;
  type?: string;
  status?: string;
  synopsis?: string;
}

/* ── Legacy compat ──────────────────────────── */
export type SliderItem = FeaturedItem;
export type AnimeCard = AnimeItem;
export type EpisodeCard = EpisodeItem;

/* ── Helpers ────────────────────────────────── */

function norm(s: string) {
  return (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}
function keyWords(s: string, n = 4) {
  return norm(s).split(" ").filter((w) => w.length > 2).slice(0, n).join(" ");
}
function fuzzyMatch(a: string, b: string) {
  const ka = keyWords(a, 4);
  const kb = keyWords(b, 4);
  if (!ka || !kb) return false;
  if (ka.includes(kb) || kb.includes(ka)) return true;
  const wa = ka.split(" ");
  const wb = kb.split(" ");
  const common = wa.filter((w) => wb.includes(w));
  return common.length >= Math.min(3, Math.min(wa.length, wb.length));
}

function imgOrEmpty(s: string | null | undefined): string {
  return s ?? "";
}

/* ── proxy URL — DISABLED. We play the resolved URL directly in the native
 * player with per-provider headers (on-device residential IP is accepted by
 * the CDNs). Kept as identity for call-site compatibility. ── */
export function getProxyUrl(videoUrl: string): string {
  return videoUrl;
}

/* ── /home ──────────────────────────────────── */

type HomePayload = { success: boolean; data: { featured: FeaturedItem[]; sections: HomeSection[] } };

let bgRefreshInFlight = false;

// A home payload is only worth caching/showing if it actually carries content.
// A cold WebView or an un-cleared Cloudflare challenge can yield an empty
// scrape; freezing that for the 30-min TTL is exactly what made the app open to
// "zero content". Gate both the cache write and the cache read on this.
function homeHasContent(p: HomePayload | null | undefined): p is HomePayload {
  return !!p && (p.data.featured.length > 0 || p.data.sections.length > 0);
}

function buildHomePayload(
  wit: { featured: FeaturedItem[]; animes: any[]; episodes: any[] },
  up4Animes: { title: string; href: string; image: string | null; type: string | null }[],
): HomePayload {
  const used4up = new Set<string>();
  const merged: MergedAnimeItem[] = wit.animes.map((w: any) => {
    const m = up4Animes.find((u) => !used4up.has(u.href) && fuzzyMatch(w.title, u.title));
    const item: MergedAnimeItem = {
      ...w,
      image: imgOrEmpty(w.image),
      sources: ["witanime"],
      sourceHrefs: { witanime: w.href },
    };
    if (m) {
      used4up.add(m.href);
      item.sources.push("anime4up");
      item.sourceHrefs.anime4up = m.href;
      if (!item.image && m.image) item.image = m.image;
    }
    return item;
  });
  for (const u of up4Animes) {
    if (!used4up.has(u.href) && u.title && u.href) {
      merged.push({
        title: u.title, href: u.href, image: imgOrEmpty(u.image),
        type: u.type, status: null, description: null, rating: null, isNew: true,
        sources: ["anime4up"], sourceHrefs: { anime4up: u.href },
      });
    }
  }

  const featured: FeaturedItem[] = wit.featured;
  const recentEpisodes: EpisodeItem[] = wit.episodes.map((e: any) => ({
    title: e.title, href: e.href, image: imgOrEmpty(e.image),
    animeTitle: e.animeTitle, animeHref: e.animeHref, isNew: e.isNew,
  }));

  const sections: HomeSection[] = [];
  if (merged.length > 0) sections.push({ id: "trending", title: "Trending Now", type: "anime", items: merged });
  if (recentEpisodes.length > 0) sections.push({ id: "recently_updated", title: "Recently Updated", type: "episode", items: recentEpisodes });

  const tvItems = merged.filter((a) => a.type && (a.type.includes("TV") || a.type.includes("مسلسل")));
  const movieItems = merged.filter((a) => a.type && (a.type.includes("فيلم") || a.type.includes("Movie")));
  if (tvItems.length >= 3) sections.push({ id: "tv_series", title: "TV Series", type: "anime", items: tvItems });
  if (movieItems.length >= 2) sections.push({ id: "movies", title: "Movies", type: "anime", items: movieItems });

  return { success: true, data: { featured: featured.slice(0, 5), sections } };
}

async function fetchHomeFresh(): Promise<HomePayload> {
  const wit = await scrapeWitanimeHome();
  // Skip anime4up on home — it doubles load time and the merge is only
  // really needed for cross-source matching on detail pages. Home shows
  // wit-only content; up4 fills in on demand later.
  const result = buildHomePayload(wit, []);
  // Only persist a payload that actually has content. Caching an empty scrape
  // would freeze "zero content" for the whole TTL and the SWR path would keep
  // serving it on every launch.
  if (homeHasContent(result)) void writeCache(HOME_CACHE_KEY, result);
  return result;
}

export async function fetchHome(): Promise<HomePayload> {
  // Stale-while-revalidate: return cached payload immediately if present,
  // then kick off a background refresh so the next launch is fresher.
  const cached = await readCache<HomePayload>(HOME_CACHE_KEY, HOME_CACHE_TTL);
  if (homeHasContent(cached)) {
    if (!bgRefreshInFlight) {
      bgRefreshInFlight = true;
      void fetchHomeFresh().finally(() => { bgRefreshInFlight = false; });
    }
    return cached;
  }
  return fetchHomeFresh();
}

/* ── /episodes ──────────────────────────────── */

// Cache cross-source URL lookups for 24h — anime URLs are stable.
// Persisted to AsyncStorage so lookups survive app restarts.
const xsourceCache: Map<string, { url: string | null; ts: number }> = new Map();
const XSOURCE_TTL = 24 * 60 * 60 * 1000;

let _xsourceLoaded = false;
async function loadXsourceCache() {
  if (_xsourceLoaded) return;
  _xsourceLoaded = true;
  try {
    const raw = await AsyncStorage.getItem(XSOURCE_CACHE_KEY);
    if (!raw) return;
    const entries: [string, { url: string | null; ts: number }][] = JSON.parse(raw);
    for (const [k, v] of entries) {
      if (Date.now() - v.ts < XSOURCE_TTL && !xsourceCache.has(k)) xsourceCache.set(k, v);
    }
  } catch {}
}
function saveXsourceCache() {
  try {
    void AsyncStorage.setItem(XSOURCE_CACHE_KEY, JSON.stringify(Array.from(xsourceCache.entries())));
  } catch {}
}

// Progressively cleaner / shorter title variants. The full title is most
// precise but anime4up's search is fussy — it returns ZERO results when the
// query carries a long subtitle after a colon or trailing punctuation.
function searchVariants(title: string): string[] {
  // Drop bracketed/parenthetical notes and collapse whitespace.
  const cleaned = title.replace(/[([][^)\]]*[)\]]/g, "").replace(/\s+/g, " ").trim();
  const variants = new Set<string>();
  const add = (s: string) => { const t = (s || "").replace(/\s+/g, " ").trim(); if (t) variants.add(t); };

  // Full cleaned title first — when it matches it's the most precise.
  add(cleaned);
  // Emit cleaner — but still specific — variants BEFORE the crude word-count
  // truncations so the FIRST hit is a precise, correctly-scored match instead
  // of a lucky first-word result that can resolve to the wrong anime.
  // Candidates are always scored against the FULL title by the caller, so a
  // too-broad variant can't mis-match.
  add(cleaned.split(/\s*[:：]\s*/)[0]);              // strip ": subtitle"
  add(cleaned.split(/\s+[-–—]\s+/)[0]);             // strip " - subtitle"
  add(cleaned.replace(/[^\p{L}\p{N} ]+/gu, " "));   // strip stray punctuation (!, ., …)

  // Parenthesized alternative names: witanime often appends the romaji
  // original in parens ("The Beginning After the End Season 2 (Saikyou no
  // Ousama Nidome no Jinsei wa Nani wo Suru Season 2)") and anime4up indexes
  // the anime ONLY under the romaji name — every English-title query returns
  // zero results. Candidates are still scored against the FULL title, whose
  // tokens include the parenthesized words, so this can't mis-match.
  const reParen = /[([]([^)\]]+)[)\]]/g;
  let pm: RegExpExecArray | null;
  while ((pm = reParen.exec(title))) {
    const inner = pm[1].trim();
    if (!inner) continue;
    add(inner);
    add(inner.split(/\s*[:：]\s*/)[0]);
    // The long-query-returns-zero quirk applies to the alt name too
    // (the full "Saikyou no Ousama Nidome no Jinsei wa Nani wo Suru Season 2"
    // finds nothing; "Saikyou no Ousama" finds it), so truncate it as well.
    const iw = inner.split(/\s+/);
    if (iw.length > 3) add(iw.slice(0, 3).join(" "));
    if (iw.length > 2) add(iw.slice(0, 2).join(" "));
  }

  // Last-resort progressive head truncations.
  const words = cleaned.split(/\s+/);
  if (words.length > 3) add(words.slice(0, 3).join(" "));
  if (words.length > 2) add(words.slice(0, 2).join(" "));
  if (words.length > 1) add(words[0]);
  return Array.from(variants);
}

async function getCrossSourceUrl(
  title: string,
  primary: "witanime" | "anime4up",
): Promise<string | null> {
  const key = `${primary}:${title.toLowerCase().trim()}`;
  await loadXsourceCache();
  const hit = xsourceCache.get(key);
  if (hit && Date.now() - hit.ts < XSOURCE_TTL) return hit.url;

  let url: string | null = null;
  // Fast lane: when the target is anime4up, search its static HTML directly
  // (plain fetch, no WebView). The WebView render trips anime4up's ad
  // redirects / JS gates and often returns an empty result (so even
  // "One Piece" got no cross-source match).
  if (primary === "witanime") {
    for (const v of searchVariants(title)) {
      try {
        // Search with the (possibly truncated) variant but score candidates
        // against the full title so season disambiguation survives.
        const direct = await searchAnime4upDirect(v, title);
        if (direct) { url = direct; break; }
      } catch { /* fall through to the WebView path */ }
    }
    if (url) {
      xsourceCache.set(key, { url, ts: Date.now() });
      saveXsourceCache();
      return url;
    }
  }
  // Try each title variant; for each, retry a couple of times since
  // anime4up is intermittently unreachable and a single timeout shouldn't
  // kill the lookup. Stop at the first hit.
  for (const v of searchVariants(title)) {
    for (let attempt = 0; attempt < 3 && !url; attempt++) {
      url = await findCrossSourceUrl(v, primary).catch(() => null);
      if (!url && attempt < 2) await new Promise((r) => setTimeout(r, 2000));
    }
    if (url) break;
  }
  // Only cache positive hits — a null is likely a transient search/CF miss,
  // so let the next call retry instead of remembering the failure.
  if (url) {
    xsourceCache.set(key, { url, ts: Date.now() });
    saveXsourceCache();
  }
  return url;
}

function titleFromSlug(url: string): string {
  try {
    const slug = decodeURIComponent(new URL(url).pathname.replace(/\/$/, "").split("/").pop() || "");
    return slug.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

type EpisodesPayload = {
  success: boolean;
  data: AnimeDetail & { episodes4up?: Episode[]; merged?: { anime4up: string } | null };
};

async function fetchEpisodesFresh(animeUrl: string): Promise<EpisodesPayload> {
  // anime3rb anime pages aren't witanime/anime4up shaped, so they're scraped
  // via the static title-page parser instead of the WebView episode scraper.
  // This lets anime that live ONLY on anime3rb (surfaced by search) open as a
  // first-class detail page with a full, playable episode list.
  if (/anime3rb\.com/i.test(animeUrl)) {
    const a = await scrapeAnime3rbTitlePage(animeUrl);
    const payload: EpisodesPayload = {
      success: !!a,
      data: {
        title: a?.title || "",
        poster: a?.poster || "",
        banner: a?.poster || "",
        synopsis: a?.synopsis || "",
        genres: a?.genres || [],
        rating: null,
        metadata: {},
        externalLinks: [],
        relatedAnime: [],
        totalEpisodes: a?.episodes.length || 0,
        episodes: a?.episodes || [],
        episodes4up: [],
        merged: null,
      },
    };
    if (a) void writeCache(DETAIL_CACHE_PREFIX + animeUrl, payload);
    return payload;
  }
  // Fast path: primary source only. Cross-source enrichment is fetched in
  // the background via fetchEpisodesUp4 — see the detail screen.
  const d = await scrapeEpisodesPage(animeUrl);
  const payload: EpisodesPayload = {
    success: true,
    data: {
      title: d.title,
      poster: d.poster,
      banner: d.poster,
      synopsis: d.synopsis,
      genres: d.genres,
      rating: null,
      metadata: {},
      externalLinks: [],
      relatedAnime: [],
      totalEpisodes: d.episodes.length,
      episodes: d.episodes,
      episodes4up: [],
      merged: null,
    },
  };
  void writeCache(DETAIL_CACHE_PREFIX + animeUrl, payload);
  return payload;
}

export async function fetchEpisodes(animeUrl: string): Promise<EpisodesPayload> {
  // Stale-while-revalidate. Cached payload renders instantly; a fresh
  // scrape kicks off in the background so the next open is even fresher.
  const cached = await readCache<EpisodesPayload>(DETAIL_CACHE_PREFIX + animeUrl, DETAIL_CACHE_TTL);
  if (cached) {
    void fetchEpisodesFresh(animeUrl).catch(() => {});
    return cached;
  }
  return fetchEpisodesFresh(animeUrl);
}

/**
 * Background enrichment: find the cross-source anime URL and scrape its
 * episode list so the UI can show "both sources" badges and pass url4up to
 * the watch screen. Called separately from fetchEpisodes so the primary
 * scrape never has to wait on this.
 */
export async function fetchEpisodesUp4(
  animeUrl: string,
  title: string | null,
): Promise<{ merged: { anime4up: string } | null; episodes4up: Episode[] }> {
  const isAnime4up = /anime4up/i.test(animeUrl);
  if (isAnime4up) {
    // anime4up is the primary; just re-use what fetchEpisodes already had.
    const d = await scrapeEpisodesPage(animeUrl).catch(() => null);
    return { merged: { anime4up: animeUrl }, episodes4up: d?.episodes ?? [] };
  }

  // Check up4-episodes cache first
  const cacheKey = UP4_CACHE_PREFIX + animeUrl;
  const cached = await readCache<{ merged: { anime4up: string } | null; episodes4up: Episode[] }>(cacheKey, UP4_CACHE_TTL);
  if (cached) return cached;

  const guessTitle = titleFromSlug(animeUrl);
  const lookupTitle = title || guessTitle;
  if (!lookupTitle) return { merged: null, episodes4up: [] };

  const crossUrl = await getCrossSourceUrl(lookupTitle, "witanime").catch(() => null);
  if (!crossUrl) {
    // Don't persist the miss — a later attempt (better network, or a title
    // that now resolves) should be free to retry instead of being stuck on a
    // cached empty for 24h.
    return { merged: null, episodes4up: [] };
  }

  let episodes4up: Episode[] = [];
  try {
    const up4 = await scrapeEpisodesPage(crossUrl);
    episodes4up = up4.episodes;
  } catch {}

  const result = { merged: { anime4up: crossUrl }, episodes4up };
  // Only cache a positive hit; an empty episode list is likely a transient
  // scrape failure and shouldn't be frozen for the full TTL.
  if (episodes4up.length > 0) void writeCache(cacheKey, result);
  return result;
}

// ── anime4up episode-level resolution (pagination-aware) ──
// anime4up anime pages only list the newest ~40 episodes on page 1 (One Piece
// spans 25 pages), so the episode-list match above can NEVER find an older
// episode — which made anime4up servers permanently absent for catch-up
// watching. This resolves a single episode by anime title + number, walking
// the pagination toward the requested number. Only successful resolutions are
// cached (anime4up is intermittently empty under its ad gates / rate limits;
// caching a null for 24h would permanently block retries), and successes are
// persisted so revisits after an app restart skip the search + list fetches.
const up4EpUrlCache = new Map<string, { url: string; ts: number }>();
const UP4_EP_URL_PREFIX = "@up4_ep_url_v1:";
export async function resolveUp4EpisodeUrl(animeTitle: string, epNumber: number): Promise<string | null> {
  if (!animeTitle || epNumber == null) return null;
  const key = `${animeTitle.toLowerCase().trim()}#${epNumber}`;
  const hit = up4EpUrlCache.get(key);
  if (hit && Date.now() - hit.ts < UP4_CACHE_TTL) return hit.url;
  const stored = await readCache<string>(UP4_EP_URL_PREFIX + key, UP4_CACHE_TTL);
  if (stored) { up4EpUrlCache.set(key, { url: stored, ts: Date.now() }); return stored; }
  let animeUrl: string | null = null;
  for (const v of searchVariants(animeTitle)) {
    try {
      // Score against the full title so season disambiguation survives.
      animeUrl = await searchAnime4upDirect(v, animeTitle);
    } catch { animeUrl = null; }
    if (animeUrl) break;
  }
  if (!animeUrl) return null;
  let url: string | null = null;
  try {
    url = await findUp4EpisodeAcrossPages(animeUrl, epNumber);
  } catch {}
  if (url) {
    up4EpUrlCache.set(key, { url, ts: Date.now() });
    void writeCache(UP4_EP_URL_PREFIX + key, url);
  }
  return url;
}

// ── anime3rb (third server source) ──
// anime3rb's episode URLs are constructible (/episode/<slug>/<number>), so
// resolving an episode is just "find the title page once, then append the
// number". The title resolution result is cached in memory AND persisted so
// every later episode of the same anime resolves instantly. Mirrors the
// anime4up lesson: only successful resolutions are cached — caching a miss
// for 24h would permanently block retries while the site is briefly flaky.
const a3rbTitleCache = new Map<string, { url: string; ts: number }>();
const A3RB_TITLE_PREFIX = "@a3rb_title_v1:";

async function resolveAnime3rbTitleUrl(animeTitle: string): Promise<string | null> {
  if (!animeTitle) return null;
  const key = animeTitle.toLowerCase().trim();
  const hit = a3rbTitleCache.get(key);
  if (hit && Date.now() - hit.ts < UP4_CACHE_TTL) return hit.url;
  const stored = await readCache<string>(A3RB_TITLE_PREFIX + key, UP4_CACHE_TTL);
  if (stored) { a3rbTitleCache.set(key, { url: stored, ts: Date.now() }); return stored; }
  // Slug guessing first: anime3rb's slugs derive cleanly from romaji titles,
  // so this lands in one or two cheap GETs for the vast majority of anime.
  let url = await searchAnime3rbDirect(animeTitle).catch(() => null);
  if (!url) {
    // Catalog matching second: anime3rb's daily titles sitemap (one plain
    // GET, cached in-memory) covers anime whose slug can't be guessed —
    // different romanization, alt-name-only indexing, shortened titles.
    url = await searchAnime3rbCatalog(animeTitle).catch(() => null);
  }
  // NOTE: no /search fallback. anime3rb's /search sits behind a Cloudflare
  // managed challenge, so failing fast here lets the watch screen's retry
  // loop converge instead of pinning a doomed request.
  if (url) {
    a3rbTitleCache.set(key, { url, ts: Date.now() });
    void writeCache(A3RB_TITLE_PREFIX + key, url);
  }
  return url;
}

// Servers for an episode by anime title + episode number. Returns [] on any
// miss (unknown anime, episode not yet uploaded, transient fetch failure) —
// the watch screen's retry loop decides whether to try again.
export async function fetchAnime3rbServers(animeTitle: string, epNumber: number): Promise<RawServer[]> {
  if (!animeTitle || epNumber == null) return [];
  const titleUrl = await resolveAnime3rbTitleUrl(animeTitle);
  if (!titleUrl) return [];
  const slug = titleUrl.replace(/\/+$/, "").split("/").pop();
  if (!slug) return [];
  const episodeUrl = `https://anime3rb.com/episode/${slug}/${epNumber}`;
  return scrapeAnime3rbEpisodeServers(episodeUrl).catch(() => [] as RawServer[]);
}

// Servers for a KNOWN anime3rb episode URL (no title/number resolution needed).
// Used when an anime3rb episode is the primary source on the watch screen.
export async function fetchAnime3rbServersByUrl(episodeUrl: string): Promise<RawServer[]> {
  if (!episodeUrl) return [];
  return scrapeAnime3rbEpisodeServers(episodeUrl).catch(() => [] as RawServer[]);
}

// Public resolver for an anime's anime3rb /titles/<slug> page (or null).
export async function findAnime3rbAnimeUrl(animeTitle: string): Promise<string | null> {
  return resolveAnime3rbTitleUrl(animeTitle).catch(() => null);
}

// anime3rb's full episode list for an anime, for the detail page's cross-source
// union — so episodes missing from witanime/anime4up still appear (and stay
// playable, since each href is a real anime3rb episode URL). Cached 6h; a miss
// isn't cached so a flaky resolve can retry on the next visit.
const A3RB_EPS_PREFIX = "@a3rb_eps_v1:";
const A3RB_EPS_TTL = 6 * 60 * 60 * 1000;
export async function fetchAnime3rbEpisodes(animeTitle: string): Promise<Episode[]> {
  if (!animeTitle || !animeTitle.trim()) return [];
  const titleUrl = await resolveAnime3rbTitleUrl(animeTitle);
  if (!titleUrl) return [];
  const cacheKey = A3RB_EPS_PREFIX + titleUrl;
  const cached = await readCache<Episode[]>(cacheKey, A3RB_EPS_TTL);
  if (cached) return cached;
  const detail = await scrapeAnime3rbTitlePage(titleUrl).catch(() => null);
  const eps: Episode[] = (detail?.episodes || []).map((e) => ({
    title: e.title, number: e.number, type: e.type, screenshot: e.screenshot, href: e.href,
  }));
  if (eps.length > 0) void writeCache(cacheKey, eps);
  return eps;
}

/* ── /recent ────────────────────────────────── */

export async function fetchRecent(page = 1): Promise<{
  success: boolean;
  data: { page: number; episodes: EpisodeItem[]; hasNext: boolean };
}> {
  return swr(
    RECENT_CACHE_PREFIX + page,
    RECENT_CACHE_TTL,
    async () => {
      const r = await scrapeRecent(page);
      const episodes: EpisodeItem[] = r.episodes.map((e) => ({
        title: e.title,
        href: e.href,
        image: imgOrEmpty(e.image),
        animeTitle: e.animeTitle,
        animeHref: e.animeHref,
        isNew: e.isNew,
      }));
      return { success: true, data: { page, episodes, hasNext: episodes.length > 0 } };
    },
    (d) => d.data.episodes.length > 0,
  );
}

/* ── /extract-video ─────────────────────────── */

type VideoServersPayload = {
  success: boolean;
  data: {
    episodeTitle: string;
    animeTitle: string;
    animeHref: string;
    serverCount: number;
    servers: (VideoServer & { source?: string })[];
    navigation: { prev: string | null; next: string | null };
    up4EpisodeUrl?: string;
  };
};

export async function fetchVideoServers(episodeUrl: string, url4up?: string, force = false): Promise<VideoServersPayload> {
  // Embed URLs on the episode page are stable for hours, so SWR-cache the
  // server LIST (the per-server video URL is still resolved live, since
  // those carry short-lived tokens). Re-opening an episode is instant.
  const primaryIsUp4 = /anime4up/i.test(episodeUrl);
  const key = `${SERVERS_CACHE_PREFIX}${episodeUrl}|${url4up || ""}`;
  // When a cross-source URL was requested, only cache COMPLETE results.
  // Caching a wit-only list (because the anime4up scrape timed out once)
  // used to hide the anime4up servers for the whole 6h TTL.
  const valid = (d: VideoServersPayload) =>
    d.data.servers.length > 0 &&
    (!url4up || primaryIsUp4 || d.data.servers.some((s) => s.source === "anime4up"));
  if (force) {
    // User-requested refresh: skip the cache entirely and re-scrape, so
    // servers that were missing from a cached/partial list can show up.
    const data = await fetchVideoServersFresh(episodeUrl, url4up);
    if (valid(data)) void writeCache(key, data);
    return data;
  }
  return swr(key, SERVERS_CACHE_TTL, () => fetchVideoServersFresh(episodeUrl, url4up), valid);
}

// anime4up's server list lives in the static HTML, so a single plain GET
// returns it in well under a second — the WebView render takes many seconds
// and often trips anime4up's ad gates. Fall back to the WebView scrape only
// when the direct parse yields nothing.
async function scrapeUp4ServersFast(episodeUrl: string) {
  try {
    const direct = await scrapeAnime4upEpisodePageDirect(episodeUrl);
    if (direct) {
      return { source: "anime4up", servers: direct.servers, episodeTitle: direct.episodeTitle, animeTitle: direct.animeTitle, up4EpisodeUrl: null as string | null };
    }
  } catch { /* fall through to the WebView scrape */ }
  return scrapeVideoServers(episodeUrl)
    .then((r) => ({ source: "anime4up", servers: r.servers, episodeTitle: r.episodeTitle, animeTitle: r.animeTitle, up4EpisodeUrl: null as string | null }))
    .catch(() => null);
}

async function fetchVideoServersFresh(episodeUrl: string, url4up?: string): Promise<VideoServersPayload> {
  const primaryIsUp4 = /anime4up/i.test(episodeUrl);
  // If we have a url4up AND the primary isn't already anime4up, scrape both
  // sources' servers in parallel (uses 2 WebView slots simultaneously).
  const tasks: Promise<{ source: string; servers: any[]; episodeTitle: string; animeTitle: string; up4EpisodeUrl?: string | null } | null>[] = [];

  if (primaryIsUp4) {
    tasks.push(scrapeUp4ServersFast(episodeUrl));
  } else {
    tasks.push(
      scrapeVideoServers(episodeUrl)
        .then((r) => ({
          source: "witanime",
          servers: r.servers,
          episodeTitle: r.episodeTitle,
          animeTitle: r.animeTitle,
          up4EpisodeUrl: r.up4EpisodeUrl ?? null,
        }))
        .catch(() => null),
    );
  }
  if (url4up && !primaryIsUp4) {
    tasks.push(scrapeUp4ServersFast(url4up));
  }

  const results = (await Promise.all(tasks)).filter((x): x is NonNullable<typeof x> => !!x);
  const primary = results[0];
  const secondary = results[1];

  // If the witanime page embedded a direct anime4up episode link, surface it
  // so the caller can enrich anime4up servers in the BACKGROUND. We don't
  // scrape it inline — that would delay showing the primary servers.
  const harvestedUp4 = primary && primary.source === "witanime" ? primary.up4EpisodeUrl : null;

  const seen = new Set<string>();
  const merged: (VideoServer & { source?: string })[] = [];
  function add(arr: any[] | undefined, source: string) {
    if (!arr) return;
    for (const s of arr) {
      if (!s.iframeUrl || seen.has(s.iframeUrl)) continue;
      // Drop unclassifiable "generic" servers from witanime — they're junk
      // (the site's own placeholder player) and only fall back to the embed.
      // Keep anime4up's generic-classified servers: their embed hosts often
      // aren't in the provider list but are real, playable servers.
      if (s.provider === "generic" && source !== "anime4up") continue;
      seen.add(s.iframeUrl);
      merged.push({
        id: String(merged.length),
        name: s.name,
        iframeUrl: s.iframeUrl,
        provider: s.provider,
        source,
      });
    }
  }
  // Witanime is primary, anime4up extras appended.
  if (primary && primary.source === "witanime") {
    add(primary.servers, "witanime");
    if (secondary) add(secondary.servers, "anime4up");
  } else if (primary && primary.source === "anime4up") {
    add(primary.servers, "anime4up");
  }

  return {
    success: true,
    data: {
      episodeTitle: primary?.episodeTitle || "",
      animeTitle: primary?.animeTitle || "",
      animeHref: "",
      serverCount: merged.length,
      servers: merged,
      navigation: { prev: null, next: null },
      up4EpisodeUrl: harvestedUp4 || undefined,
    },
  };
}

/* ── /search ────────────────────────────────── */

function toSearchResult(it: { title: string; href: string; image: string | null; type: string | null; status: string | null; synopsis?: string | null }): SearchResult {
  return {
    title: it.title,
    href: it.href,
    image: imgOrEmpty(it.image),
    type: it.type ?? undefined,
    status: it.status ?? undefined,
    synopsis: it.synopsis ?? undefined,
  };
}

export async function searchAnime(query: string): Promise<{
  success: boolean;
  data: { query: string; totalResults: number; results: SearchResult[] };
}> {
  return swr(
    SEARCH_CACHE_PREFIX + query.toLowerCase().trim(),
    SEARCH_CACHE_TTL,
    async () => {
      // Primary: witanime's static-HTML search via a plain GET — near-instant,
      // no WebView render. Fall back to the WebView scrape only if the direct
      // fetch fails (network / CF hiccup).
      let wit = await searchWitanimeDirectList(query).catch(() => null);
      if (!wit) wit = await scrapeSearch(query).catch(() => null);

      // Secondary: anime4up runs on the WebView (its static HTML is blocked to
      // plain fetches). Since the primary now lands instantly, give the
      // secondary only a short grace window and merge whatever arrived — its
      // extra titles still fill in on the next (cache-served) search.
      const up4P = scrapeSearchUp4(query).catch(() => null);
      const up4 = await Promise.race([
        up4P,
        new Promise<null>((r) => setTimeout(() => r(null), wit?.results.length ? 2500 : 15000)),
      ]);

      const results: SearchResult[] = (wit?.results ?? []).map(toSearchResult);
      const seen = new Set(results.map((r) => norm(r.title)));
      const mergeIn = (arr: { title: string; href: string; image: string | null; type: string | null; status: string | null; synopsis?: string | null }[]) => {
        for (const it of arr) {
          const k = norm(it.title);
          if (k && seen.has(k)) continue;
          if (k) seen.add(k);
          results.push(toSearchResult(it));
        }
      };
      if (up4?.results?.length) {
        // Dedupe across sources by normalised title so the same show
        // doesn't appear twice; anime4up-only titles get appended.
        mergeIn(up4.results);
      }

      // anime3rb (third source): surface anime that live ONLY on anime3rb —
      // its catalog matcher is conservative (near-total token coverage + exact
      // season), so a confident match is fetched for its poster/title and
      // appended if it isn't already in the list. Opening it routes through the
      // anime3rb detail branch above. Cheap (catalog is cached; one page GET)
      // and the whole search is SWR-cached, so it only runs on a cold query.
      try {
        const a3rbUrl =
          (await searchAnime3rbCatalog(query).catch(() => null)) ||
          (await searchAnime3rbDirect(query).catch(() => null));
        if (a3rbUrl) {
          const detail = await scrapeAnime3rbTitlePage(a3rbUrl).catch(() => null);
          if (detail?.title) {
            const k = norm(detail.title);
            if (!k || !seen.has(k)) {
              if (k) seen.add(k);
              results.push(toSearchResult({
                title: detail.title, href: a3rbUrl, image: detail.poster || null,
                type: null, status: null, synopsis: detail.synopsis || null,
              }));
            }
          }
        }
      } catch {}

      // Cross-language bridge: the source sites index each anime under a SINGLE
      // language, so an English query never finds a romaji-only title (and a
      // Japanese query never finds an English-only one). When the direct search
      // comes up empty, ask Jikan for the title's other names and re-search the
      // sites with the Latin-script ones (the sites don't index kanji).
      if (results.length === 0) {
        const alts = await getAltTitles(query).catch(() => []);
        const tried = new Set<string>([norm(query)]);
        const candidates = alts
          .filter((a) => /[a-z]/i.test(a)) // sites index romaji/English, not kanji
          .filter((a) => {
            const n = norm(a);
            if (!n || tried.has(n)) return false;
            tried.add(n);
            return true;
          })
          .slice(0, 2);
        for (const alt of candidates) {
          let wAlt = await searchWitanimeDirectList(alt).catch(() => null);
          if (!wAlt) wAlt = await scrapeSearch(alt).catch(() => null);
          if (wAlt?.results?.length) mergeIn(wAlt.results);
          const upAlt = await scrapeSearchUp4(alt).catch(() => null);
          if (upAlt?.results?.length) mergeIn(upAlt.results);
          if (results.length) break;
        }
      }
      return { success: true, data: { query, totalResults: results.length, results } };
    },
    (d) => d.data.results.length > 0,
  );
}

/* ── /genre ─────────────────────────────────── */

export async function fetchGenre(name: string, page = 1): Promise<{
  success: boolean;
  data: { genre: string; page: number; items: SearchResult[]; hasNext: boolean };
}> {
  return swr(
    `${LISTING_CACHE_PREFIX}genre:${name}:${page}`,
    LISTING_CACHE_TTL,
    async () => {
      // Fast path: parse the static genre page directly (no WebView). The page
      // lists every title at once, so this paginates client-side.
      const direct = await scrapeGenreDirect(name, page).catch(() => null);
      if (direct && direct.items.length > 0) {
        const items: SearchResult[] = direct.items.map(toSearchResult);
        return { success: true, data: { genre: name, page, items, hasNext: direct.hasNext } };
      }
      // Fallback: WebView scrape.
      const r = await scrapeGenre(name, page);
      const items: SearchResult[] = r.items.map((it) => ({
        title: it.title,
        href: it.href,
        image: imgOrEmpty(it.image),
        type: it.type ?? undefined,
        status: it.status ?? undefined,
      }));
      return { success: true, data: { genre: name, page, items, hasNext: items.length > 0 } };
    },
    (d) => d.data.items.length > 0,
  );
}

/* ── /all-anime ─────────────────────────────── */

export async function fetchAllAnime(page = 1): Promise<{
  success: boolean;
  data: { page: number; items: SearchResult[]; hasNext: boolean };
}> {
  return swr(
    `${LISTING_CACHE_PREFIX}all:${page}`,
    LISTING_CACHE_TTL,
    async () => {
      // Fast path: parse the static all-anime page directly (no WebView).
      const direct = await scrapeAllAnimeDirect(page).catch(() => null);
      if (direct && direct.items.length > 0) {
        const items: SearchResult[] = direct.items.map(toSearchResult);
        return { success: true, data: { page, items, hasNext: direct.hasNext } };
      }
      // Fallback: WebView scrape.
      const r = await scrapeAllAnime(page);
      const items: SearchResult[] = r.items.map((it) => ({
        title: it.title,
        href: it.href,
        image: imgOrEmpty(it.image),
        type: it.type ?? undefined,
        status: it.status ?? undefined,
      }));
      return { success: true, data: { page, items, hasNext: items.length > 0 } };
    },
    (d) => d.data.items.length > 0,
  );
}

/* ── /resolve-video ─────────────────────────── */

export async function resolveVideo(iframeUrl: string, provider: string, priority = false): Promise<{
  success: boolean;
  data?: { videoUrl: string; type: string };
  error?: string;
}> {
  // anime3rb's first-party host: one static GET on the player page yields
  // direct tokenized .mp4 qualities — near-instant, no WebView slot needed.
  if (provider === "vid3rb") {
    const r = await extractVid3rb(iframeUrl).catch(() => null);
    if (r) return { success: true, data: { videoUrl: r.url, type: r.type } };
    return { success: false, error: "Could not extract vid3rb video URL" };
  }
  // mp4upload now inlines the direct .mp4 URL in the embed page's static
  // HTML (no more packed JS), so a plain GET resolves it instantly and
  // reliably — the WebView scrape below stays as the fallback for the rare
  // mirror that still serves the packed player.
  if (provider === "mp4upload") {
    const r = await extractMp4upload(iframeUrl).catch(() => null);
    if (r) return { success: true, data: { videoUrl: r.url, type: r.type } };
  }
  try {
    const r = await scrapeExtractVideoUrl(iframeUrl, priority);
    return {
      success: true,
      data: { videoUrl: r.url, type: /\.m3u8/i.test(r.url) ? "hls" : "mp4" },
    };
  } catch (e: any) {
    return { success: false, error: e?.message ?? "Could not extract video URL" };
  }
}

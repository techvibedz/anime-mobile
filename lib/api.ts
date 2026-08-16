// All data is scraped in-app via a hidden WebView (lib/scraper).
// No HTTP backend is required.

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  scrapeWitanimeHome,
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
  searchAnime4upDirectList,
  scrapeAnime4upEpisodePageDirect,
  scrapeWitanimeEpisodePageDirect,
  findUp4EpisodeAcrossPages,
  searchAnime3rbDirect,
  searchAnime3rbCatalog,
  searchAnime3rbCatalogFuzzy,
  searchAnime3rbFamily,
  scrapeAnime3rbEpisodeServers,
  scrapeAnime3rbTitlePage,
  anime3rbExactSlugs,
  tm_seasonNum,
  extractVid3rb,
  extractMp4upload,
  extractStreamwish,
  extractVideas,
  extractDoodstream,
  fetchWitHomeDirect,
  type WitHome,
} from "./scraper/direct";
import { getAltTitles, getAnimeYearType } from "./animeInfo";
import { fuzzyScore } from "./fuzzy";
import { readCloudMetadata, writeCloudMetadata } from "./metadataCache";
import { writeCloudHome } from "./homeCloudCache";
import { loadWitanimeHome } from "./homeSourceSelection";
import { remoteLog } from "./remoteLog";
import { createRequestCache, withTimeout } from "./requestCache";
import {
  anime4upEpisodeUrl,
  episodeNumberFromUrl,
  isResolvedDownloadServer,
  validateDirectServers,
  isProviderSupported,
  mergeVideoServers,
  selectDownloadCandidates,
  selectServerCandidates,
  serverCandidateSignature,
  normalizeServerUrl,
  probeMediaUrl,
  providerPolicy,
  preferredAnime4upEpisodeUrl,
  selectWarmupServers,
  validateMediaUrl,
  videoContentType,
  videoPlaybackHeaders,
} from "./videoProviders";

// v2 cache keys: bumped to discard payloads written by the earlier build that
// merged anime3rb into the "new episodes" rail and could cache an anime3rb
// detail page with a boilerplate/seasons-grid synopsis. Old cached entries
// are simply ignored, forcing a fresh scrape with the current parsers.
const HOME_CACHE_KEY = "@home_cache_v3";
const HOME_CACHE_TTL = 30 * 60 * 1000; // 30 min
const DETAIL_CACHE_PREFIX = "@detail_v2:";
const DETAIL_CACHE_TTL = 30 * 60 * 1000; // 30 min
const UP4_CACHE_PREFIX = "@up4_eps_v2:";
const UP4_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 h
const SEARCH_CACHE_PREFIX = "@search_v1:";
const SEARCH_CACHE_TTL = 15 * 60 * 1000; // 15 min
const LISTING_CACHE_PREFIX = "@listing_v1:";
const LISTING_CACHE_TTL = 30 * 60 * 1000; // 30 min
const RECENT_CACHE_PREFIX = "@recent_v2:";
const RECENT_CACHE_TTL = 10 * 60 * 1000; // 10 min — new episodes land often
const SERVERS_CACHE_PREFIX = "@servers_v3:";
const SERVERS_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 h — embed URLs are stable
const XSOURCE_CACHE_KEY = "@xsource_v1";
const serverRequests = createRequestCache<VideoServersPayload>(SERVERS_CACHE_TTL);
const completeVideoServerRequests = createRequestCache<VideoServersPayload>(30_000);
const videoResolutionRequests = createRequestCache<ResolveVideoResult>(20_000);

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
  videoUrl?: string;
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

// Strip the SEO boilerplate the source sites bake into an anime page's "story"
// field so the detail screen never shows junk like "تحميل ومشاهدة جميع حلقات
// أنمي … اون لاين بجودة عالية … Anime3rb". A real Arabic synopsis is kept intact;
// pure boilerplate collapses to "" and the synopsis block simply hides.
const SYNOPSIS_JUNK =
  /تحميل\s*و?\s*مشاهدة|مشاهدة\s*و?\s*تحميل|اون\s*لاين|أون\s*لاين|أونلاين|بجودة\s*عالية|جميع\s*(?:ال)?حلقات|anime3rb|anime4up|witanime|أنمي\s*عرب|انمي\s*عرب|حصريا?ً?\s*على|موقع\s*انمي|تابعنا|شاهد\s*الآن|بدون\s*إعلانات/i;
function cleanSynopsis(raw: string | null | undefined): string {
  let s = (raw || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  // Drop a leading "قصة الأنمي:" / "القصة:" / "Story:" label.
  s = s.replace(/^\s*(?:قصة\s*(?:الأنمي|الانمي)?|القصة|story|synopsis)\s*[:：\-–]?\s*/i, "").trim();
  if (SYNOPSIS_JUNK.test(s)) {
    // Remove only the segments carrying the boilerplate markers; keep any real
    // story sentences that may sit alongside them. anime3rb's SEO blurb has no
    // sentence punctuation (it chains alt-titles with " - "/"|"/"،"), so split
    // on those separators too — otherwise the whole run survived as one segment.
    const kept = s
      .split(/[.!؟\n|،]+|\s[-–—]\s/)
      .map((p) => p.trim())
      .filter((p) => p && !SYNOPSIS_JUNK.test(p));
    s = kept.join(". ").trim();
    // If boilerplate markers still survive after segmenting, the text is SEO
    // junk through-and-through — drop it entirely rather than show a fragment.
    if (SYNOPSIS_JUNK.test(s)) return "";
  }
  // Anything shorter than a clause is almost certainly a leftover fragment.
  return s.length < 25 ? "" : s;
}

// Strip the SEO/source decoration the sites bake into an anime's TITLE so the
// detail page shows just the anime's name. anime3rb's og:title arrives as
// "أنمي <Name> مترجم - Anime3rb أنمي عرب" — a leading "أنمي" word, a trailing
// "مترجم"/"مدبلج", and a site-name suffix — and witanime/anime4up occasionally
// add the same. A clean name ALSO makes the downstream Jikan/AniList lookups
// (rating badge, Info tab, related anime) resolve to the right entry instead of
// choking on the decorated string. Clean titles (witanime/anime4up's
// .anime-details-title) pass through unchanged.
function cleanAnimeTitle(raw: string | null | undefined): string {
  let s = (raw || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  // Site-name suffix: "… - Anime3rb أنمي عرب", "… - Anime4up", "… | WitAnime".
  s = s.replace(/\s*[|–—\-]\s*(?:anime3rb|anime4up|witanime)\b.*$/i, "").trim();
  // Leading source words ("مشاهدة"، "تحميل"، "جميع حلقات"، "أنمي"…).
  s = s.replace(/^(?:مشاهدة|تحميل|جميع\s*(?:حلقات|الحلقات)|أنمي|انمي|انيمي)\s+/g, "").trim();
  s = s.replace(/^(?:أنمي|انمي|انيمي)\s+/g, "").trim(); // a second leading word
  // Trailing decoration ("مترجم"، "مدبلج"، "اون لاين"، "بجودة عالية"…), chained.
  for (let i = 0; i < 3; i++) {
    s = s.replace(/\s*(?:مترجمة?|مدبلجة?|اون\s*لاين|أون\s*لاين|أونلاين|بجودة\s*عالية|كامل[ةه]?)\s*$/g, "").trim();
  }
  return s.replace(/\s+/g, " ").trim();
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

function sourceHomeHasContent(home: WitHome | null | undefined): home is WitHome {
  return !!home && (home.featured.length > 0 || home.animes.length > 0 || home.episodes.length > 0);
}

function buildHomePayload(
  wit: { featured: FeaturedItem[]; animes: any[]; episodes: any[] },
  up4Animes: { title: string; href: string; image: string | null; type: string | null }[],
  // Label the cards with the source they actually came from. Normally
  // "witanime"; the anime3rb last-resort path passes "anime3rb" so the detail
  // screen treats the href as an anime3rb page (not a witanime one).
  primarySource: "witanime" | "anime4up" | "anime3rb" = "witanime",
): HomePayload {
  const used4up = new Set<string>();
  const merged: MergedAnimeItem[] = wit.animes.map((w: any) => {
    const m = up4Animes.find((u) => !used4up.has(u.href) && fuzzyMatch(w.title, u.title));
    const item: MergedAnimeItem = {
      ...w,
      image: imgOrEmpty(w.image),
      sources: [primarySource],
      sourceHrefs: { [primarySource]: w.href },
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
  const home = await loadWitanimeHome<WitHome>(
    async () => {
      const direct = await fetchWitHomeDirect();
      return sourceHomeHasContent(direct) ? direct : null;
    },
    async () => {
      const viaWebView = await scrapeWitanimeHome();
      return sourceHomeHasContent(viaWebView) ? viaWebView : null;
    },
  );
  if (!home) {
    void remoteLog("warn", "home", "Witanime home unavailable", { witanime: "empty" });
    return { success: true, data: { featured: [], sections: [] } };
  }
  const result = buildHomePayload(home, []);
  // Only persist a payload that actually has content. Caching an empty scrape
  // would freeze "zero content" for the whole TTL and the SWR path would keep
  // serving it on every launch.
  if (homeHasContent(result)) {
    void writeCache(HOME_CACHE_KEY, result);
    // Scout upload: share this live-scraped feed so source-blocked devices can
    // serve it from the cloud cache (throttled + validated server-side).
    void writeCloudHome(result);
  }
  return result;
}

// Cheap change detector for the SWR push: a new episode / new trending entry
// always alters a section's item count or its first item, so comparing section
// counts + lead hrefs catches every visible change without a full deep-equal.
function homeSignature(p: HomePayload): string {
  return (
    p.data.sections.map((s) => `${s.id}:${s.items.length}:${s.items[0]?.href || ""}`).join("|") +
    "#" + (p.data.featured[0]?.href || "")
  );
}

export async function fetchHome(onUpdated?: (p: HomePayload) => void): Promise<HomePayload> {
  // Stale-while-revalidate: return cached payload immediately if present,
  // then kick off a background refresh. When the fresh scrape lands with
  // visibly different content, push it to the open screen via onUpdated so the
  // user sees new episodes WITHOUT a manual pull-to-refresh.
  const cached = await readCache<HomePayload>(HOME_CACHE_KEY, HOME_CACHE_TTL);
  if (homeHasContent(cached)) {
    if (!bgRefreshInFlight) {
      bgRefreshInFlight = true;
      void fetchHomeFresh()
        .then((fresh) => {
          if (onUpdated && homeHasContent(fresh) && homeSignature(fresh) !== homeSignature(cached))
            onUpdated(fresh);
        })
        .catch(() => {})
        .finally(() => { bgRefreshInFlight = false; });
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
        title: cleanAnimeTitle(a?.title),
        poster: a?.poster || "",
        banner: a?.poster || "",
        synopsis: cleanSynopsis(a?.synopsis),
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
    if (a) {
      void writeCache(DETAIL_CACHE_PREFIX + animeUrl, payload);
      // Scout upload to the crowdsourced cloud cache so the next user of any
      // device renders this anime3rb page instantly. Only a payload with real
      // episodes is shared — never an empty/failed scrape.
      if (payload.data.episodes.length > 0)
        void writeCloudMetadata(animeUrl, payload, payload.data.episodes.length, payload.data.title);
    }
    return payload;
  }
  // Fast path: primary source only. Cross-source enrichment is fetched in
  // the background via fetchEpisodesUp4 — see the detail screen.
  const d = await scrapeEpisodesPage(animeUrl);
  const payload: EpisodesPayload = {
    success: true,
    data: {
      title: cleanAnimeTitle(d.title),
      poster: d.poster,
      banner: d.poster,
      synopsis: cleanSynopsis(d.synopsis),
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
  // Scout upload to the crowdsourced cloud cache (only when the scrape actually
  // produced episodes — a zero-episode detail page is usually a failed scrape
  // and must not poison the shared cache).
  if (payload.data.episodes.length > 0)
    void writeCloudMetadata(animeUrl, payload, payload.data.episodes.length, payload.data.title);
  return payload;
}

// Cheap change detector for the detail-page SWR push: a newly-aired episode
// changes the episode count (and a lead href), so this catches every visible
// update without deep-comparing the whole payload.
function detailSignature(p: EpisodesPayload): string {
  const eps = p.data.episodes;
  return `${p.data.totalEpisodes}:${eps.length}:${eps[0]?.href || ""}:${eps[eps.length - 1]?.href || ""}`;
}

export async function fetchEpisodes(animeUrl: string, onUpdated?: (p: EpisodesPayload) => void): Promise<EpisodesPayload> {
  // Re-clean the title AND synopsis on every return path so entries
  // cached/uploaded by an older build display cleanly too. Crucial for the
  // synopsis: older builds (and anime3rb's og:description fallback) cached SEO
  // boilerplate as the "story" ("مشاهدة وتحميل … اون لاين بجودة عالية …
  // Anime3rb أنمي عرب"). The live scrape already nukes that via cleanSynopsis,
  // but a cache/cloud HIT skipped re-cleaning, so the junk wall persisted under
  // the genres on every reopen. Re-running cleanSynopsis collapses pure
  // boilerplate to "" and the synopsis block simply hides.
  const clean = (p: EpisodesPayload): EpisodesPayload => {
    if (p?.data) {
      p.data.title = cleanAnimeTitle(p.data.title);
      p.data.synopsis = cleanSynopsis(p.data.synopsis);
    }
    return p;
  };
  // Read-through cache, fastest tier first:
  // 1) On-device cache — instant, offline-capable. Revalidate in the background
  //    and PUSH the fresh payload to the open screen when it visibly changed,
  //    so a newly-aired episode shows without a manual refresh.
  const cached = await readCache<EpisodesPayload>(DETAIL_CACHE_PREFIX + animeUrl, DETAIL_CACHE_TTL);
  if (cached) {
    void fetchEpisodesFresh(animeUrl)
      .then((fresh) => {
        if (onUpdated && fresh?.data && detailSignature(fresh) !== detailSignature(cached))
          onUpdated(clean(fresh));
      })
      .catch(() => {});
    return clean(cached);
  }
  // 2) Crowdsourced cloud cache — another device already scouted this anime, so
  //    render instantly with NO live scrape. Seed the on-device cache so the
  //    next open is offline-instant. Only when the shared entry is stale do we
  //    pay for a background re-scrape (which upserts and refreshes it for all).
  const cloud = await readCloudMetadata<EpisodesPayload>(animeUrl).catch(() => null);
  if (cloud?.payload?.data) {
    void writeCache(DETAIL_CACHE_PREFIX + animeUrl, cloud.payload);
    if (cloud.stale)
      void fetchEpisodesFresh(animeUrl)
        .then((fresh) => {
          if (onUpdated && fresh?.data && detailSignature(fresh) !== detailSignature(cloud.payload))
            onUpdated(clean(fresh));
        })
        .catch(() => {});
    return clean(cloud.payload);
  }
  // 3) Cold path — live scrape on the residential IP, then scout-upload.
  return clean(await fetchEpisodesFresh(animeUrl));
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
// v2: bumped to discard slug mappings written by the pre-Roman-season build,
// which resolved later seasons ("Mushoku Tensei III") to season 1's page and
// re-wrote that wrong slug on every hit so it never aged out. A fresh key forces
// re-resolution with the season-aware logic (which correctly returns nothing
// when a later season isn't on anime3rb).
// v3: bumped to discard slug mappings that predate the year/format
// disambiguation — franchises with an old film + a new TV remake ("Koukaku
// Kidoutai" 1995 vs "Koukaku Kidoutai (TV)" 2026) could be locked onto the OLD
// entry, and the wrong slug was re-written on every hit so it never aged out.
const A3RB_TITLE_PREFIX = "@a3rb_title_v3:";
// Titles whose Jikan alt-name bridge has already been attempted this session.
// The bridge hits Jikan + probes anime3rb with each alt name; a fundamental
// name mismatch won't change between the watch screen's retries, so run it at
// most once per title (the cheap slug/catalog probes above still retry every
// call for transient resilience).
const a3rbBridgeTried = new Set<string>();

// Cache-only lookup of an anime's resolved anime3rb title URL — no network.
// Lets the watch path use a known slug instantly and otherwise fall through to
// the fast direct-slug probe before paying for the full resolver.
async function peekAnime3rbTitleUrl(animeTitle: string): Promise<string | null> {
  const key = animeTitle.toLowerCase().trim();
  const hit = a3rbTitleCache.get(key);
  if (hit && Date.now() - hit.ts < UP4_CACHE_TTL) return hit.url;
  const stored = await readCache<string>(A3RB_TITLE_PREFIX + key, UP4_CACHE_TTL);
  if (stored) { a3rbTitleCache.set(key, { url: stored, ts: Date.now() }); return stored; }
  return null;
}

// Persist a confirmed title URL so later episodes of the same anime are instant.
function rememberAnime3rbTitleUrl(animeTitle: string, url: string) {
  const key = animeTitle.toLowerCase().trim();
  a3rbTitleCache.set(key, { url, ts: Date.now() });
  void writeCache(A3RB_TITLE_PREFIX + key, url);
}

async function resolveAnime3rbTitleUrl(animeTitle: string): Promise<string | null> {
  if (!animeTitle) return null;
  const key = animeTitle.toLowerCase().trim();
  const cached = await peekAnime3rbTitleUrl(animeTitle);
  if (cached) return cached;
  // What AniList knows about this anime (release year, film vs series). Franchises
  // with an old film AND a new TV remake share the base name, so title matching
  // alone can lock onto the wrong entry ("Koukaku Kidoutai" 1995 instead of the
  // 2026 TV remake). Null-safe: when AniList can't resolve the title, matching
  // falls back to title-only behaviour.
  const want = await getAnimeYearType(animeTitle).catch(() => null);
  // Slug guessing first: anime3rb's slugs derive cleanly from romaji titles,
  // so this lands in one or two cheap GETs for the vast majority of anime.
  let url = await searchAnime3rbDirect(animeTitle, want).catch(() => null);
  if (!url) {
    // Catalog matching second: anime3rb's daily titles sitemap (one plain
    // GET, cached in-memory) covers anime whose slug can't be guessed —
    // different romanization, alt-name-only indexing, shortened titles.
    url = await searchAnime3rbCatalog(animeTitle, want).catch(() => null);
  }
  if (!url && want) {
    // Same-base family scan: the new TV remake of an old franchise lives at a
    // "-tv"/suffixed slug no guess produces, so only a year/format-filtered
    // scan of the whole family finds it. No extra fetches for ordinary anime.
    url = await searchAnime3rbFamily(animeTitle, want).catch(() => null);
  }
  // NOTE: no /search fallback. anime3rb's /search sits behind a Cloudflare
  // managed challenge, so failing fast here lets the watch screen's retry
  // loop converge instead of pinning a doomed request.
  if (!url && !a3rbBridgeTried.has(key)) {
    // Cross-language bridge — the main reason anime3rb "sometimes doesn't show".
    // witanime/anime4up may hand us an Arabic title, or a romanization anime3rb
    // doesn't index under (King's Game ↔ Ousama Game, Re:Zero ↔ rezero). Ask
    // Jikan for the anime's other names and retry the slug + catalog match with
    // each Latin one (anime3rb's slugs are Latin). This is the SAME bridge the
    // search screen uses, and getAltTitles caches its result so retries are free.
    a3rbBridgeTried.add(key);
    // getAltTitles cleans the season off the query before hitting Jikan, so its
    // names are the BASE franchise names (season 1's). Bridging them as-is for a
    // later season would match the WRONG season's page (wrong episode numbering).
    // So detect the wanted season and, for season >= 2, RE-ATTACH it to each alt
    // name — a3rbSlugVariants then builds the correct season's slugs and
    // probeA3rbTitlePage's own season check keeps the match locked to that
    // season. This lets later-season anime resolve their anime3rb page too
    // (previously they were skipped entirely, the main reason "a lot of animes"
    // never showed anime3rb servers).
    // Pass the ORIGINAL-case title so Roman-numeral seasons ("Mushoku Tensei
    // III") are detected — the lowercased `key` would hide the uppercase-roman
    // discriminator that keeps a stray "v"/"x" from being read as a season.
    const seasonNum = tm_seasonNum(animeTitle);
    const alts = await getAltTitles(animeTitle).catch(() => []);
    for (const alt of alts) {
      if (!/[a-z]/i.test(alt)) continue;            // need Latin script for the slug
      // Re-attach the season marker for later seasons; season 1 / no-season
      // titles probe the alt name as-is.
      const altQ = seasonNum >= 2 ? `${alt} season ${seasonNum}` : alt;
      if (altQ.toLowerCase().trim() === key) continue; // already tried as the primary
      url =
        (await searchAnime3rbDirect(altQ, want).catch(() => null)) ||
        (await searchAnime3rbCatalog(altQ, want).catch(() => null));
      if (url) break;
    }
  }
  if (url) {
    a3rbTitleCache.set(key, { url, ts: Date.now() });
    void writeCache(A3RB_TITLE_PREFIX + key, url);
  }
  return url;
}

// Built anime3rb server lists, keyed by `${titleKey}#${epNum}`. The playerUrl
// embedded in each server carries a token (~expires), so the TTL is short. This
// makes re-opening an episode — and, crucially, a PREFETCHED next episode while
// binge-watching — play instantly with no fetch at all.
const a3rbServersMem = new Map<string, { servers: RawServer[]; ts: number }>();
const A3RB_SERVERS_TTL = 12 * 60 * 1000;
const a3rbServerRequests = createRequestCache<RawServer[]>(A3RB_SERVERS_TTL);
function a3rbServersKey(animeTitle: string, epNumber: number) {
  return `${animeTitle.toLowerCase().trim()}#${epNumber}`;
}

// Warm the caches for an episode the user is LIKELY to watch next (called from
// the watch screen for epNum±1 while the current one plays). Fire-and-forget;
// fetchAnime3rbServers stores the result, so the actual tap is instant.
export function prefetchAnime3rbServers(animeTitle: string, epNumber: number): void {
  if (!animeTitle || epNumber == null || epNumber < 1) return;
  if (a3rbServersMem.has(a3rbServersKey(animeTitle, epNumber))) return;
  void fetchAnime3rbServers(animeTitle, epNumber).catch(() => {});
}

// Servers for an episode by anime title + episode number. Returns [] on any
// miss (unknown anime, episode not yet uploaded, transient fetch failure).
// Explicit refresh is the retry boundary; identical in-flight calls coalesce.
async function fetchAnime3rbServersFresh(animeTitle: string, epNumber: number): Promise<RawServer[]> {
  if (!animeTitle || epNumber == null) return [];
  const epUrlFor = (slug: string) => `https://anime3rb.com/episode/${slug}/${epNumber}`;
  const memKey = a3rbServersKey(animeTitle, epNumber);

  // 0) Already built (re-open or prefetch hit) — instant, no network.
  const mem = a3rbServersMem.get(memKey);
  if (mem && Date.now() - mem.ts < A3RB_SERVERS_TTL) return mem.servers;
  const remember = (servers: RawServer[]) => {
    if (servers.length) a3rbServersMem.set(memKey, { servers, ts: Date.now() });
    return servers;
  };

  // 1) Known slug (cache hit) — one episode-page fetch, straight to servers.
  const cachedTitle = await peekAnime3rbTitleUrl(animeTitle);
  if (cachedTitle) {
    const slug = cachedTitle.replace(/\/+$/, "").split("/").pop();
    if (slug) {
      const servers = await scrapeAnime3rbEpisodeServers(epUrlFor(slug)).catch(() => [] as RawServer[]);
      if (servers.length) return remember(servers);
      // Cached slug yielded nothing (episode not on anime3rb yet, or stale
      // mapping) — fall through to the guess/resolve paths below.
    }
  }

  // 2) Fast direct-slug path: try the EXACT slug guesses' episode URLs directly.
  // The episode page itself proves the slug (it carries video_url only for the
  // right anime), so this skips a whole separate title-page fetch — which on
  // device is frequently a slow WebView Cloudflare render. Wrong guesses 404 on
  // a cheap raw GET (no WebView escalation), so the overhead is tiny. The first
  // slug that produces servers is remembered so later episodes are instant.
  for (const slug of anime3rbExactSlugs(animeTitle)) {
    const servers = await scrapeAnime3rbEpisodeServers(epUrlFor(slug)).catch(() => [] as RawServer[]);
    if (servers.length) {
      rememberAnime3rbTitleUrl(animeTitle, `https://anime3rb.com/titles/${slug}`);
      return remember(servers);
    }
  }

  // 3) Full resolver (catalog sitemap + Jikan cross-language bridge) for anime
  // whose slug can't be guessed. Verifies the title page, then builds the URL.
  const titleUrl = await resolveAnime3rbTitleUrl(animeTitle);
  if (!titleUrl) return [];
  const slug = titleUrl.replace(/\/+$/, "").split("/").pop();
  if (!slug) return [];
  return remember(await scrapeAnime3rbEpisodeServers(epUrlFor(slug)).catch(() => [] as RawServer[]));
}

export function fetchAnime3rbServers(animeTitle: string, epNumber: number): Promise<RawServer[]> {
  if (!animeTitle || epNumber == null) return Promise.resolve([]);
  const key = a3rbServersKey(animeTitle, epNumber);
  return a3rbServerRequests.run(
    key,
    () => fetchAnime3rbServersFresh(animeTitle, epNumber),
    { valid: (servers) => servers.length > 0 },
  );
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

// On-device diagnostic: walks the whole anime3rb chain for a title + episode and
// returns a human-readable trace of each step, so a "no Anime3rb server" report
// can be pinpointed on the actual phone/network (where it works from a desktop).
// Surfaced on the /scraper-debug screen.
export async function diagnoseAnime3rb(title: string, epNum: number): Promise<string> {
  const log: string[] = [];
  const stamp = (label: string, v: any) => log.push(`${label}: ${v}`);
  try {
    const t0 = Date.now();
    const titleUrl = await resolveAnime3rbTitleUrl(title).catch((e) => `ERR ${e?.message || e}`);
    stamp(`1) resolve title (${Date.now() - t0}ms)`, titleUrl || "NULL — title not found on anime3rb");
    if (!titleUrl || typeof titleUrl !== "string" || !/^https?:/.test(titleUrl)) {
      log.push("→ STOP: title resolution failed (slug guess + catalog + Jikan bridge all missed).");
      return log.join("\n");
    }
    const slug = titleUrl.replace(/\/+$/, "").split("/").pop();
    const episodeUrl = `https://anime3rb.com/episode/${slug}/${epNum}`;
    stamp("2) episode url", episodeUrl);
    const t1 = Date.now();
    const servers = await scrapeAnime3rbEpisodeServers(episodeUrl).catch((e) => {
      log.push(`   scrape ERR: ${e?.message || e}`);
      return [] as RawServer[];
    });
    stamp(`3) servers built (${Date.now() - t1}ms)`, servers.length);
    servers.forEach((s) => log.push(`   • ${s.name} [${s.provider}] ${s.iframeUrl.slice(0, 64)}`));
    if (servers.length === 0) {
      log.push("→ STOP: episode page reachable? player url / video_sources missing (CF block or wrong episode).");
      return log.join("\n");
    }
    const t2 = Date.now();
    const r = await resolveVideo(servers[0].iframeUrl, servers[0].provider).catch((e) => ({ success: false, error: e?.message || String(e) }));
    stamp(`4) extract play url (${Date.now() - t2}ms)`, r.success ? (r as any).data?.videoUrl?.slice(0, 90) : `FAIL — ${(r as any).error}`);
    log.push(r.success ? "→ OK: full chain works on this device/network." : "→ extraction failed (player page or CDN unreachable).");
  } catch (e: any) {
    log.push(`FATAL: ${e?.message || String(e)}`);
  }
  return log.join("\n");
}

// anime3rb's full episode list for an anime, for the detail page's cross-source
// union — so episodes missing from witanime/anime4up still appear (and stay
// playable, since each href is a real anime3rb episode URL). Cached 6h; a miss
// isn't cached so a flaky resolve can retry on the next visit.
const A3RB_EPS_PREFIX = "@a3rb_eps_v3:"; // v3: discard episode lists keyed by pre-disambiguation (wrong-version) title URLs
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
  return serverRequests.run(key, async () => {
    if (!force) {
      const cached = await readCache<VideoServersPayload>(key, SERVERS_CACHE_TTL);
      if (cached && valid(cached)) return cached;
    }
    const data = await fetchVideoServersFresh(episodeUrl, url4up);
    if (valid(data)) void writeCache(key, data);
    return data;
  }, { force, valid });
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

// witanime hides its server embeds in an obfuscated _zX/_zK registry that only
// its gh100.js decodes on click. The WebView render depends on those clicks
// firing past witanime's Cloudflare gate and frequently comes back empty — so
// decode the registry straight from the static HTML. Falls back to the WebView
// scrape when the direct decode yields nothing (older pages that still ship
// plain iframes). `direct` lets the merge keep validated servers even if
// generic, so a brand-new witanime host still plays instead of vanishing.
async function scrapeWitServersFast(episodeUrl: string) {
  try {
    const direct = await scrapeWitanimeEpisodePageDirect(episodeUrl);
    if (direct) {
      return { source: "witanime", servers: direct.servers, episodeTitle: direct.episodeTitle, animeTitle: direct.animeTitle, up4EpisodeUrl: null as string | null, direct: true };
    }
  } catch { /* fall through to the WebView scrape */ }
  return scrapeVideoServers(episodeUrl)
    .then((r) => ({ source: "witanime", servers: r.servers, episodeTitle: r.episodeTitle, animeTitle: r.animeTitle, up4EpisodeUrl: r.up4EpisodeUrl ?? null }))
    .catch(() => null);
}

async function fetchVideoServersFresh(episodeUrl: string, url4up?: string): Promise<VideoServersPayload> {
  const primaryIsUp4 = /anime4up/i.test(episodeUrl);
  // If we have a url4up AND the primary isn't already anime4up, scrape both
  // sources' servers in parallel (uses 2 WebView slots simultaneously).
  const tasks: Promise<{ source: string; servers: any[]; episodeTitle: string; animeTitle: string; up4EpisodeUrl?: string | null; direct?: boolean } | null>[] = [];

  if (primaryIsUp4) {
    tasks.push(scrapeUp4ServersFast(episodeUrl));
  } else {
    tasks.push(scrapeWitServersFast(episodeUrl));
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

  const groups: (VideoServer & { source?: string })[][] = [];
  function add(arr: any[] | undefined, source: string) {
    if (!arr) return;
    const group: (VideoServer & { source?: string })[] = [];
    for (const s of arr) {
      if (!s.iframeUrl || !isProviderSupported(s.provider)) continue;
      group.push({
        id: String(group.length),
        name: s.name,
        iframeUrl: s.iframeUrl,
        provider: s.provider,
        source,
      });
    }
    groups.push(group);
  }
  // Witanime is primary, anime4up extras appended.
  if (primary && primary.source === "witanime") {
    add(primary.servers, "witanime");
    if (secondary) add(secondary.servers, "anime4up");
  } else if (primary && primary.source === "anime4up") {
    add(primary.servers, "anime4up");
  }
  const merged = mergeVideoServers(groups);

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

export type CompleteVideoServersOptions = {
  episodeUrl: string;
  url4up?: string | null;
  url3rb?: string | null;
  animeHref?: string | null;
  animeTitle?: string | null;
  episodeNumber?: number | null;
  force?: boolean;
  // Called once the PRIMARY source's servers are ready, before the slower
  // anime4up/anime3rb cross-source lookups finish — the watch screen shows
  // these immediately and merges the complete list when it lands.
  onPartial?: (payload: VideoServersPayload) => void;
  onCandidates?: (payload: VideoServersPayload) => void;
};

async function resolveDirectServerList(
  servers: readonly (VideoServer & { source?: string })[],
  timeoutMs: number,
  fresh: boolean,
  onUpdate?: (servers: (VideoServer & { source?: string; videoUrl: string })[]) => void,
): Promise<(VideoServer & { source?: string; videoUrl: string })[]> {
  return validateDirectServers(
    servers,
    (server) => resolveDirectServerUrl(server, timeoutMs, fresh),
    onUpdate,
  );
}

async function resolveDirectServerUrl(
  server: VideoServer,
  timeoutMs: number,
  fresh: boolean,
): Promise<string | null> {
  const result = await withTimeout(
    resolveVideo(server.iframeUrl, server.provider, { priority: false, fresh }),
    timeoutMs,
    { success: false } as ResolveVideoResult,
  );
  const videoUrl = result.success ? result.data?.videoUrl || null : null;
  if (!videoUrl) return null;
  const reachable = await probeMediaUrl(
    videoUrl,
    videoPlaybackHeaders(videoUrl, server.iframeUrl, server.provider),
  );
  return reachable ? videoUrl : null;
}

/** Discover every applicable source concurrently and return one complete,
 * bounded list. A source failure is isolated; successful siblings survive. */
export function fetchCompleteVideoServers(options: CompleteVideoServersOptions): Promise<VideoServersPayload> {
  const episodeUrl = normalizeServerUrl(options.episodeUrl) || options.episodeUrl;
  const key = JSON.stringify([
    episodeUrl,
    options.url4up || "",
    options.url3rb || "",
    options.animeHref || "",
    options.animeTitle || "",
    options.episodeNumber ?? "",
  ]);
  return completeVideoServerRequests.run(key, async () => {
    const discoveryDeadline = Date.now() + 45_000;
    const primaryIsUp4 = /anime4up/i.test(episodeUrl);
    const primaryIsA3rb = /anime3rb\.com\/episode\//i.test(episodeUrl);
    const primaryPromise = primaryIsA3rb
      ? Promise.resolve(null)
      : fetchVideoServers(episodeUrl, undefined, !!options.force).catch(() => null);

    const episodeNumber = options.episodeNumber ?? episodeNumberFromUrl(episodeUrl);
    const loadUp4 = async (title: string): Promise<VideoServersPayload | null> => {
      if (primaryIsUp4) return null;
      let href = options.url4up || null;
      if (!href && title && episodeNumber != null) {
        const guessed = anime4upEpisodeUrl(title, episodeNumber);
        const direct = guessed
          ? await scrapeAnime4upEpisodePageDirect(guessed).catch(() => null)
          : null;
        if (direct) {
          const servers = mergeVideoServers([direct.servers.map((server) => ({ ...server, source: "anime4up" }))]);
          return {
            success: servers.length > 0,
            data: {
              episodeTitle: direct.episodeTitle,
              animeTitle: direct.animeTitle || title,
              animeHref: "",
              serverCount: servers.length,
              servers,
              navigation: { prev: null, next: null },
              up4EpisodeUrl: guessed || undefined,
            },
          };
        }
      }
      if (!href && title && episodeNumber != null) {
        href = await resolveUp4EpisodeUrl(title, episodeNumber).catch(() => null);
      }
      if (!href || normalizeServerUrl(href) === normalizeServerUrl(episodeUrl)) return null;
      return fetchVideoServers(href, undefined, !!options.force).catch(() => null);
    };
    const loadA3rb = async (title: string): Promise<RawServer[]> => {
      if (/anime3rb\.com\/episode\//i.test(episodeUrl)) {
        return fetchAnime3rbServersByUrl(episodeUrl);
      }
      if (options.url3rb) return fetchAnime3rbServersByUrl(options.url3rb);
      if (title && episodeNumber != null) return fetchAnime3rbServers(title, episodeNumber);
      return [];
    };

    const initialTitle = (options.animeTitle || "").trim();
    let up4Promise = initialTitle || options.url4up ? loadUp4(initialTitle) : null;
    let a3rbPromise = initialTitle || options.url3rb || /anime3rb\.com\/episode\//i.test(episodeUrl)
      ? loadA3rb(initialTitle)
      : null;
    const primary = await withTimeout(primaryPromise, discoveryDeadline - Date.now(), null);
    const resolvedTitle = initialTitle || primary?.data.animeTitle || "";
    const exactUp4 = preferredAnime4upEpisodeUrl(options.url4up, primary?.data.up4EpisodeUrl);
    if (!options.url4up && exactUp4 && normalizeServerUrl(exactUp4) !== normalizeServerUrl(episodeUrl)) {
      up4Promise = fetchVideoServers(exactUp4, undefined, !!options.force).catch(() => null);
    }
    if (!up4Promise) up4Promise = loadUp4(resolvedTitle);
    if (!a3rbPromise) a3rbPromise = loadA3rb(resolvedTitle);

    const discovered = new Map<string, (VideoServer & { source?: string })[]>();
    let lastCandidateSignature = "";
    const emitCandidates = (metadata: VideoServersPayload | null) => {
      const servers = selectServerCandidates(mergeVideoServers([...discovered.values()]));
      if (servers.length === 0) return;
      const signature = serverCandidateSignature(servers);
      if (signature === lastCandidateSignature) return;
      lastCandidateSignature = signature;
      options.onCandidates?.({
        success: true,
        data: {
          episodeTitle: metadata?.data.episodeTitle || (episodeNumber != null ? `الحلقة ${episodeNumber}` : ""),
          animeTitle: resolvedTitle || metadata?.data.animeTitle || "",
          animeHref: options.animeHref || metadata?.data.animeHref || "",
          serverCount: servers.length,
          servers,
          navigation: metadata?.data.navigation || { prev: null, next: null },
        },
      });
    };
    if (primary?.data.servers.length) {
      discovered.set("primary", primary.data.servers);
      emitCandidates(primary);
    }
    const observedUp4 = up4Promise.then((result) => {
      if (result?.data.servers.length) {
        discovered.set("anime4up", result.data.servers);
        emitCandidates(primary || result);
      }
      return result;
    });
    const observedA3rb = a3rbPromise.then((servers) => {
      if (servers.length) {
        discovered.set("anime3rb", servers.map((server) => ({ ...server, source: "anime3rb" })));
        emitCandidates(primary);
      }
      return servers;
    });

    let lastPlayableSignature = "";
    const emit = (
      playable: (VideoServer & { source?: string; videoUrl: string })[],
      metadata: VideoServersPayload | null,
    ) => {
      if (playable.length === 0) return;
      const signature = serverCandidateSignature(playable);
      if (signature === lastPlayableSignature) return;
      lastPlayableSignature = signature;
      options.onPartial?.({
        success: true,
        data: {
          episodeTitle: metadata?.data.episodeTitle || (episodeNumber != null ? `الحلقة ${episodeNumber}` : ""),
          animeTitle: resolvedTitle || metadata?.data.animeTitle || "",
          animeHref: options.animeHref || metadata?.data.animeHref || "",
          serverCount: playable.length,
          servers: playable,
          navigation: metadata?.data.navigation || { prev: null, next: null },
        },
      });
    };

    // Warm the best three native candidates immediately, including their
    // hidden extractor fallback. Limiting this to three leaves one WebView
    // slot available for cross-source discovery instead of saturating the pool.
    if (primary && primary.data.servers.length > 0) {
      void resolveDirectServerList(
        selectWarmupServers(primary.data.servers),
        40_000,
        !!options.force,
        (playable) => emit(playable, primary),
      );
    }
    const remaining = Math.max(0, discoveryDeadline - Date.now());
    const [up4, a3rb] = await Promise.all([
      withTimeout(observedUp4, remaining, null),
      withTimeout(observedA3rb, remaining, [] as RawServer[]),
    ]);
    const a3rbServers: (VideoServer & { source?: string })[] = a3rb.map((server) => ({
      ...server,
      source: "anime3rb",
    }));
    const candidates = mergeVideoServers([
      primary?.data.servers || [],
      up4?.data.servers || [],
      a3rbServers,
    ]);
    const metadata = primary || up4;
    const servers = await resolveDirectServerList(
      candidates,
      40_000,
      !!options.force,
      (playable) => emit(playable, metadata),
    );
    return {
      success: servers.length > 0,
      data: {
        episodeTitle: metadata?.data.episodeTitle || (episodeNumber != null ? `الحلقة ${episodeNumber}` : ""),
        animeTitle: resolvedTitle || metadata?.data.animeTitle || "",
        animeHref: options.animeHref || metadata?.data.animeHref || "",
        serverCount: servers.length,
        servers,
        navigation: metadata?.data.navigation || { prev: null, next: null },
        up4EpisodeUrl: options.url4up || up4?.data.up4EpisodeUrl || undefined,
      },
    };
  }, {
    force: !!options.force,
    valid: (result) => result.data.servers.length > 0,
  });
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

type SearchPayload = {
  success: boolean;
  data: { query: string; totalResults: number; results: SearchResult[] };
};

// Cold-path search. ALL sources start at t=0 and stream into the same list as
// each lands (mergeIn de-dupes by title, rank() floats the closest match), so
// the grid paints with the FIRST source to answer — usually witanime's or
// anime4up's direct GET in well under a second. Previously anime4up/anime3rb
// were serialized BEHIND witanime, whose direct GET can burn ~30s in retries
// (and its WebView fallback another ~15s cold) before failing over — a flaky
// witanime held the entire first paint hostage.
async function searchAnimeFresh(
  query: string,
  onPartial?: (results: SearchResult[]) => void,
): Promise<SearchPayload> {
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  // Re-rank by how close each result's title is to the query so the BEST match
  // floats to the top — the source sites return matches in their own order
  // (often burying the exact anime under loosely-related rows). Scores are
  // computed once per pass and cached by href. A stable sort keeps same-score
  // rows in source/arrival order.
  const rank = () => {
    const sc = new Map<string, number>();
    for (const r of results) if (!sc.has(r.href)) sc.set(r.href, fuzzyScore(query, r.title));
    results.sort((a, b) => (sc.get(b.href) ?? 0) - (sc.get(a.href) ?? 0));
  };
  const emit = () => { rank(); onPartial?.(results.slice()); };
  const mergeIn = (arr: { title: string; href: string; image: string | null; type: string | null; status: string | null; synopsis?: string | null }[]) => {
    let added = false;
    for (const it of arr) {
      const k = norm(it.title);
      if (k && seen.has(k)) continue;
      if (k) seen.add(k);
      results.push(toSearchResult(it));
      added = true;
    }
    return added;
  };

  // Kick off the typo-tolerant catalog scan now (local compute over the cached
  // anime3rb sitemap). Awaited later only if the sources don't surface a strong
  // match, so the common (correctly-spelled) query pays no extra cost.
  const fuzzyCatalogP = searchAnime3rbCatalogFuzzy(query, 5).catch(() => [] as { slug: string; score: number }[]);

  // Primary: witanime's static-HTML search via a plain GET — near-instant, no
  // WebView render. Fall back to the WebView scrape only if the direct fetch
  // fails (network / CF hiccup). Runs CONCURRENTLY with the other sources (not
  // ahead of them) so its worst case can't delay anyone else's first paint.
  const witP = (async () => {
    let wit = await searchWitanimeDirectList(query).catch(() => null);
    if (!wit) wit = await scrapeSearch(query).catch(() => null);
    if (wit?.results?.length && mergeIn(wit.results)) emit();
  })();

  // Secondary: anime4up + anime3rb (third source) run in parallel and append to
  // the visible list. anime4up is tried via a direct static-HTML GET FIRST
  // (near-instant, no WebView) — its search cards ship in the page HTML, so the
  // old WebView-only path was the main reason results from "other sources" took
  // several extra seconds to appear. The WebView scrape stays as the fallback
  // for the rare empty direct fetch (network / CF hiccup).
  const up4P = (async () => {
    let up4 = await searchAnime4upDirectList(query).catch(() => null);
    if (!up4 || up4.length === 0) {
      const wv = await scrapeSearchUp4(query).catch(() => null);
      up4 = wv?.results ?? null;
    }
    if (up4?.length && mergeIn(up4)) emit();
  })();

  // anime3rb: surface anime that live ONLY on anime3rb — its catalog matcher is
  // conservative (near-total token coverage + exact season), so a confident
  // match is fetched for its poster/title and appended if not already present.
  const a3rbP = (async () => {
    try {
      const a3rbUrl =
        (await searchAnime3rbCatalog(query).catch(() => null)) ||
        (await searchAnime3rbDirect(query).catch(() => null));
      if (!a3rbUrl) return;
      const detail = await scrapeAnime3rbTitlePage(a3rbUrl).catch(() => null);
      if (detail?.title && mergeIn([{
        title: detail.title, href: a3rbUrl, image: detail.poster || null,
        type: null, status: null, synopsis: detail.synopsis || null,
      }])) emit();
    } catch {}
  })();

  // Wait for all sources — but cap the wait so the spinner clears promptly
  // even if a WebView fallback is slow behind a cold queue. Late arrivals still
  // emit via onPartial (the screen's seq guard keeps stale ones out); they just
  // won't be in the cached payload, which the next search refreshes anyway.
  await Promise.race([
    Promise.all([witP, up4P, a3rbP]),
    new Promise<void>((r) => setTimeout(r, results.length ? 6000 : 15000)),
  ]);

  // Typo-tolerant recovery: when the sources didn't surface a clearly strong
  // match (the user likely misspelled the title, dropped a colon, or spaced it
  // oddly — "narto", "re zero", "full metal"), pull the closest titles from the
  // anime3rb catalog and add the ones not already present. anime3rb anime are
  // first-class detail pages, so each is a fully-playable result. Gated on the
  // miss case + capped at 3 detail fetches so a well-spelled query stays cheap.
  const hasStrong = results.some((r) => fuzzyScore(query, r.title) >= 0.9);
  if (!hasStrong) {
    const top = await fuzzyCatalogP;
    let fetched = 0;
    for (const { slug } of top) {
      if (fetched >= 3) break;
      const label = slug.replace(/[-_]+/g, " ");
      // Skip a catalog hit an existing result already represents.
      if (results.some((r) => fuzzyScore(label, r.title) >= 0.85)) continue;
      const url = `https://anime3rb.com/titles/${slug}`;
      const detail = await scrapeAnime3rbTitlePage(url).catch(() => null);
      fetched++;
      if (detail?.title && mergeIn([{
        title: detail.title, href: url, image: detail.poster || null,
        type: null, status: null, synopsis: detail.synopsis || null,
      }])) emit();
    }
  }

  // Cross-language bridge: the source sites index each anime under a SINGLE
  // language, so an English query never finds a romaji-only title (and vice
  // versa). When everything above came up empty, ask Jikan for the title's
  // other names and re-search with the Latin-script ones (sites don't index
  // kanji).
  if (results.length === 0) {
    const alts = await getAltTitles(query).catch(() => []);
    const tried = new Set<string>([norm(query)]);
    const candidates = alts
      .filter((a) => /[a-z]/i.test(a))
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
      if (wAlt?.results?.length && mergeIn(wAlt.results)) emit();
      const upAlt = await scrapeSearchUp4(alt).catch(() => null);
      if (upAlt?.results?.length && mergeIn(upAlt.results)) emit();
      if (results.length) break;
    }
  }

  rank();
  return { success: true, data: { query, totalResults: results.length, results } };
}

export async function searchAnime(
  query: string,
  onPartial?: (results: SearchResult[]) => void,
): Promise<SearchPayload> {
  // Stale-while-revalidate by hand (so the cold path can stream partials).
  // A cached hit returns instantly and revalidates in the background; a cold
  // query streams witanime → anime4up → anime3rb into `onPartial`.
  const key = SEARCH_CACHE_PREFIX + query.toLowerCase().trim();
  const cached = await readCache<SearchPayload>(key, SEARCH_CACHE_TTL);
  if (cached && cached.data.results.length > 0) {
    if (!_swrInFlight.has(key)) {
      _swrInFlight.add(key);
      void searchAnimeFresh(query)
        .then((d) => { if (d.data.results.length > 0) return writeCache(key, d); })
        .catch(() => {})
        .finally(() => _swrInFlight.delete(key));
    }
    return cached;
  }
  const data = await searchAnimeFresh(query, onPartial);
  if (data.data.results.length > 0) void writeCache(key, data);
  return data;
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

/* ── downloads ──────────────────────────────────
 * Resolve a DIRECT, progressive .mp4 URL for an episode so it can be saved to
 * disk for offline viewing. HLS (.m3u8) sources are skipped — they're a playlist
 * of segments, not a single downloadable file — so only providers proven to hand
 * out a progressive file are considered. Returns the URL plus the exact CDN
 * headers the player uses (signed URLs are often bound to Referer/UA). */

export type DownloadServer = {
  name: string;
  iframeUrl: string;
  provider: string;
  quality: string;
  videoUrl?: string;
};

export async function listDownloadServers(opts: {
  episodeHref: string;
  url4up?: string;
  url3rb?: string;
  epNum?: number | null;
  animeTitle?: string | null;
  force?: boolean;
  onUpdate?: (servers: DownloadServer[]) => void;
}): Promise<DownloadServer[]> {
  const complete = await fetchCompleteVideoServers({
    episodeUrl: opts.episodeHref,
    url4up: opts.url4up,
    url3rb: opts.url3rb,
    animeTitle: opts.animeTitle,
    episodeNumber: opts.epNum,
    force: opts.force,
    onPartial: (payload) => {
      const servers = selectDownloadCandidates([payload.data.servers]);
      if (servers.length) opts.onUpdate?.(servers);
    },
  }).catch(() => null);
  // fetchCompleteVideoServers has already resolved and range-probed every
  // native candidate. This exposes every progressive mirror that works for
  // this episode instead of hard-coding the picker to Anime3rb + MP4Upload.
  return selectDownloadCandidates([complete?.data.servers || []]);
}

export async function resolveDownloadUrl(opts: {
  episodeHref: string;
  url4up?: string;
  url3rb?: string;
  epNum?: number | null;
  animeTitle?: string | null;
  server?: { iframeUrl: string; provider: string; videoUrl?: string } | null;
}): Promise<{ url: string; headers: Record<string, string>; type: "mp4"; provider: string } | null> {
  const { episodeHref, url4up, url3rb, epNum, animeTitle } = opts;

  const resolveCandidate = async (server: {
    iframeUrl: string;
    provider: string;
    videoUrl?: string;
  }) => {
    const usable = async (url: string) => {
      if (!url || videoContentType(url, server.provider) !== "progressive" ||
          !validateMediaUrl(url, server.provider)) return null;
      const headers = videoPlaybackHeaders(url, server.iframeUrl, server.provider);
      const reachable = await probeMediaUrl(url, headers);
      return reachable ? { url, headers, type: "mp4" as const, provider: server.provider } : null;
    };

    // The picker carries the URL it just validated. If its short-lived token
    // expired while the dialog was open, refresh the embed and probe once more.
    const cached = await usable(server.videoUrl || "");
    if (cached) return cached;
    const result = await resolveVideo(server.iframeUrl, server.provider, {
      priority: true,
      fresh: true,
    }).catch(() => null);
    return usable(result?.success ? result.data?.videoUrl || "" : "");
  };

  if (opts.server?.iframeUrl) {
    const selected = await resolveCandidate(opts.server);
    if (selected) return selected;
  }

  const complete = await fetchCompleteVideoServers({
    episodeUrl: episodeHref,
    url4up,
    url3rb,
    animeTitle,
    episodeNumber: epNum,
    force: true,
  }).catch(() => null);
  const downloadable = selectDownloadCandidates([complete?.data.servers || []]);

  for (const c of downloadable) {
    if (!isResolvedDownloadServer(c)) continue;
    const resolved = await resolveCandidate(c);
    if (resolved) return resolved;
  }
  return null;
}

/* ── /resolve-video ─────────────────────────── */

export type ResolveVideoResult = {
  success: boolean;
  data?: { videoUrl: string; type: string };
  error?: string;
};

export type ResolveVideoOptions = boolean | { priority?: boolean; fresh?: boolean };

async function resolveVideoFresh(iframeUrl: string, provider: string, priority: boolean): Promise<ResolveVideoResult> {
  const success = (result: { url: string; type: string } | null): ResolveVideoResult | null =>
    result && validateMediaUrl(result.url, provider)
      ? { success: true, data: { videoUrl: result.url, type: result.type } }
      : null;
  const policy = providerPolicy(provider);

  // anime3rb's first-party host: one static GET on the player page yields
  // direct tokenized .mp4 qualities — near-instant, no WebView slot needed.
  if (provider === "vid3rb") {
    const r = await extractVid3rb(iframeUrl).catch(() => null);
    const resolved = success(r);
    if (resolved) return resolved;
    return { success: false, error: "Could not extract vid3rb video URL" };
  }
  // mp4upload now inlines the direct .mp4 URL in the embed page's static
  // HTML (no more packed JS), so a plain GET resolves it instantly and
  // reliably — the WebView scrape below stays as the fallback for the rare
  // mirror that still serves the packed player.
  if (provider === "mp4upload") {
    const r = await extractMp4upload(iframeUrl).catch(() => null);
    const resolved = success(r);
    if (resolved) return resolved;
    void remoteLog("warn", "video", "mp4upload direct extraction missed; using WebView", {
      iframeUrl: iframeUrl.slice(0, 200),
    });
  }
  // streamwish / doodstream carry the real stream in the embed page's STATIC
  // HTML (packed JS / pass_md5 endpoint), so one or two plain GETs resolve
  // them in ~1s — where the WebView path below burns up to 40s on a slow link
  // and routinely times out (the "servers keep loading" complaint). WebView
  // scrape stays as the fallback on parse miss. (voe is NOT here on purpose:
  // its mirrors now gate the player behind a session-sync interstitial that a
  // plain GET can't pass — see the note in direct.ts.)
  if (provider === "streamwish") {
    const r = await extractStreamwish(iframeUrl).catch(() => null);
    const resolved = success(r);
    if (resolved) return resolved;
  }
  if (provider === "videas") {
    const r = await extractVideas(iframeUrl).catch(() => null);
    const resolved = success(r);
    if (resolved) return resolved;
  }
  if (provider === "doodstream") {
    const r = await extractDoodstream(iframeUrl).catch(() => null);
    const resolved = success(r);
    if (resolved) return resolved;
  }
  if (policy.resolution === "direct") return { success: false, error: `Could not extract ${provider} video URL` };
  try {
    const r = await scrapeExtractVideoUrl(iframeUrl, priority);
    if (!validateMediaUrl(r.url, provider)) return { success: false, error: `${provider} returned an invalid media URL` };
    return {
      success: true,
      data: { videoUrl: r.url, type: /\.m3u8/i.test(r.url) ? "hls" : "mp4" },
    };
  } catch (e: any) {
    void remoteLog("error", "video", "resolveVideo failed", {
      provider, iframeUrl: iframeUrl.slice(0, 200), error: e?.message ?? "unknown",
    });
    return { success: false, error: e?.message ?? "Could not extract video URL" };
  }
}

export function resolveVideo(
  iframeUrl: string,
  provider: string,
  options: ResolveVideoOptions = false,
): Promise<ResolveVideoResult> {
  const normalized = normalizeServerUrl(iframeUrl);
  if (!normalized) return Promise.resolve({ success: false, error: "Invalid embed URL" });
  const opts = typeof options === "boolean" ? { priority: options, fresh: false } : options;
  const key = `${provider}|${normalized}`;
  return videoResolutionRequests.run(
    key,
    () => resolveVideoFresh(normalized, provider, !!opts.priority),
    { force: !!opts.fresh, valid: (result) => result.success && !!result.data?.videoUrl },
  );
}

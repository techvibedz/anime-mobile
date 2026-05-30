// All data is scraped in-app via a hidden WebView (lib/scraper).
// No HTTP backend is required.

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  scrapeWitanimeHome,
  scrapeAnime4upHome,
  scrapeEpisodesPage,
  scrapeSearch,
  scrapeRecent,
  scrapeGenre,
  scrapeAllAnime,
  scrapeVideoServers,
  findCrossSourceUrl,
  extractVideoUrl as scrapeExtractVideoUrl,
} from "./scraper";

const HOME_CACHE_KEY = "@home_cache_v1";
const HOME_CACHE_TTL = 30 * 60 * 1000; // 30 min
const DETAIL_CACHE_PREFIX = "@detail_v1:";
const DETAIL_CACHE_TTL = 30 * 60 * 1000; // 30 min
const UP4_CACHE_PREFIX = "@up4_eps_v2:";
const UP4_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 h

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
  // Save for next launch.
  void writeCache(HOME_CACHE_KEY, result);
  return result;
}

export async function fetchHome(): Promise<HomePayload> {
  // Stale-while-revalidate: return cached payload immediately if present,
  // then kick off a background refresh so the next launch is fresher.
  const cached = await readCache<HomePayload>(HOME_CACHE_KEY, HOME_CACHE_TTL);
  if (cached) {
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
const xsourceCache: Map<string, { url: string | null; ts: number }> = new Map();
const XSOURCE_TTL = 24 * 60 * 60 * 1000;

// Progressively shorter title variants. The full title is most precise but
// anime4up's search is fussy — dropping trailing season/format words and
// parentheticals often turns a 0-result search into a hit.
function searchVariants(title: string): string[] {
  const cleaned = title.replace(/[([][^)\]]*[)\]]/g, "").replace(/\s+/g, " ").trim();
  const words = cleaned.split(/\s+/);
  const variants = new Set<string>();
  if (cleaned) variants.add(cleaned);
  if (words.length > 3) variants.add(words.slice(0, 3).join(" "));
  if (words.length > 2) variants.add(words.slice(0, 2).join(" "));
  if (words.length > 1) variants.add(words[0]);
  return Array.from(variants);
}

async function getCrossSourceUrl(
  title: string,
  primary: "witanime" | "anime4up",
): Promise<string | null> {
  const key = `${primary}:${title.toLowerCase().trim()}`;
  const hit = xsourceCache.get(key);
  if (hit && Date.now() - hit.ts < XSOURCE_TTL) return hit.url;

  let url: string | null = null;
  // Try each title variant; for each, retry a couple of times since
  // anime4up is intermittently unreachable and a single timeout shouldn't
  // kill the lookup. Stop at the first hit.
  for (const v of searchVariants(title)) {
    for (let attempt = 0; attempt < 3 && !url; attempt++) {
      url = await findCrossSourceUrl(v, primary).catch(() => null);
      if (!url && attempt < 2) await new Promise((r) => setTimeout(r, 4000));
    }
    if (url) break;
  }
  // Only cache positive hits — a null is likely a transient search/CF miss,
  // so let the next call retry instead of remembering the failure.
  if (url) xsourceCache.set(key, { url, ts: Date.now() });
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

/* ── /recent ────────────────────────────────── */

export async function fetchRecent(page = 1): Promise<{
  success: boolean;
  data: { page: number; episodes: EpisodeItem[]; hasNext: boolean };
}> {
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
}

/* ── /extract-video ─────────────────────────── */

export async function fetchVideoServers(episodeUrl: string, url4up?: string): Promise<{
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
}> {
  const primaryIsUp4 = /anime4up/i.test(episodeUrl);
  // If we have a url4up AND the primary isn't already anime4up, scrape both
  // sources' servers in parallel (uses 2 WebView slots simultaneously).
  const tasks: Promise<{ source: string; servers: any[]; episodeTitle: string; animeTitle: string; up4EpisodeUrl?: string | null } | null>[] = [];

  tasks.push(
    scrapeVideoServers(episodeUrl)
      .then((r) => ({
        source: primaryIsUp4 ? "anime4up" : "witanime",
        servers: r.servers,
        episodeTitle: r.episodeTitle,
        animeTitle: r.animeTitle,
        up4EpisodeUrl: r.up4EpisodeUrl ?? null,
      }))
      .catch(() => null),
  );
  if (url4up && !primaryIsUp4) {
    tasks.push(
      scrapeVideoServers(url4up)
        .then((r) => ({ source: "anime4up", servers: r.servers, episodeTitle: r.episodeTitle, animeTitle: r.animeTitle }))
        .catch(() => null),
    );
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

export async function searchAnime(query: string): Promise<{
  success: boolean;
  data: { query: string; totalResults: number; results: SearchResult[] };
}> {
  const r = await scrapeSearch(query);
  const results: SearchResult[] = r.results.map((it) => ({
    title: it.title,
    href: it.href,
    image: imgOrEmpty(it.image),
    type: it.type ?? undefined,
    status: it.status ?? undefined,
    synopsis: it.synopsis ?? undefined,
  }));
  return { success: true, data: { query, totalResults: results.length, results } };
}

/* ── /genre ─────────────────────────────────── */

export async function fetchGenre(name: string, page = 1): Promise<{
  success: boolean;
  data: { genre: string; page: number; items: SearchResult[]; hasNext: boolean };
}> {
  const r = await scrapeGenre(name, page);
  const items: SearchResult[] = r.items.map((it) => ({
    title: it.title,
    href: it.href,
    image: imgOrEmpty(it.image),
    type: it.type ?? undefined,
    status: it.status ?? undefined,
  }));
  return { success: true, data: { genre: name, page, items, hasNext: items.length > 0 } };
}

/* ── /all-anime ─────────────────────────────── */

export async function fetchAllAnime(page = 1): Promise<{
  success: boolean;
  data: { page: number; items: SearchResult[]; hasNext: boolean };
}> {
  const r = await scrapeAllAnime(page);
  const items: SearchResult[] = r.items.map((it) => ({
    title: it.title,
    href: it.href,
    image: imgOrEmpty(it.image),
    type: it.type ?? undefined,
    status: it.status ?? undefined,
  }));
  return { success: true, data: { page, items, hasNext: items.length > 0 } };
}

/* ── /resolve-video ─────────────────────────── */

export async function resolveVideo(iframeUrl: string, _provider: string, priority = false): Promise<{
  success: boolean;
  data?: { videoUrl: string; type: string };
  error?: string;
}> {
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

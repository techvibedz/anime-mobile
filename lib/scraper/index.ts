import { enqueue } from "./bus";
import {
  fetchWitListingDirect,
  searchWitanimeDirect,
  type WitCard,
} from "./direct";
import {
  EXTRACT_HOME_WIT,
  EXTRACT_HOME_4UP,
  EXTRACT_EPISODES_WIT,
  EXTRACT_EPISODES_4UP,
  EXTRACT_SEARCH,
  EXTRACT_RECENT,
  EXTRACT_LISTING,
  EXTRACT_VIDEO_SERVERS,
  EXTRACT_TITLE_MATCH,
  HOOK_VIDEO_BEFORE,
  COLLECT_VIDEO_AFTER,
} from "./scripts";

export { ScraperHost } from "./ScraperHost";

const WIT_BASE = "https://witanime.you";
const UP4_BASE = "https://w1.anime4up.rest";
const ALL_ANIME_PATH = encodeURIComponent("قائمة-الانمي");

/* ── HOME ──────────────────────────────────────── */

export type RawAnime = {
  title: string; href: string; image: string | null;
  type: string | null; status: string | null; description: string | null;
  isNew: boolean; rating: string | null;
};
export type RawFeatured = {
  title: string; href: string; image: string | null;
  description: string | null; genres: string[];
};
export type RawEpisodeCard = {
  title: string; href: string; image: string | null;
  animeTitle: string; animeHref: string; isNew: boolean;
};

export async function scrapeWitanimeHome() {
  return enqueue({
    url: `${WIT_BASE}/`,
    injectAfter: EXTRACT_HOME_WIT,
    timeoutMs: 35000,
  }) as Promise<{ featured: RawFeatured[]; animes: RawAnime[]; episodes: RawEpisodeCard[] }>;
}

export async function scrapeAnime4upHome() {
  return enqueue({
    url: `${UP4_BASE}/home8/`,
    injectAfter: EXTRACT_HOME_4UP,
    timeoutMs: 35000,
  }) as Promise<{ animes: Pick<RawAnime, "title" | "href" | "image" | "type">[] }>;
}

/* ── EPISODES (detail page) ────────────────────── */

export type RawDetail = {
  title: string; poster: string; synopsis: string;
  genres: string[];
  episodes: { title: string; number: number; type: string; screenshot: string; href: string | null }[];
};

export async function scrapeEpisodesPage(animeUrl: string) {
  const is4up = /anime4up/i.test(animeUrl);
  return enqueue({
    url: animeUrl,
    injectAfter: is4up ? EXTRACT_EPISODES_4UP : EXTRACT_EPISODES_WIT,
    timeoutMs: 35000,
  }) as Promise<RawDetail>;
}

/* ── SEARCH ────────────────────────────────────── */

export type RawSearchResult = { title: string; href: string; image: string | null; type: string | null; status: string | null; synopsis: string | null };

export async function scrapeSearch(query: string) {
  const url = `${WIT_BASE}/?s=${encodeURIComponent(query)}&search_param=animes`;
  return enqueue({
    url,
    injectAfter: EXTRACT_SEARCH,
    timeoutMs: 25000,
  }) as Promise<{ results: RawSearchResult[] }>;
}

// Same card grid, anime4up side. Run in parallel with scrapeSearch so the
// search page can merge results from both sources.
export async function scrapeSearchUp4(query: string) {
  const url = `${UP4_BASE}/?search_param=animes&s=${encodeURIComponent(query)}`;
  return enqueue({
    url,
    injectAfter: EXTRACT_SEARCH,
    timeoutMs: 25000,
  }) as Promise<{ results: RawSearchResult[] }>;
}

/* ── RECENT (episode archive paginated) ────────── */

export async function scrapeRecent(page = 1) {
  const url = `${WIT_BASE}/episode/page/${page}/`;
  return enqueue({
    url,
    injectAfter: EXTRACT_RECENT,
    timeoutMs: 30000,
  }) as Promise<{ episodes: RawEpisodeCard[] }>;
}

/* ── GENRE / ALL-ANIME (paginated card grid) ───── */

// witanime indexes genres under Arabic slugs only — an English name like
// "Action" 404s. Map the app's English genre keys to the exact slugs the
// site uses (verified against witanime.you/anime-genre/<slug>/). Anything not
// in the map is passed through encoded, so an already-Arabic value still works.
const GENRE_SLUG_MAP: Record<string, string> = {
  Action: "أكشن",
  Adventure: "مغامرات",
  Comedy: "كوميدي",
  Drama: "دراما",
  Fantasy: "خيال",
  Horror: "رعب",
  Mystery: "غموض",
  Romance: "رومانسي",
  "Sci-Fi": "خيال-علمي",
  "Slice of Life": "شريحة-من-الحياة",
  Sports: "رياضي",
  Supernatural: "خارق-للطبيعة",
  Thriller: "إثارة",
  Mecha: "ميكا",
  Shounen: "شونين",
  Seinen: "سينين",
};

export async function scrapeGenre(genre: string, page = 1) {
  const slug = encodeURIComponent(GENRE_SLUG_MAP[genre] || genre);
  const url = page === 1
    ? `${WIT_BASE}/anime-genre/${slug}/`
    : `${WIT_BASE}/anime-genre/${slug}/page/${page}/`;
  return enqueue({
    url,
    injectAfter: EXTRACT_LISTING,
    timeoutMs: 30000,
  }) as Promise<{ items: { title: string; href: string; image: string | null; type: string | null; status: string | null; synopsis: null }[] }>;
}

export async function scrapeAllAnime(page = 1) {
  const url = page === 1
    ? `${WIT_BASE}/${ALL_ANIME_PATH}/`
    : `${WIT_BASE}/${ALL_ANIME_PATH}/page/${page}/`;
  return enqueue({
    url,
    injectAfter: EXTRACT_LISTING,
    timeoutMs: 30000,
  }) as Promise<{ items: { title: string; href: string; image: string | null; type: string | null; status: string | null; synopsis: null }[] }>;
}

/* ── DIRECT (no-WebView) listing/search fast paths ──────────────
 * witanime serves these pages as static HTML, so a plain GET + regex parse is
 * far faster and more reliable than rendering them in the hidden WebView.
 * Each returns null on failure so callers can fall back to the WebView scrape. */

const LISTING_PAGE_SIZE = 30;

// Genre pages aren't server-paginated — one page lists EVERY title in the genre.
// Fetch it once, cache the full parsed list briefly, and paginate client-side so
// "load more" and quick revisits don't re-download the multi-MB page.
const _genreFullCache = new Map<string, { items: WitCard[]; ts: number }>();
const GENRE_FULL_TTL = 30 * 60 * 1000;

export async function scrapeGenreDirect(genre: string, page = 1) {
  const slug = encodeURIComponent(GENRE_SLUG_MAP[genre] || genre);
  const url = `${WIT_BASE}/anime-genre/${slug}/`;
  let full = _genreFullCache.get(genre);
  if (!full || Date.now() - full.ts > GENRE_FULL_TTL) {
    const items = await fetchWitListingDirect(url);
    if (!items || items.length === 0) return null;
    full = { items, ts: Date.now() };
    _genreFullCache.set(genre, full);
  }
  const start = (page - 1) * LISTING_PAGE_SIZE;
  const slice = full.items.slice(start, start + LISTING_PAGE_SIZE);
  return { items: slice, hasNext: start + LISTING_PAGE_SIZE < full.items.length };
}

export async function scrapeAllAnimeDirect(page = 1) {
  const url = page === 1
    ? `${WIT_BASE}/${ALL_ANIME_PATH}/`
    : `${WIT_BASE}/${ALL_ANIME_PATH}/page/${page}/`;
  const items = await fetchWitListingDirect(url);
  if (!items) return null;
  return { items, hasNext: items.length > 0 };
}

export async function searchWitanimeDirectList(query: string) {
  const results = await searchWitanimeDirect(query);
  if (!results) return null;
  return { results };
}

/* ── CROSS-SOURCE TITLE MATCH ─────────────────── */

// Searches a different source by title and returns the best-matching anime
// URL. Used to discover an anime's anime4up URL from its witanime title (or
// vice versa) so video-server extraction can pull from BOTH sources.
export async function findCrossSourceUrl(
  title: string,
  primarySource: "witanime" | "anime4up",
): Promise<string | null> {
  if (!title) return null;
  const wantTarget = primarySource === "witanime" ? "anime4up" : "witanime";
  const base = wantTarget === "anime4up" ? UP4_BASE : WIT_BASE;
  // anime4up search is at root path, not /home8/
  const searchUrl = `${base}/?search_param=animes&s=${encodeURIComponent(title)}`;
  try {
    const r = await enqueue({
      url: searchUrl,
      injectAfter: EXTRACT_TITLE_MATCH(title),
      timeoutMs: 25000,
    }) as { url: string | null; score: number };
    return r.url;
  } catch {
    return null;
  }
}

/* ── VIDEO SERVERS (find iframes on episode page) ── */

export type RawServer = { id: string; name: string; iframeUrl: string; provider: string };

export async function scrapeVideoServers(episodeUrl: string) {
  return enqueue({
    url: episodeUrl,
    injectAfter: EXTRACT_VIDEO_SERVERS,
    timeoutMs: 60000,
  }) as Promise<{ servers: RawServer[]; episodeTitle: string; animeTitle: string; up4EpisodeUrl?: string | null; up4AnimeUrl?: string | null }>;
}

/* ── VIDEO URL (m3u8/mp4 from embed) ──────────── */

export async function extractVideoUrl(embedUrl: string, priority = false) {
  return enqueue({
    url: embedUrl,
    injectBefore: HOOK_VIDEO_BEFORE,
    injectAfter: COLLECT_VIDEO_AFTER,
    timeoutMs: 30000,
    priority,
    allFrames: true,
  }) as Promise<{ url: string }>;
}

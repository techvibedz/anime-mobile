import { enqueue } from "./bus";
import {
  fetchWitListingDirect,
  searchWitanimeDirect,
  getWitBase,
  rewriteWitUrl,
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
  EXTRACT_WIT_GENRE,
  EXTRACT_VIDEO_SERVERS,
  EXTRACT_TITLE_MATCH,
  HOOK_VIDEO_BEFORE,
  COLLECT_VIDEO_AFTER,
} from "./scripts";

export { ScraperHost } from "./ScraperHost";

const UP4_BASE = "https://w1.anime4up.rest";

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
  const base = await getWitBase();
  return enqueue({
    url: `${base}/`,
    injectAfter: EXTRACT_HOME_WIT,
    timeoutMs: 35000,
  }) as Promise<{ featured: RawFeatured[]; animes: RawAnime[]; episodes: RawEpisodeCard[] }>;
}

export async function scrapeAnime4upHome() {
  return enqueue({
    url: `${UP4_BASE}/home8/`,
    injectAfter: EXTRACT_HOME_4UP,
    timeoutMs: 35000,
  }) as Promise<{
    featured: RawFeatured[];
    animes: Pick<RawAnime, "title" | "href" | "image" | "type">[];
    episodes: RawEpisodeCard[];
  }>;
}

/* ── EPISODES (detail page) ────────────────────── */

export type RawDetail = {
  title: string; poster: string; synopsis: string;
  genres: string[];
  episodes: { title: string; number: number; type: string; screenshot: string; href: string | null }[];
};

export async function scrapeEpisodesPage(animeUrl: string) {
  const is4up = /anime4up/i.test(animeUrl);
  const url = /witanime\./i.test(animeUrl)
    ? rewriteWitUrl(animeUrl, await getWitBase())
    : animeUrl;
  return enqueue({
    url,
    injectAfter: is4up ? EXTRACT_EPISODES_4UP : EXTRACT_EPISODES_WIT,
    timeoutMs: 35000,
  }) as Promise<RawDetail>;
}

/* ── SEARCH ────────────────────────────────────── */

export type RawSearchResult = { title: string; href: string; image: string | null; type: string | null; status: string | null; synopsis: string | null };

export async function scrapeSearch(query: string) {
  const base = await getWitBase();
  const url = `${base}/search?q=${encodeURIComponent(query)}`;
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
  // ponytail: the redesigned site publishes one latest batch; stop pagination
  // cleanly until it exposes a public recent-episodes page again.
  if (page > 1) return { episodes: [] as RawEpisodeCard[] };
  const base = await getWitBase();
  const url = `${base}/`;
  return enqueue({
    url,
    injectAfter: EXTRACT_RECENT,
    timeoutMs: 30000,
  }) as Promise<{ episodes: RawEpisodeCard[] }>;
}

/* ── GENRE / ALL-ANIME (paginated card grid) ───── */

// The current Livewire browse filter uses stable English genre values.
const GENRE_SLUG_MAP: Record<string, string> = {
  Action: "action",
  Adventure: "adventure",
  Comedy: "comedy",
  Drama: "drama",
  Fantasy: "fantasy",
  Horror: "horror",
  Mystery: "mystery",
  Romance: "romance",
  "Sci-Fi": "sci-fi",
  "Slice of Life": "slice-of-life",
  Sports: "sports",
  Supernatural: "supernatural",
  Thriller: "thriller",
  Mecha: "mecha",
  Shounen: "shounen",
  Seinen: "seinen",
};

export async function scrapeGenre(genre: string, page = 1) {
  const base = await getWitBase();
  const slug = GENRE_SLUG_MAP[genre] || genre.toLowerCase();
  const url = `${base}/browse?page=${page}`;
  return enqueue({
    url,
    injectAfter: EXTRACT_WIT_GENRE(slug, page),
    timeoutMs: 30000,
  }) as Promise<{ items: { title: string; href: string; image: string | null; type: string | null; status: string | null; synopsis: null }[] }>;
}

export async function scrapeAllAnime(page = 1) {
  const base = await getWitBase();
  const url = `${base}/browse?page=${page}`;
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

export async function scrapeGenreDirect(
  _genre: string,
  _page = 1,
): Promise<{ items: WitCard[]; hasNext: boolean } | null> {
  // The current site applies genre filters through Livewire; use the WebView
  // path above rather than returning an unfiltered /browse page.
  return null;
}

export async function scrapeAllAnimeDirect(page = 1) {
  const base = await getWitBase();
  const url = `${base}/browse?page=${page}`;
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
  const base = wantTarget === "anime4up" ? UP4_BASE : await getWitBase();
  const searchUrl = wantTarget === "anime4up"
    ? `${base}/?search_param=animes&s=${encodeURIComponent(title)}`
    : `${base}/search?q=${encodeURIComponent(title)}`;
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
  const url = /witanime\./i.test(episodeUrl)
    ? rewriteWitUrl(episodeUrl, await getWitBase())
    : episodeUrl;
  return enqueue({
    url,
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
    // 40s: the collector's internal 28s loop starts at early injection (first
    // bytes), so on a slow connection the page load no longer eats the whole
    // budget — but the job still needs to outlast the loop plus load slack.
    timeoutMs: 40000,
    priority,
    allFrames: true,
  }) as Promise<{ url: string }>;
}

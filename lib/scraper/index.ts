import { enqueue } from "./bus";
import {
  EXTRACT_HOME_WIT,
  EXTRACT_HOME_4UP,
  EXTRACT_EPISODES_WIT,
  EXTRACT_EPISODES_4UP,
  EXTRACT_SEARCH,
  EXTRACT_RECENT,
  EXTRACT_LISTING,
  EXTRACT_VIDEO_SERVERS,
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

export async function scrapeSearch(query: string) {
  const url = `${WIT_BASE}/?s=${encodeURIComponent(query)}&search_param=animes`;
  return enqueue({
    url,
    injectAfter: EXTRACT_SEARCH,
    timeoutMs: 25000,
  }) as Promise<{ results: { title: string; href: string; image: string | null; type: string | null; status: string | null; synopsis: string | null }[] }>;
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

export async function scrapeGenre(arabicSlug: string, page = 1) {
  const url = page === 1
    ? `${WIT_BASE}/anime-genre/${arabicSlug}/`
    : `${WIT_BASE}/anime-genre/${arabicSlug}/page/${page}/`;
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

/* ── VIDEO SERVERS (find iframes on episode page) ── */

export type RawServer = { id: string; name: string; iframeUrl: string; provider: string };

export async function scrapeVideoServers(episodeUrl: string) {
  return enqueue({
    url: episodeUrl,
    injectAfter: EXTRACT_VIDEO_SERVERS,
    timeoutMs: 60000,
  }) as Promise<{ servers: RawServer[]; episodeTitle: string; animeTitle: string }>;
}

/* ── VIDEO URL (m3u8/mp4 from embed) ──────────── */

export async function extractVideoUrl(embedUrl: string) {
  return enqueue({
    url: embedUrl,
    injectBefore: HOOK_VIDEO_BEFORE,
    injectAfter: COLLECT_VIDEO_AFTER,
    timeoutMs: 40000,
  }) as Promise<{ url: string }>;
}

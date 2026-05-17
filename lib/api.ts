import { Platform } from "react-native";
import * as Device from "expo-device";

const ENV_BASE = process.env.EXPO_PUBLIC_API_BASE?.replace(/\/$/, "");

const BASE = ENV_BASE
  ?? (Device.isDevice
    ? "http://192.168.1.6:3001"
    : Platform.select({ android: "http://10.0.2.2:3001", default: "http://localhost:3001" })!);

export function getProxyUrl(videoUrl: string) {
  return `${BASE}/api/proxy-video?url=${encodeURIComponent(videoUrl)}`;
}

async function get<T>(path: string, timeoutMs = 20000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, {
      signal: controller.signal,
      headers: { "ngrok-skip-browser-warning": "1" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

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

/* ── Legacy compat (used by old home screen) ── */
export type SliderItem = FeaturedItem;
export type AnimeCard = AnimeItem;
export type EpisodeCard = EpisodeItem;

/* ── API calls ──────────────────────────────── */

export function fetchHome() {
  return get<{
    success: boolean;
    data: {
      featured: FeaturedItem[];
      sections: HomeSection[];
    };
  }>("/api/merged/home", 45000);
}

export function fetchEpisodes(animeUrl: string) {
  return get<{
    success: boolean;
    data: AnimeDetail & {
      episodes4up?: Episode[];
      merged?: { anime4up: string } | null;
    };
  }>(`/api/merged/episodes?url=${encodeURIComponent(animeUrl)}`, 30000);
}

export function fetchRecent(page = 1) {
  return get<{
    success: boolean;
    data: {
      page: number;
      episodes: EpisodeItem[];
      hasNext: boolean;
    };
  }>(`/api/merged/recent?page=${page}`, 25000);
}

export function fetchVideoServers(episodeUrl: string, url4up?: string) {
  const params = `url=${encodeURIComponent(episodeUrl)}`;
  const with4up = url4up ? `&url4up=${encodeURIComponent(url4up)}` : '';
  return get<{
    success: boolean;
    data: {
      episodeTitle: string;
      animeTitle: string;
      animeHref: string;
      serverCount: number;
      servers: (VideoServer & { source?: string })[];
      navigation: { prev: string | null; next: string | null };
    };
  }>(`/api/merged/extract-video?${params}${with4up}`, 60000);
}

export function searchAnime(query: string) {
  return get<{
    success: boolean;
    data: {
      query: string;
      totalResults: number;
      results: SearchResult[];
    };
  }>(`/api/merged/search?q=${encodeURIComponent(query)}`);
}

export function fetchGenre(name: string, page = 1) {
  return get<{
    success: boolean;
    data: {
      genre: string;
      page: number;
      items: SearchResult[];
      hasNext: boolean;
    };
  }>(`/api/merged/genre?name=${encodeURIComponent(name)}&page=${page}`, 25000);
}

export function fetchAllAnime(page = 1) {
  return get<{
    success: boolean;
    data: {
      page: number;
      items: SearchResult[];
      hasNext: boolean;
    };
  }>(`/api/merged/all-anime?page=${page}`, 30000);
}

export function resolveVideo(iframeUrl: string, provider: string) {
  return get<{
    success: boolean;
    data?: { videoUrl: string; type: string };
    error?: string;
  }>(
    `/api/resolve-video?url=${encodeURIComponent(iframeUrl)}&provider=${encodeURIComponent(provider)}`,
  );
}

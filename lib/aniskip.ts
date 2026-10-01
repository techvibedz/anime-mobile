import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetchMalPrefix } from "./animeInfo";
import { slugToTitle } from "./relations";

export interface SkipInterval {
  startTime: number; // in seconds
  endTime: number;   // in seconds
}

export interface EpisodeSkipTimes {
  op?: SkipInterval;
  ed?: SkipInterval;
  found: boolean;
  episodeLength?: number;
}

export interface ActiveSkip {
  type: "op" | "ed";
  interval: SkipInterval;
}

const CACHE_PREFIX = "@aniskip_v1:";
const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days for found
const NOT_FOUND_TTL_MS = 3 * 24 * 60 * 60 * 1000; // 3 days for 404

const memCache = new Map<string, EpisodeSkipTimes>();
const inflight = new Map<string, Promise<EpisodeSkipTimes>>();

const malIdMemCache = new Map<string, number>();

/**
 * Pure parser for the AniSkip API response payload.
 */
export function parseAniSkipResponse(raw: any): EpisodeSkipTimes {
  if (!raw || typeof raw !== "object" || raw.found !== true || !Array.isArray(raw.results)) {
    return { found: false };
  }

  let op: SkipInterval | undefined;
  let ed: SkipInterval | undefined;
  let episodeLength: number | undefined;

  for (const item of raw.results) {
    if (!item || !item.interval) continue;
    const start = Number(item.interval.startTime);
    const end = Number(item.interval.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;

    const interval: SkipInterval = {
      startTime: Math.max(0, Math.round(start * 10) / 10),
      endTime: Math.max(0, Math.round(end * 10) / 10),
    };

    if (item.skipType === "op" && (!op || interval.endTime > op.endTime)) {
      op = interval;
    } else if (item.skipType === "ed" && (!ed || interval.endTime > ed.endTime)) {
      ed = interval;
    }

    if (typeof item.episodeLength === "number" && item.episodeLength > 0) {
      episodeLength = item.episodeLength;
    }
  }

  const found = Boolean(op || ed);
  return {
    found,
    op,
    ed,
    episodeLength,
  };
}

/**
 * Returns true if current video playback time falls within the given interval.
 */
export function isInsideInterval(
  currentTime: number,
  interval?: SkipInterval | null,
  leadBuffer = 0.5,
  tailBuffer = 0.5,
): boolean {
  if (!interval || typeof currentTime !== "number" || isNaN(currentTime)) return false;
  return currentTime >= interval.startTime - leadBuffer && currentTime < interval.endTime - tailBuffer;
}

/**
 * Determines which skip interval (intro or outro) is currently active.
 */
export function activeSkipInterval(
  currentTime: number,
  skipTimes?: EpisodeSkipTimes | null,
): ActiveSkip | null {
  if (!skipTimes || !skipTimes.found) return null;
  if (isInsideInterval(currentTime, skipTimes.op)) {
    return { type: "op", interval: skipTimes.op! };
  }
  if (isInsideInterval(currentTime, skipTimes.ed)) {
    return { type: "ed", interval: skipTimes.ed! };
  }
  return null;
}

/**
 * Resolve MyAnimeList ID from anime title and/or URL slug.
 */
export async function resolveMalId(title?: string | null, slugOrUrl?: string | null): Promise<number | null> {
  const normTitle = (title || "").trim();
  const slug = (slugOrUrl || "").trim();
  const cacheKey = (normTitle + "::" + slug).toLowerCase();

  if (malIdMemCache.has(cacheKey)) {
    return malIdMemCache.get(cacheKey) ?? null;
  }

  const candidates: string[] = [];
  if (normTitle) candidates.push(normTitle);
  if (slug) {
    const derived = slugToTitle(slug);
    if (derived && derived.toLowerCase() !== normTitle.toLowerCase()) {
      candidates.push(derived);
    }
  }

  for (const query of candidates) {
    try {
      const hit = await fetchMalPrefix(query);
      if (hit && typeof hit.id === "number" && hit.id > 0) {
        malIdMemCache.set(cacheKey, hit.id);
        return hit.id;
      }
    } catch {}
  }

  return null;
}

/**
 * Fetch skip intervals for a given MAL ID and episode number from AniSkip API.
 */
export async function fetchSkipTimesFromApi(
  malId: number,
  episodeNumber: number,
  durationSeconds = 0,
): Promise<EpisodeSkipTimes> {
  if (!malId || !episodeNumber || episodeNumber < 1) {
    return { found: false };
  }

  const cacheKey = `${malId}:${episodeNumber}`;
  if (memCache.has(cacheKey)) {
    return memCache.get(cacheKey)!;
  }

  const pending = inflight.get(cacheKey);
  if (pending) return pending;

  const promise = (async (): Promise<EpisodeSkipTimes> => {
    // 1. Check AsyncStorage persistent cache
    try {
      const raw = await AsyncStorage.getItem(CACHE_PREFIX + cacheKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        const ttl = parsed.data?.found ? CACHE_TTL_MS : NOT_FOUND_TTL_MS;
        if (parsed.data && Date.now() - parsed.ts < ttl) {
          memCache.set(cacheKey, parsed.data);
          return parsed.data;
        }
      }
    } catch {}

    // 2. Fetch from AniSkip
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const url = `https://api.aniskip.com/v2/skip-times/${malId}/${episodeNumber}?types[]=op&types[]=ed&episodeLength=${Math.round(durationSeconds)}`;

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });

      if (res.status === 404) {
        const notFound: EpisodeSkipTimes = { found: false };
        memCache.set(cacheKey, notFound);
        try {
          await AsyncStorage.setItem(CACHE_PREFIX + cacheKey, JSON.stringify({ ts: Date.now(), data: notFound }));
        } catch {}
        return notFound;
      }

      if (!res.ok) {
        return { found: false };
      }

      const json = await res.json();
      const result = parseAniSkipResponse(json);

      memCache.set(cacheKey, result);
      try {
        await AsyncStorage.setItem(CACHE_PREFIX + cacheKey, JSON.stringify({ ts: Date.now(), data: result }));
      } catch {}
      return result;
    } catch {
      return { found: false };
    } finally {
      clearTimeout(timer);
      inflight.delete(cacheKey);
    }
  })();

  inflight.set(cacheKey, promise);
  return promise;
}

/**
 * High-level helper: resolve anime MAL ID and fetch episode skip times.
 */
export async function getEpisodeSkipTimes({
  title,
  episodeNumber,
  slugOrUrl,
  durationSeconds = 0,
}: {
  title?: string | null;
  episodeNumber?: number | null;
  slugOrUrl?: string | null;
  durationSeconds?: number;
}): Promise<EpisodeSkipTimes> {
  if (!episodeNumber || episodeNumber < 1) {
    return { found: false };
  }

  const malId = await resolveMalId(title, slugOrUrl);
  if (!malId) {
    return { found: false };
  }

  return fetchSkipTimesFromApi(malId, episodeNumber, durationSeconds);
}

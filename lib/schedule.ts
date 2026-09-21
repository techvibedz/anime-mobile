// Weekly anime schedule.
//
// Sourced from Witanime's own /schedule page: it is static HTML (one plain GET,
// no per-title availability checks), every row carries a real poster image and a
// ready /anime/<slug> link, and everything it lists is by definition playable.
//
// Cached per local day so the bucketing stays correct across a date rollover,
// with a short TTL so newly-scheduled episodes roll in.

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  searchAnime4upDirect,
  searchAnime3rbCatalog,
  fetchWitanimeScheduleDirect,
} from "./scraper/direct";

export interface ScheduleItem {
  /** Stable source id — used as a list key and for de-duping. */
  id: number;
  /** Best display title (romaji preferred — most recognizable + searchable). */
  title: string;
  image: string | null;
  /** Episode number that airs. */
  episode: number;
  /** Unix timestamp (seconds) when it airs. */
  airingAt: number;
  format: string | null;
  /** Source score (0–100) or null. */
  score: number | null;
  /** Resolved witanime detail URL — the schedule row opens this directly. */
  sourceHref: string;
}

export interface ScheduleDay {
  /** Unix seconds at local midnight of this day. */
  dayStart: number;
  /** Local weekday index, 0 = Sunday … 6 = Saturday. */
  weekday: number;
  items: ScheduleItem[];
}

const CACHE_PREFIX = "@anime_schedule_v2:";
const TTL = 3 * 60 * 60 * 1000; // 3h

type Cached = { ts: number; data: ScheduleDay[] };

const inflight = new Map<string, Promise<ScheduleDay[]>>();

// Seven empty day-buckets starting at local midnight today.
function buildDays(): ScheduleDay[] {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days: ScheduleDay[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    days.push({ dayStart: Math.floor(d.getTime() / 1000), weekday: d.getDay(), items: [] });
  }
  return days;
}

// Stable cache key keyed to the local date so a rollover past midnight starts a
// fresh week rather than serving yesterday's buckets.
function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// Mon..Sun (as used in the witanime schedule HTML) → JS weekday index.
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

async function doFetch(): Promise<ScheduleDay[]> {
  const days = buildDays();
  const entries = await fetchWitanimeScheduleDirect();
  if (!entries) return days;

  // Each weekday appears exactly once in the 7-day window (today first).
  const byWeekday = new Map(days.map((d) => [d.weekday, d]));
  let id = 0;
  for (const entry of entries) {
    const day = byWeekday.get(WEEKDAYS[entry.weekday] ?? -1);
    if (!day) continue;
    day.items.push({
      id: id++,
      title: entry.title,
      image: entry.image,
      episode: entry.episode,
      // Witanime lists no air times; midnight marks "this day, time unknown".
      airingAt: day.dayStart,
      format: entry.format,
      score: entry.score,
      sourceHref: entry.href,
    });
  }
  return days;
}

/**
 * Resolve the 7-day airing calendar (today + the next 6 days), grouped by local
 * day. Cached on disk per local date; `force` bypasses the cache for a
 * pull-to-refresh. Returns 7 buckets (some may be empty) or, on total failure,
 * the empty 7-bucket skeleton so the screen still renders the day rail.
 */
export async function fetchWeeklySchedule(force = false): Promise<ScheduleDay[]> {
  const key = CACHE_PREFIX + todayKey();

  if (!force) {
    const pending = inflight.get(key);
    if (pending) return pending;
    try {
      const raw = await AsyncStorage.getItem(key);
      if (raw) {
        const parsed: Cached = JSON.parse(raw);
        if (Date.now() - parsed.ts < TTL && Array.isArray(parsed.data) && parsed.data.length === 7) {
          return parsed.data;
        }
      }
    } catch {}
  }

  const p = (async () => {
    try {
      const data = await doFetch();
      const hasAny = data.some((d) => d.items.length > 0);
      // Only persist a non-empty week; an all-empty result is likely a transient
      // hiccup and shouldn't be frozen for the whole TTL.
      if (hasAny) {
        try {
          await AsyncStorage.setItem(key, JSON.stringify({ ts: Date.now(), data } as Cached));
        } catch {}
      }
      return data;
    } catch {
      return buildDays();
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/* ── Source availability ─────────────────────────
 * Not needed for the schedule anymore (witanime rows already carry playable
 * links), but the home/seasons screens open titles by romaji title, so this
 * resolves a title to a playable anime4up/anime3rb URL. Cached in memory + on
 * disk for a week so a given title is only ever checked once. */
const SRCURL_PREFIX = "@anime_srcurl_v1:";
const SRCURL_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const srcUrlMem = new Map<string, string | null>();
const srcUrlInflight = new Map<string, Promise<string | null>>();

function availKey(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Resolve a title to a playable source anime URL (anime4up preferred for its
 * rich TV pages + cross-source enrichment, then anime3rb). Both are plain-GET /
 * no-WebView and the anime3rb catalog is a shared pre-warmed sitemap, so this is
 * cheap. Returns null when neither source carries the title. Cached in memory +
 * on disk for a week (positive hits only — a null may be a transient miss).
 */
export async function resolveSourceUrl(title: string): Promise<string | null> {
  const key = availKey(title);
  if (!key) return null;
  if (srcUrlMem.has(key)) return srcUrlMem.get(key)!;
  const pending = srcUrlInflight.get(key);
  if (pending) return pending;

  const p = (async () => {
    try {
      const raw = await AsyncStorage.getItem(SRCURL_PREFIX + key);
      if (raw) {
        const parsed = JSON.parse(raw) as { ts: number; url: string };
        if (Date.now() - parsed.ts < SRCURL_TTL && parsed.url) {
          srcUrlMem.set(key, parsed.url);
          return parsed.url;
        }
      }
    } catch {}

    // anime4up first (preferred), anime3rb concurrently as the fallback. Each is
    // bounded so a flaky site can't stall the per-item resolution.
    const ITEM_TIMEOUT_MS = 6000;
    const withTo = <T,>(pr: Promise<T>, ms: number): Promise<T | null> =>
      Promise.race([pr.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
    const u3p = withTo(searchAnime3rbCatalog(title), ITEM_TIMEOUT_MS); // run in parallel
    let url: string | null = await withTo(searchAnime4upDirect(title), ITEM_TIMEOUT_MS);
    if (!url) url = await u3p;

    srcUrlMem.set(key, url ?? null);
    try {
      if (url) await AsyncStorage.setItem(SRCURL_PREFIX + key, JSON.stringify({ ts: Date.now(), url }));
    } catch {}
    return url ?? null;
  })();
  srcUrlInflight.set(key, p);
  p.finally(() => srcUrlInflight.delete(key));
  return p;
}

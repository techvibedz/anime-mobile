// Weekly anime airing calendar.
//
// Same data source as the per-anime countdown (lib/airing.ts): AniList's
// GraphQL API. Where `airing.ts` resolves the next episode for ONE title, this
// pulls the whole `airingSchedules` feed for the coming 7 days and buckets it by
// local calendar day — "what new episode airs each day this week".
//
// The source sites (witanime/anime4up/anime3rb) expose no air-time data at all,
// so AniList is the only way to build a real schedule. The feed is global; we
// drop adult entries and keep everything else (a viewer can tap through to
// search our own sources for the Arabic sub/dub).
//
// Cached per local day so the bucketing stays correct across a date rollover,
// with a short TTL so newly-scheduled episodes roll in. Because each item
// carries an absolute `airingAt`, a slightly stale cache is still correct — the
// screen recomputes "today/upcoming" from the device clock.

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  searchAnime4upDirect,
  searchAnime3rbCatalog,
} from "./scraper/direct";

export interface ScheduleItem {
  /** AniList media id — used as a stable list key and for de-duping. */
  id: number;
  /** Best display title (romaji preferred — most recognizable + searchable). */
  title: string;
  image: string | null;
  /** Episode number that airs. */
  episode: number;
  /** Unix timestamp (seconds) when it airs. */
  airingAt: number;
  format: string | null;
  /** AniList average score (0–100) or null. */
  score: number | null;
}

export interface ScheduleDay {
  /** Unix seconds at local midnight of this day. */
  dayStart: number;
  /** Local weekday index, 0 = Sunday … 6 = Saturday. */
  weekday: number;
  items: ScheduleItem[];
}

const ANILIST_URL = "https://graphql.anilist.co";
const CACHE_PREFIX = "@anime_schedule_v1:";
const TTL = 3 * 60 * 60 * 1000; // 3h
const MAX_PAGES = 8; // 8 × 50 = 400 entries — far more than a week ever holds.

const QUERY = `query ($start: Int, $end: Int, $page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    airingSchedules(airingAt_greater: $start, airingAt_lesser: $end, sort: TIME) {
      airingAt
      episode
      media {
        id
        title { romaji english native }
        coverImage { large medium }
        format
        averageScore
        isAdult
        countryOfOrigin
      }
    }
  }
}`;

type Cached = { ts: number; data: ScheduleDay[] };

const inflight = new Map<string, Promise<ScheduleDay[]>>();

// Seven empty day-buckets starting at local midnight today.
function buildDays(): { days: ScheduleDay[]; windowStart: number; windowEnd: number } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days: ScheduleDay[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    days.push({ dayStart: Math.floor(d.getTime() / 1000), weekday: d.getDay(), items: [] });
  }
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  return {
    days,
    windowStart: Math.floor(start.getTime() / 1000),
    windowEnd: Math.floor(end.getTime() / 1000),
  };
}

// Stable cache key keyed to the local date so a rollover past midnight starts a
// fresh week rather than serving yesterday's buckets.
function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function pickTitle(t: any): string {
  return (t?.romaji || t?.english || t?.native || "").trim();
}

async function fetchPage(start: number, end: number, page: number): Promise<{ items: any[]; hasNext: boolean }> {
  const res = await fetch(ANILIST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query: QUERY, variables: { start, end, page } }),
  });
  if (!res.ok) return { items: [], hasNext: false };
  const json = await res.json();
  const p = json?.data?.Page;
  return { items: p?.airingSchedules || [], hasNext: !!p?.pageInfo?.hasNextPage };
}

async function doFetch(): Promise<ScheduleDay[]> {
  const { days, windowStart, windowEnd } = buildDays();
  // airingAt_greater is exclusive, so step back a second to keep a midnight airing.
  const start = windowStart - 1;
  const seen = new Set<string>(); // de-dupe per (media, day)

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { items, hasNext } = await fetchPage(start, windowEnd, page).catch(() => ({ items: [], hasNext: false }));
    for (const s of items) {
      const m = s?.media;
      if (!m || m.isAdult) continue;
      // Drop non-Japanese productions (Chinese/Korean donghua like "Soul Land")
      // — the Arabic source sites don't carry them, so they'd never resolve.
      if (m.countryOfOrigin && m.countryOfOrigin !== "JP") continue;
      const title = pickTitle(m.title);
      if (!title) continue;
      const airingAt: number = s.airingAt;
      // Bucket by LOCAL calendar day (robust across DST, unlike /86400 math).
      const d = new Date(airingAt * 1000);
      const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000;
      const day = days.find((x) => x.dayStart === midnight);
      if (!day) continue;
      const dedupe = `${m.id}#${day.dayStart}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      day.items.push({
        id: m.id,
        title,
        image: m.coverImage?.large || m.coverImage?.medium || null,
        episode: typeof s.episode === "number" ? s.episode : 0,
        airingAt,
        format: m.format || null,
        score: typeof m.averageScore === "number" ? m.averageScore : null,
      });
    }
    if (!hasNext) break;
  }

  // Keep each day chronological (the global TIME sort already does this, but a
  // late page could append out of order after de-duping).
  for (const day of days) day.items.sort((a, b) => a.airingAt - b.airingAt);
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
      // AniList hiccup and shouldn't be frozen for the whole TTL.
      if (hasAny) {
        try {
          await AsyncStorage.setItem(key, JSON.stringify({ ts: Date.now(), data } as Cached));
        } catch {}
      }
      return data;
    } catch {
      return buildDays().days;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/* ── Source availability ─────────────────────────
 * The schedule comes from AniList's global feed, but the app can only PLAY what
 * its own sources carry. Verify each title against anime4up + anime3rb (the two
 * romaji-friendly sources, both plain-GET / no WebView) and hide anything that
 * resolves on neither. Results are cached in memory + on disk for a week so a
 * given title is only ever checked once. */
const AVAIL_PREFIX = "@anime_avail_v1:";
const AVAIL_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const availMem = new Map<string, boolean>();
const availInflight = new Map<string, Promise<boolean>>();

function availKey(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ").trim();
}

async function isAnimeAvailable(title: string): Promise<boolean> {
  const key = availKey(title);
  if (!key) return false;
  if (availMem.has(key)) return availMem.get(key)!;
  const pending = availInflight.get(key);
  if (pending) return pending;

  const p = (async () => {
    try {
      const raw = await AsyncStorage.getItem(AVAIL_PREFIX + key);
      if (raw) {
        const parsed = JSON.parse(raw) as { ts: number; ok: boolean };
        if (Date.now() - parsed.ts < AVAIL_TTL) {
          availMem.set(key, parsed.ok);
          return parsed.ok;
        }
      }
    } catch {}

    // Two CHEAP checks, run in PARALLEL (first positive wins):
    //   • anime4up direct  — one GET.
    //   • anime3rb catalog — one shared sitemap GET (pre-warmed + cached), then
    //     an in-memory match; a confirm GET only fires on a hit.
    // The old path also tried searchAnime3rbDirect, which slug-probes several
    // URLs per title and was the main reason verification dragged — the catalog
    // already covers anime3rb, so it's dropped here. Bounded by a per-item
    // deadline (fetchHtml retries 3×9s, so a flaky site could otherwise stall a
    // title ~80s); a timeout counts as "unknown" (false), which the caller's
    // all-empty guard treats as "sources unreachable, show the raw list".
    const ITEM_TIMEOUT_MS = 6000;
    const check = new Promise<boolean>((resolve) => {
      let pending = 2;
      const settle = (hit: boolean) => {
        if (hit) return resolve(true);
        if (--pending === 0) resolve(false);
      };
      searchAnime4upDirect(title).then((u) => settle(!!u)).catch(() => settle(false));
      searchAnime3rbCatalog(title).then((u) => settle(!!u)).catch(() => settle(false));
    });
    const ok = await Promise.race([
      check,
      new Promise<boolean>((r) => setTimeout(() => r(false), ITEM_TIMEOUT_MS)),
    ]).catch(() => false);

    availMem.set(key, ok);
    // Only persist positive hits long-term. A negative could be a transient
    // search/CF miss; letting it re-check next week is cheaper than wrongly
    // hiding an anime the sites actually carry.
    try {
      if (ok) await AsyncStorage.setItem(AVAIL_PREFIX + key, JSON.stringify({ ts: Date.now(), ok: true }));
    } catch {}
    availInflight.delete(key);
    return ok;
  })();
  availInflight.set(key, p);
  return p;
}

// Run a list through `isAnimeAvailable` with bounded concurrency and return only
// the items the sources can actually serve, preserving the original order.
//
// `onProgress` fires after every resolution with the available items found SO
// FAR (in original order), so the screen can stream rows in as they're confirmed
// instead of waiting for the whole day — most of the perceived speed-up.
export async function filterAvailableItems(
  items: ScheduleItem[],
  onProgress?: (availableSoFar: ScheduleItem[]) => void,
): Promise<ScheduleItem[]> {
  if (items.length === 0) return [];

  // Pre-warm the anime3rb catalog sitemap ONCE (one ~6300-slug GET). Without
  // this, the first concurrency-wide burst of catalog checks would each refetch
  // the sitemap; warming it first makes every per-item catalog match in-memory.
  await searchAnime3rbCatalog(items[0]?.title || "").catch(() => {});

  const keep = new Array<boolean>(items.length).fill(false);
  const emit = () => onProgress?.(items.filter((_, i) => keep[i]));

  const CONCURRENCY = 12;
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      keep[i] = await isAnimeAvailable(items[i].title).catch(() => false);
      if (keep[i]) emit();
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return items.filter((_, i) => keep[i]);
}

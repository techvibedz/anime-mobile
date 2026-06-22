// Upcoming anime + per-season catalogues, sourced from AniList.
//
// Same idea as lib/schedule.ts: the source sites (witanime / anime4up /
// anime3rb) have no concept of "next season" or a clean season catalogue, so
// AniList's GraphQL API is the only place to build these listings. AniList is a
// global database, so we filter hard to the kind of titles our sources actually
// carry:
//   • isAdult is rejected at the API level AND re-checked client-side,
//   • the "Hentai" genre is dropped,
//   • non-Japanese productions (Chinese/Korean donghua) are dropped — the Arabic
//     fansub sites don't carry them.
// For RELEASED seasons the caller additionally runs the list through
// filterAvailableItems (lib/schedule) to keep ONLY titles confirmed on our
// sources. Upcoming titles aren't released yet, so they can't be source-verified
// — we lean on the popularity sort (the most-anticipated mainstream JP anime are
// exactly the ones the sources pick up the moment they air) plus the adult/JP
// guards above.
//
// Cached per query key on disk with a short-ish TTL so new listings roll in.

import AsyncStorage from "@react-native-async-storage/async-storage";

export type Season = "WINTER" | "SPRING" | "SUMMER" | "FALL";

export interface CatalogAnime {
  /** AniList media id — stable list key + de-dupe. */
  id: number;
  /** Best display title (romaji preferred — most recognizable + searchable). */
  title: string;
  image: string | null;
  format: string | null;
  /** AniList average score (0–100) or null. */
  score: number | null;
  episodes: number | null;
  genres: string[];
  /** AniList status: RELEASING / NOT_YET_RELEASED / FINISHED … */
  status: string | null;
  /** Unix seconds for the announced start date (upcoming list), else null. */
  startAt: number | null;
  /** AniList popularity (number of users with the title on a list). */
  popularity: number;
  /** Resolved source anime URL (filled in by lib/popular's verification) so a
   *  card can open the real detail page directly instead of via search. */
  sourceHref?: string;
}

export interface SeasonOption {
  season: Season;
  year: number;
  /** i18n label, e.g. "خريف 2025". */
  label: string;
}

const ANILIST_URL = "https://graphql.anilist.co";
// v2: added `popularity` to the cached shape (powers the Upcoming filter).
const CACHE_PREFIX = "@anime_catalog_v2:";
const TTL = 6 * 60 * 60 * 1000; // 6h
const MAX_PAGES = 4; // 4 × 50 = 200 — plenty after filtering.

const SEASON_FIELDS = `
  id
  title { romaji english native }
  coverImage { large medium }
  format
  averageScore
  episodes
  genres
  status
  popularity
  countryOfOrigin
  isAdult
  startDate { year month day }
`;

const SEASON_QUERY = `query ($season: MediaSeason, $year: Int, $page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    media(season: $season, seasonYear: $year, type: ANIME, sort: POPULARITY_DESC, isAdult: false) {
      ${SEASON_FIELDS}
    }
  }
}`;

const UPCOMING_QUERY = `query ($page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    media(type: ANIME, status: NOT_YET_RELEASED, sort: POPULARITY_DESC, isAdult: false) {
      ${SEASON_FIELDS}
    }
  }
}`;

// Popularity-ranked catalogue. `seasonYear` and `format` are optional — AniList
// ignores a null/absent filter argument — so the SAME query powers
// "most popular of all time" (no extra filter), "most popular this year"
// (seasonYear) and "most popular movies" (format: MOVIE).
const POPULAR_QUERY = `query ($page: Int, $seasonYear: Int, $format: MediaFormat) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    media(type: ANIME, sort: POPULARITY_DESC, isAdult: false, seasonYear: $seasonYear, format: $format) {
      ${SEASON_FIELDS}
    }
  }
}`;

const SEASON_ORDER: Season[] = ["WINTER", "SPRING", "SUMMER", "FALL"];

/* ── Single-title detail (Upcoming detail page) ──────────────────
 * Upcoming titles aren't on our sources yet, so their detail page is built
 * entirely from AniList: synopsis, trailer, studios, air date, genres and the
 * relation graph. One keyless GraphQL request. */

export interface AniRelation {
  id: number;
  title: string;
  image: string | null;
  format: string | null;
  relation: string | null;
}
export interface AniLink { site: string; url: string }
export interface AniListDetail {
  id: number;
  title: string;
  titleEnglish: string | null;
  description: string;
  banner: string | null;
  cover: string | null;
  genres: string[];
  score: number | null;
  episodes: number | null;
  duration: number | null;
  format: string | null;
  status: string | null;
  season: string | null;
  seasonYear: number | null;
  startAt: number | null;
  studios: string[];
  /** YouTube video id when the trailer is hosted on YouTube, else null. */
  trailerYoutube: string | null;
  externalLinks: AniLink[];
  relations: AniRelation[];
}

const DETAIL_QUERY = `query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    title { romaji english native }
    description(asHtml: false)
    bannerImage
    coverImage { extraLarge large medium }
    genres
    averageScore
    episodes
    duration
    format
    status
    season
    seasonYear
    isAdult
    startDate { year month day }
    studios(isMain: true) { nodes { name } }
    trailer { id site }
    externalLinks { site url }
    relations {
      edges {
        relationType
        node { id type title { romaji english } coverImage { large medium } format isAdult }
      }
    }
  }
}`;

function stripHtml(s: string | null | undefined): string {
  return (s || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const detailCache = new Map<number, AniListDetail>();

export async function fetchAniListDetail(id: number): Promise<AniListDetail | null> {
  if (!id) return null;
  const cached = detailCache.get(id);
  if (cached) return cached;
  const res = await fetch(ANILIST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query: DETAIL_QUERY, variables: { id } }),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const json = await res.json().catch(() => null);
  const m = json?.data?.Media;
  if (!m) return null;

  const sd = m.startDate;
  const startAt = sd && sd.year ? Math.floor(new Date(sd.year, (sd.month || 1) - 1, sd.day || 1).getTime() / 1000) : null;
  const relations: AniRelation[] = (m.relations?.edges || [])
    .filter((e: any) => e?.node && e.node.type === "ANIME" && !e.node.isAdult)
    .map((e: any) => ({
      id: e.node.id,
      title: (e.node.title?.romaji || e.node.title?.english || "").trim(),
      image: e.node.coverImage?.large || e.node.coverImage?.medium || null,
      format: e.node.format || null,
      relation: e.relationType || null,
    }))
    .filter((r: AniRelation) => r.title);

  const detail: AniListDetail = {
    id: m.id,
    title: (m.title?.romaji || m.title?.english || m.title?.native || "").trim(),
    titleEnglish: m.title?.english || null,
    description: stripHtml(m.description),
    banner: m.bannerImage || null,
    cover: m.coverImage?.extraLarge || m.coverImage?.large || m.coverImage?.medium || null,
    genres: Array.isArray(m.genres) ? m.genres.filter((g: string) => g !== "Hentai") : [],
    score: typeof m.averageScore === "number" ? m.averageScore : null,
    episodes: typeof m.episodes === "number" ? m.episodes : null,
    duration: typeof m.duration === "number" ? m.duration : null,
    format: m.format || null,
    status: m.status || null,
    season: m.season || null,
    seasonYear: m.seasonYear || null,
    startAt,
    studios: (m.studios?.nodes || []).map((n: any) => n?.name).filter(Boolean),
    trailerYoutube: m.trailer?.site === "youtube" && m.trailer?.id ? m.trailer.id : null,
    externalLinks: (m.externalLinks || []).map((l: any) => ({ site: l?.site || "", url: l?.url || "" })).filter((l: AniLink) => l.url),
    relations,
  };
  detailCache.set(id, detail);
  return detail;
}

function pickTitle(t: any): string {
  return (t?.romaji || t?.english || t?.native || "").trim();
}

// AniList's Hentai genre is the catch-all for adult catalogue entries the
// isAdult flag occasionally misses; reject it outright.
function isAcceptable(m: any): boolean {
  if (!m || m.isAdult) return false;
  if (m.countryOfOrigin && m.countryOfOrigin !== "JP") return false;
  if (Array.isArray(m.genres) && m.genres.includes("Hentai")) return false;
  return !!pickTitle(m.title);
}

function toCatalogAnime(m: any): CatalogAnime {
  const sd = m.startDate;
  const startAt =
    sd && sd.year
      ? Math.floor(new Date(sd.year, (sd.month || 1) - 1, sd.day || 1).getTime() / 1000)
      : null;
  return {
    id: m.id,
    title: pickTitle(m.title),
    image: m.coverImage?.large || m.coverImage?.medium || null,
    format: m.format || null,
    score: typeof m.averageScore === "number" ? m.averageScore : null,
    episodes: typeof m.episodes === "number" ? m.episodes : null,
    genres: Array.isArray(m.genres) ? m.genres : [],
    status: m.status || null,
    startAt,
    popularity: typeof m.popularity === "number" ? m.popularity : 0,
  };
}

async function fetchPage(query: string, variables: Record<string, unknown>): Promise<{ items: any[]; hasNext: boolean }> {
  const res = await fetch(ANILIST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) return { items: [], hasNext: false };
  const json = await res.json();
  const p = json?.data?.Page;
  return { items: p?.media || [], hasNext: !!p?.pageInfo?.hasNextPage };
}

type Cached = { ts: number; data: CatalogAnime[] };
const inflight = new Map<string, Promise<CatalogAnime[]>>();

async function loadCatalog(cacheKey: string, fetcher: () => Promise<CatalogAnime[]>): Promise<CatalogAnime[]> {
  const pending = inflight.get(cacheKey);
  if (pending) return pending;
  try {
    const raw = await AsyncStorage.getItem(CACHE_PREFIX + cacheKey);
    if (raw) {
      const parsed: Cached = JSON.parse(raw);
      if (Date.now() - parsed.ts < TTL && Array.isArray(parsed.data) && parsed.data.length > 0) {
        return parsed.data;
      }
    }
  } catch {}

  const p = (async () => {
    try {
      const data = await fetcher();
      if (data.length > 0) {
        try { await AsyncStorage.setItem(CACHE_PREFIX + cacheKey, JSON.stringify({ ts: Date.now(), data } as Cached)); } catch {}
      }
      return data;
    } catch {
      return [];
    } finally {
      inflight.delete(cacheKey);
    }
  })();
  inflight.set(cacheKey, p);
  return p;
}

async function collect(query: string, baseVars: Record<string, unknown>, maxPages = MAX_PAGES): Promise<CatalogAnime[]> {
  const out: CatalogAnime[] = [];
  const seen = new Set<number>();
  for (let page = 1; page <= maxPages; page++) {
    const { items, hasNext } = await fetchPage(query, { ...baseVars, page }).catch(() => ({ items: [], hasNext: false }));
    for (const m of items) {
      if (!isAcceptable(m) || seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(toCatalogAnime(m));
    }
    if (!hasNext) break;
  }
  return out;
}

/**
 * Upcoming (not-yet-released) JP anime in AniList popularity order. The screen
 * applies the active filter (most-popular vs soonest-airing) on top of this, so
 * the list is returned in its native popularity ranking here.
 */
export async function fetchUpcomingAnime(): Promise<CatalogAnime[]> {
  return loadCatalog("upcoming", () => collect(UPCOMING_QUERY, {}));
}

/** Full popularity-ranked catalogue for one season. */
export async function fetchSeasonAnime(season: Season, year: number): Promise<CatalogAnime[]> {
  return loadCatalog(`${season}-${year}`, () => collect(SEASON_QUERY, { season, year }));
}

export type PopularKind = "all_time" | "this_year" | "movies";

/**
 * Popularity-ranked catalogue for a "most popular" home rail. JP-only / non-adult
 * (same guards as the season catalogue), in AniList popularity order. The caller
 * (lib/popular) verifies each title against our sources before display so the
 * rail only ever shows anime the app can actually open.
 */
export async function fetchPopularAnime(kind: PopularKind): Promise<CatalogAnime[]> {
  // 2 pages (~100 titles) is plenty after source-verification, and keeps the
  // cold home load light (was 4 pages × 3 rails = 12 AniList requests at once).
  const PAGES = 2;
  if (kind === "movies") {
    return loadCatalog("popular-movies", () => collect(POPULAR_QUERY, { format: "MOVIE" }, PAGES));
  }
  if (kind === "this_year") {
    const year = new Date().getFullYear();
    return loadCatalog(`popular-year-${year}`, () => collect(POPULAR_QUERY, { seasonYear: year }, PAGES));
  }
  return loadCatalog("popular-all", () => collect(POPULAR_QUERY, {}, PAGES));
}

// Current season from the device clock (Dec–Feb = Winter, etc.).
export function currentSeason(date = new Date()): { season: Season; year: number } {
  const m = date.getMonth(); // 0 = Jan
  const year = date.getFullYear();
  if (m <= 1) return { season: "WINTER", year };      // Jan–Feb
  if (m <= 4) return { season: "SPRING", year };       // Mar–May
  if (m <= 7) return { season: "SUMMER", year };       // Jun–Aug
  if (m <= 10) return { season: "FALL", year };        // Sep–Nov
  return { season: "WINTER", year: year + 1 };         // Dec → next Winter
}

const SEASON_LABEL_AR: Record<Season, string> = {
  WINTER: "شتاء",
  SPRING: "ربيع",
  SUMMER: "صيف",
  FALL: "خريف",
};

// The selectable seasons for the Seasons screen: the current season and the
// previous ones (newest first). All are RELEASED, so the screen can verify each
// title against our sources. Two years back is plenty of browsable history.
export function seasonOptions(count = 8): SeasonOption[] {
  const { season, year } = currentSeason();
  let idx = SEASON_ORDER.indexOf(season);
  let y = year;
  const out: SeasonOption[] = [];
  for (let i = 0; i < count; i++) {
    const s = SEASON_ORDER[idx];
    out.push({ season: s, year: y, label: `${SEASON_LABEL_AR[s]} ${y}` });
    idx -= 1;
    if (idx < 0) { idx = SEASON_ORDER.length - 1; y -= 1; }
  }
  return out;
}

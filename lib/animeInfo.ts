// MyAnimeList enrichment for the app — powers both the detail page's "تفاصيل"
// (Info) tab and the MAL rating badges shown on posters.
//
// witanime's scrape gives us a title, poster, synopsis and genres but no
// structured facts or a community score. We pull those from Jikan (the free,
// key-less MyAnimeList API). A single fetch per title yields BOTH the score and
// the Arabic-labelled fact list, cached together so the badge and the Info tab
// never hit the network twice for the same anime.
//
// Jikan rate-limits hard (~3 req/s, 60/min), and a grid of posters can ask for
// dozens of ratings at once, so requests go through a small rate-limited queue
// and every result is cached in AsyncStorage for a week.

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  RELATIONS_PAGE_QUERY,
  RELATIONS_BY_ID_QUERY,
  RELATIONS_BY_MAL_QUERY,
  buildSearchQueries,
  slugToTitle,
  pickBestMedia,
  collectFranchise,
  type AniListMedia,
  type RelatedAnimeEntry,
} from "./relations";

export type { RelatedAnimeEntry } from "./relations";

export interface AnimeInfoField {
  label: string;
  value: string;
}

export interface MalData {
  score: number | null;
  fields: AnimeInfoField[];
}

const EMPTY: MalData = { score: null, fields: [] };

// v2 — the cached shape changed from AnimeInfoField[] to MalData.
const CACHE_PREFIX = "@anime_mal_v2:";
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

/* ── Arabic value maps ──────────────────────────── */

const TYPE_AR: Record<string, string> = {
  TV: "مسلسل",
  Movie: "فيلم",
  OVA: "OVA",
  ONA: "ONA",
  Special: "حلقة خاصة",
  "TV Special": "حلقة خاصة",
  Music: "موسيقى",
};

const STATUS_AR: Record<string, string> = {
  "Finished Airing": "مكتمل",
  "Currently Airing": "يُعرض حالياً",
  "Not yet aired": "لم يُعرض بعد",
};

const SEASON_AR: Record<string, string> = {
  winter: "شتاء",
  spring: "ربيع",
  summer: "صيف",
  fall: "خريف",
};

const SOURCE_AR: Record<string, string> = {
  Manga: "مانغا",
  "Web manga": "مانغا (ويب)",
  "4-koma manga": "مانغا (4-كوما)",
  "Light novel": "رواية خفيفة",
  Novel: "رواية",
  "Web novel": "رواية (ويب)",
  "Visual novel": "رواية مرئية",
  Original: "عمل أصلي",
  Game: "لعبة",
  "Card game": "لعبة بطاقات",
  "Picture book": "كتاب مصوّر",
  Music: "موسيقى",
  "Mixed media": "وسائط متعددة",
  Other: "أخرى",
};

const RATING_AR: Record<string, string> = {
  "G - All Ages": "لكل الأعمار",
  "PG - Children": "للأطفال",
  "PG-13 - Teens 13 or older": "+13 سنة",
  "R - 17+ (violence & profanity)": "+17 سنة",
  "R+ - Mild Nudity": "+17 سنة",
  "Rx - Hentai": "+18 سنة",
};

/* ── Best-match selection ───────────────────────── */

function norm(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Jikan's plain `q` search often surfaces a side movie/OVA before the main
// series, so score every candidate's titles against the query and break ties by
// popularity (members) — the canonical entry is almost always the most popular.
function pickBest(candidates: any[], query: string): any | null {
  const q = norm(query);
  if (!q) return candidates[0] ?? null;
  let best: any = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    const titles: string[] = [
      c.title,
      c.title_english,
      c.title_japanese,
      ...(Array.isArray(c.titles) ? c.titles.map((t: any) => t?.title) : []),
    ].filter(Boolean);
    let score = 0;
    for (const t of titles) {
      const nt = norm(t);
      if (!nt) continue;
      if (nt === q) score = Math.max(score, 1000);
      else if (nt.includes(q) || q.includes(nt)) score = Math.max(score, 500);
    }
    score += Math.min((c.members || 0) / 100000, 4); // popularity tie-break
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/* ── Field builder ──────────────────────────────── */

function buildFields(a: any): AnimeInfoField[] {
  const fields: AnimeInfoField[] = [];
  const push = (label: string, value: any) => {
    if (value == null || value === "" || value === 0) return;
    fields.push({ label, value: String(value) });
  };

  if (a.type) push("النوع", TYPE_AR[a.type] || a.type);
  if (a.status) push("الحالة", STATUS_AR[a.status] || a.status);
  push("عدد الحلقات", a.episodes);
  if (a.score) push("التقييم", `${a.score} / 10`);
  if (a.rank) push("الترتيب", `#${a.rank}`);
  if (a.popularity) push("الشعبية", `#${a.popularity}`);
  if (a.season) push("الموسم", `${SEASON_AR[a.season] || a.season} ${a.year || ""}`.trim());
  else if (a.year) push("سنة العرض", a.year);
  if (a.source) push("المصدر", SOURCE_AR[a.source] || a.source);
  if (a.duration && !/unknown/i.test(a.duration)) push("مدة الحلقة", a.duration);
  const studios = Array.isArray(a.studios) ? a.studios.map((s: any) => s.name).filter(Boolean) : [];
  if (studios.length) push("الاستوديو", studios.join("، "));
  if (a.rating) push("التصنيف العمري", RATING_AR[a.rating] || a.rating);
  if (a.aired?.string && !/not available/i.test(a.aired.string)) push("تاريخ العرض", a.aired.string);

  return fields;
}

/* ── Rate-limited request queue ─────────────────── */
// Jikan caps at ~3 req/s AND ~60 req/min. Serializing 1.1s apart (the old
// setting) made a grid of badges trickle in over ~13s. The visible cards are
// what matter, so run up to 3 lookups in flight and start them ~350ms apart
// (~3/s — Jikan's per-second ceiling) so a screenful of ratings lands in a few
// seconds. A burst can momentarily exceed the per-minute budget; the single
// 429 retry below absorbs that, and every result is cached for a week so
// repeat/scroll-back views are instant.
const MAX_CONCURRENT = 3;
const MIN_GAP_MS = 350;
let active = 0;
let lastStart = 0;
const waiting: (() => void)[] = [];

function schedule<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = async () => {
      active++;
      const gap = MIN_GAP_MS - (Date.now() - lastStart);
      if (gap > 0) await new Promise((r) => setTimeout(r, gap));
      lastStart = Date.now();
      try {
        resolve(await fn());
      } catch (e) {
        reject(e);
      } finally {
        active--;
        const next = waiting.shift();
        if (next) next();
      }
    };
    if (active < MAX_CONCURRENT) run();
    else waiting.push(run);
  });
}

// Jikan/MyAnimeList is flaky and the source sites are messy, which is why some
// titles (e.g. "Tomodachi Game") came back with no rating/info:
//   1. MAL routinely answers 502/503/504 when busy — the old code only retried
//      on 429, so a transient upstream blip left the title permanently blank.
//   2. witanime/anime4up titles are peppered with Arabic season labels and
//      parentheticals ("Tomodachi Game الموسم الأول", "Anime (TV) (2022)") that
//      Jikan's title search can't resolve, returning zero candidates.
// We clean the query and retry transient failures so ratings/info show up.
const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]+/g;

function cleanQuery(title: string): string {
  return (title || "")
    .replace(ARABIC_RE, " ")             // Arabic season labels / dub markers
    .replace(/\([^)]*\)/g, " ")           // (TV), (2022), (Dub)
    .replace(/\b(19|20)\d{2}\b/g, " ")    // a bare year
    .replace(/\b(the\s+)?(final\s+)?season\s*\d*\b/gi, " ")
    .replace(/\bpart\s*\d+\b/gi, " ")
    .replace(/[_–—-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// GET a Jikan endpoint, retrying the failures that actually happen in the wild:
// 429 (rate limit) and 5xx (MAL transiently down). Returns parsed JSON or null.
async function jikanGet(url: string): Promise<any | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
        continue;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
    }
  }
  return null;
}

async function doFetch(title: string): Promise<MalData> {
  // Try the cleaned query first ("Tomodachi Game الموسم الأول" → "Tomodachi
  // Game"); fall back to the raw title for the rare case cleaning empties out.
  const cleaned = cleanQuery(title);
  const attempts = [cleaned, title.trim()].filter((q, i, a) => q && a.indexOf(q) === i);
  for (const q of attempts) {
    const json = await jikanGet(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(q)}&limit=8&sfw`);
    if (!json) continue; // transient failure exhausted its retries — try next query
    const best = pickBest(json?.data || [], cleaned || title);
    if (best) {
      return { score: typeof best.score === "number" ? best.score : null, fields: buildFields(best) };
    }
  }
  return EMPTY;
}

/* ── Public API ─────────────────────────────────── */

const mem = new Map<string, MalData>();
const inflight = new Map<string, Promise<MalData>>();

/** Fetch (and cache) the full MAL payload — score + Arabic fact list. */
export async function fetchAnimeMal(title: string): Promise<MalData> {
  if (!title || !title.trim()) return EMPTY;
  const key = title.toLowerCase().trim();
  const cached = mem.get(key);
  if (cached) return cached;
  const pending = inflight.get(key);
  if (pending) return pending;

  const p = (async (): Promise<MalData> => {
    try {
      const raw = await AsyncStorage.getItem(CACHE_PREFIX + key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Date.now() - parsed.ts < CACHE_TTL) {
          mem.set(key, parsed.data);
          return parsed.data as MalData;
        }
      }
    } catch {}
    try {
      const data = await schedule(() => doFetch(title));
      // Only cache a real hit; an empty result is likely a transient miss and
      // should be free to retry on the next visit.
      if (data.score != null || data.fields.length > 0) {
        mem.set(key, data);
        try {
          await AsyncStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ ts: Date.now(), data }));
        } catch {}
      }
      return data;
    } catch {
      return EMPTY;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/** Just the Arabic fact list (Info tab). */
export async function fetchAnimeInfo(title: string): Promise<AnimeInfoField[]> {
  return (await fetchAnimeMal(title)).fields;
}

/** Just the MAL community score (poster badges). */
export async function getMalRating(title: string): Promise<number | null> {
  return (await fetchAnimeMal(title)).score;
}

/* ── Cross-language alternative titles ──────────────
 * Powers the search screen's English↔Japanese bridge: the source sites index
 * an anime under ONE language (sometimes only romaji, sometimes only the
 * English name), so a query in the other language returns nothing. Jikan
 * resolves the query to a MAL entry and hands back every name it's known by —
 * romaji, English, Japanese and synonyms — which the caller then re-searches
 * the sites with so "King's Game" finds "Ousama Game" and 王様ゲーム finds it too. */

async function doFetchCandidates(title: string): Promise<any[]> {
  const cleaned = cleanQuery(title);
  const attempts = [cleaned, title.trim()].filter((q, i, a) => q && a.indexOf(q) === i);
  for (const q of attempts) {
    const json = await jikanGet(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(q)}&limit=8&sfw`);
    if (json?.data?.length) return json.data;
  }
  return [];
}

const altTitlesCache = new Map<string, string[]>();

/** Alternative names (romaji / English / Japanese / synonyms) for the best
 * Jikan match of `query`, most-canonical first. Empty array on any miss. */
export async function getAltTitles(query: string): Promise<string[]> {
  if (!query || !query.trim()) return [];
  const key = query.toLowerCase().trim();
  const cached = altTitlesCache.get(key);
  if (cached) return cached;
  try {
    const data = await schedule(() => doFetchCandidates(query));
    const best = pickBest(data, query);
    if (!best) {
      altTitlesCache.set(key, []);
      return [];
    }
    const raw: string[] = [
      best.title,
      best.title_english,
      best.title_japanese,
      ...(Array.isArray(best.titles) ? best.titles.map((t: any) => t?.title) : []),
      ...(Array.isArray(best.title_synonyms) ? best.title_synonyms : []),
    ].filter(Boolean);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const tt of raw) {
      const v = String(tt).trim();
      const k = v.toLowerCase();
      if (v && !seen.has(k)) {
        seen.add(k);
        out.push(v);
      }
    }
    altTitlesCache.set(key, out);
    return out;
  } catch {
    return [];
  }
}

/* ── Related anime (AniList relations) ──────────────
 * witanime/anime4up/anime3rb detail pages carry NO related-anime section, so
 * "other seasons / side stories / spin-offs" can't be scraped. AniList's
 * GraphQL API returns an anime's full relation graph — relation type, title,
 * cover image and format — in a SINGLE keyless request (Jikan's relations
 * endpoint omits images and would need one extra fetch per entry).
 *
 * The pure selection/shaping logic (variant generation, candidate scoring,
 * de-dupe, self-exclusion) lives in ./relations so it's unit-testable without
 * the RN runtime. This file only does the network call + caching. */

const REL_CACHE_PREFIX = "@anime_relations_v4:";

// POST a GraphQL query to AniList, retrying the transient failures that occur
// in the wild (429 rate-limit, 5xx). Returns parsed JSON or null.
async function anilistPost(query: string, variables: Record<string, unknown>): Promise<any | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query, variables }),
      });
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
        continue;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
    }
  }
  return null;
}

// Fetch a single AniList media (with its relations) by id — the step that lets
// collectFranchise() walk the SEQUEL/PREQUEL chain past adjacent seasons.
async function fetchMediaById(id: number): Promise<AniListMedia | null> {
  const json = await anilistPost(RELATIONS_BY_ID_QUERY, { id });
  return (json?.data?.Media as AniListMedia) || null;
}

// Resolve a title to its MyAnimeList entry via Jikan — the SAME robust search
// the rating/info features already rely on (it cleans Arabic season labels and
// retries transient failures). Returns the MAL id (for the exact AniList bridge)
// plus every name MAL knows the anime by (extra romanisations for AniList's
// title search). The MAL id is the high-value bit: it sidesteps fuzzy AniList
// title matching entirely. The best candidate is picked against the RAW title
// so the correct season wins.
const malMatchCache = new Map<string, { malId: number | null; titles: string[] }>();
async function getMalMatch(title: string): Promise<{ malId: number | null; titles: string[] }> {
  const empty = { malId: null as number | null, titles: [] as string[] };
  if (!title || !title.trim()) return empty;
  const key = title.toLowerCase().trim();
  const cached = malMatchCache.get(key);
  if (cached) return cached;
  try {
    const data = await schedule(() => doFetchCandidates(title));
    const best = pickBest(data, title);
    if (!best) { malMatchCache.set(key, empty); return empty; }
    const titles: string[] = [
      best.title, best.title_english, best.title_japanese,
      ...(Array.isArray(best.titles) ? best.titles.map((t: any) => t?.title) : []),
      ...(Array.isArray(best.title_synonyms) ? best.title_synonyms : []),
    ].filter(Boolean);
    const result = { malId: typeof best.mal_id === "number" ? best.mal_id : null, titles };
    malMatchCache.set(key, result);
    return result;
  } catch {
    return empty;
  }
}

const relMem = new Map<string, RelatedAnimeEntry[]>();
const relInflight = new Map<string, Promise<RelatedAnimeEntry[]>>();

async function doFetchRelations(title: string, href?: string | null): Promise<RelatedAnimeEntry[]> {
  const slugTitle = slugToTitle(href);

  // 1) MAL-ID bridge (most reliable). Jikan resolves the title robustly — even
  //    Arabic ones — then AniList is looked up EXACTLY by MAL id, with no fuzzy
  //    AniList title matching that some titles slip through. This is the main
  //    detection improvement; it catches the anime that title search misses.
  const mal = await getMalMatch(title).catch(() => ({ malId: null as number | null, titles: [] as string[] }));
  if (mal.malId != null) {
    const json = await anilistPost(RELATIONS_BY_MAL_QUERY, { idMal: mal.malId });
    const media = json?.data?.Media as AniListMedia | undefined;
    if (media) {
      const out = await collectFranchise(media, title, fetchMediaById);
      if (out.length > 0) return out;
    }
  }

  // 2) Fallback: AniList title search, seeded by the scraped title, the source
  //    slug AND every MAL alt-title (extra romanisations). Candidates are scored
  //    and low-confidence matches rejected so we never show a random anime's
  //    relations; self-exclusion keeps a Season-2 page from listing itself.
  const variants = buildSearchQueries([title, ...mal.titles], slugTitle);
  for (const q of variants) {
    const json = await anilistPost(RELATIONS_PAGE_QUERY, { search: q });
    const medias: AniListMedia[] | undefined = json?.data?.Page?.media;
    if (!Array.isArray(medias) || medias.length === 0) continue;
    const best = pickBestMedia(medias, q);
    if (!best) continue;
    // Walk the franchise chain so ALL seasons appear (AniList only links
    // adjacent ones per node), not just the next/previous installment.
    const out = await collectFranchise(best, title, fetchMediaById);
    if (out.length > 0) return out;
  }
  return [];
}

/** Related anime (sequels, prequels, side stories, spin-offs …) for a title.
 * `href` (the source URL) sharpens title detection via its romaji slug.
 * Resolved via AniList and cached for a week. Empty array on any miss. */
export async function fetchAnimeRelations(title: string, href?: string | null): Promise<RelatedAnimeEntry[]> {
  if (!title || !title.trim()) return [];
  const key = title.toLowerCase().trim();
  const cached = relMem.get(key);
  if (cached) return cached;
  const pending = relInflight.get(key);
  if (pending) return pending;

  const p = (async (): Promise<RelatedAnimeEntry[]> => {
    try {
      const raw = await AsyncStorage.getItem(REL_CACHE_PREFIX + key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Date.now() - parsed.ts < CACHE_TTL) {
          relMem.set(key, parsed.data);
          return parsed.data as RelatedAnimeEntry[];
        }
      }
    } catch {}
    try {
      const data = await doFetchRelations(title, href);
      if (data.length > 0) {
        relMem.set(key, data);
        try {
          await AsyncStorage.setItem(REL_CACHE_PREFIX + key, JSON.stringify({ ts: Date.now(), data }));
        } catch {}
      }
      return data;
    } catch {
      return [];
    } finally {
      relInflight.delete(key);
    }
  })();
  relInflight.set(key, p);
  return p;
}

/**
 * Synchronous in-memory peek for a title's score. Returns the cached score
 * (a number, or null when MAL has no score) if it's already been resolved this
 * session, or `undefined` when unknown. Lets a badge paint its score on first
 * render — no loading flash — for anything fetched earlier or already warmed
 * from disk into the in-memory cache.
 */
export function peekMalRating(title: string | null | undefined): number | null | undefined {
  if (!title || !title.trim()) return null;
  const cached = mem.get(title.toLowerCase().trim());
  return cached ? cached.score : undefined;
}

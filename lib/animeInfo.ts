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
import { fuzzyScore } from "./fuzzy";
import {
  RELATIONS_PAGE_QUERY,
  RELATIONS_BY_ID_QUERY,
  RELATIONS_BY_MAL_QUERY,
  buildSearchQueries,
  slugToTitle,
  pickBestMedia,
  scoreMedia,
  seasonNum,
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
  /** Internal cache marker: false means lightweight data that detail views may enrich. */
  _complete?: boolean;
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

const MAL_LABEL_AR: Record<string, string> = {
  Type: "النوع",
  Episodes: "عدد الحلقات",
  Status: "الحالة",
  Aired: "تاريخ العرض",
  Premiered: "الموسم",
  Studios: "الاستوديو",
  Source: "المصدر",
  Duration: "مدة الحلقة",
  Rating: "التصنيف العمري",
  Ranked: "الترتيب",
  Popularity: "الشعبية",
};

function malText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function translateMalValue(label: string, value: string): string {
  if (label === "Type") return TYPE_AR[value] || value;
  if (label === "Status") return STATUS_AR[value] || value;
  if (label === "Source") return SOURCE_AR[value] || value;
  if (label === "Rating") return RATING_AR[value] || value;
  if (label === "Ranked" || label === "Popularity") return value.match(/#\d+/)?.[0] || value;
  if (label === "Premiered") {
    const m = value.match(/^(Winter|Spring|Summer|Fall)\s+(\d{4})$/i);
    if (m) return `${SEASON_AR[m[1].toLowerCase()] || m[1]} ${m[2]}`;
  }
  return value;
}

/** Parse the public MyAnimeList title page without executing its scripts. */
export function parseMalHtml(html: string): MalData {
  const scoreMatch = html.match(
    /<span[^>]*itemprop=["']ratingValue["'][^>]*>\s*(?:<span[^>]*>)?\s*([0-9]+(?:\.[0-9]+)?)/i,
  );
  const score = scoreMatch ? Number(scoreMatch[1]) : null;
  const fields: AnimeInfoField[] = [];
  const seen = new Set<string>();
  const addField = (rawLabel: string, rawValue: string) => {
    const label = malText(rawLabel);
    const value = malText(rawValue);
    if (!MAL_LABEL_AR[label] || !value || /^unknown$/i.test(value) || seen.has(label)) return;
    seen.add(label);
    fields.push({ label: MAL_LABEL_AR[label], value: translateMalValue(label, value) });
  };
  const rows = /<div[^>]*class=["'][^"']*\bspaceit_pad\b[^"']*["'][^>]*>\s*<span[^>]*class=["'][^"']*\bdark_text\b[^"']*["'][^>]*>([^:<]+):<\/span>([\s\S]*?)<\/div>/gi;
  let row: RegExpExecArray | null;
  while ((row = rows.exec(html))) addField(row[1], row[2]);

  const mobileStart = html.indexOf("js-detail-information");
  if (mobileStart >= 0) {
    const tableEnd = html.indexOf("</table>", mobileStart);
    const scope = html.slice(mobileStart, tableEnd > mobileStart ? tableEnd + 8 : mobileStart + 20000);
    const mobileRows = /<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;
    while ((row = mobileRows.exec(scope))) addField(row[1], row[2]);
  }
  return { score: Number.isFinite(score) ? score : null, fields };
}

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
export function pickMalCandidate(candidates: any[], query: string): any | null {
  const q = norm(query);
  if (!q) return candidates[0] ?? null;
  const wantedSeason = seasonNum(query);
  let best: any = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    const titles: string[] = [
      c.title,
      c.title_english,
      c.title_japanese,
      ...(Array.isArray(c.titles) ? c.titles.map((t: any) => t?.title) : []),
    ].filter(Boolean);
    const candidateSeason = Math.max(0, ...titles.map((t) => seasonNum(t)));
    if (wantedSeason > 0 && (candidateSeason || 1) !== wantedSeason) continue;
    let titleScore = 0;
    for (const t of titles) {
      const nt = norm(t);
      if (!nt) continue;
      if (nt === q) titleScore = Math.max(titleScore, 1000);
      else if (nt.includes(q) || q.includes(nt)) titleScore = Math.max(titleScore, 500);
      else titleScore = Math.max(titleScore, fuzzyScore(q, nt) * 400);
    }
    if (titleScore < 220) continue;
    let score = titleScore + (wantedSeason > 0 && candidateSeason === wantedSeason ? 100 : 0);
    score += Math.min((c.members || 0) / 100000, 4); // popularity tie-break
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

type MalPrefixResult = { id: number; url: string; data: MalData };

/** Select and shape a public MAL prefix-search response. */
export function parseMalPrefix(json: any, query: string): MalPrefixResult | null {
  const category = (json?.categories || []).find((c: any) => c?.type === "anime");
  const items: any[] = Array.isArray(category?.items) ? category.items : [];
  const best = pickMalCandidate(items.map((item) => ({ ...item, title: item.name })), query);
  if (!best || typeof best.id !== "number" || fuzzyScore(query, best.name || "") < 0.55) return null;
  const payload = best.payload || {};
  const fields: AnimeInfoField[] = [];
  const push = (label: string, value: unknown) => {
    if (value == null || value === "" || /^unknown$/i.test(String(value))) return;
    fields.push({ label: MAL_LABEL_AR[label], value: translateMalValue(label, String(value)) });
  };
  push("Type", payload.media_type);
  push("Status", payload.status);
  push("Aired", payload.aired);
  const score = Number(payload.score);
  return {
    id: best.id,
    url: typeof best.url === "string" ? best.url : `https://myanimelist.net/anime/${best.id}`,
    data: { score: Number.isFinite(score) && score > 0 ? score : null, fields, _complete: false },
  };
}

export function buildAniListFields(a: any): AnimeInfoField[] {
  const fields: AnimeInfoField[] = [];
  const push = (label: string, value: unknown) => {
    if (value == null || value === "" || value === 0) return;
    fields.push({ label, value: String(value) });
  };
  const formats: Record<string, string> = {
    TV: "TV", TV_SHORT: "TV", MOVIE: "Movie", OVA: "OVA", ONA: "ONA", SPECIAL: "Special", MUSIC: "Music",
  };
  const statuses: Record<string, string> = {
    FINISHED: "Finished Airing", RELEASING: "Currently Airing", NOT_YET_RELEASED: "Not yet aired",
  };
  const sources: Record<string, string> = {
    MANGA: "Manga", WEB_MANGA: "Web manga", LIGHT_NOVEL: "Light novel", NOVEL: "Novel",
    VISUAL_NOVEL: "Visual novel", ORIGINAL: "Original", VIDEO_GAME: "Game", OTHER: "Other",
  };
  if (a?.format) push("النوع", TYPE_AR[formats[a.format] || a.format] || a.format);
  if (a?.status) push("الحالة", STATUS_AR[statuses[a.status] || a.status] || a.status);
  push("عدد الحلقات", a?.episodes);
  if (a?.season) {
    const season = String(a.season).toLowerCase();
    push("الموسم", `${SEASON_AR[season] || a.season} ${a.seasonYear || ""}`.trim());
  } else if (a?.seasonYear) push("سنة العرض", a.seasonYear);
  if (a?.source) {
    const source = sources[a.source] || String(a.source).toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
    push("المصدر", SOURCE_AR[source] || source);
  }
  const studios = (a?.studios?.nodes || []).map((s: any) => s?.name).filter(Boolean);
  if (studios.length) push("الاستوديو", studios.join("، "));
  if (a?.duration) push("مدة الحلقة", `${a.duration} min.`);
  return fields;
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
async function jikanGet(url: string, maxAttempts = 3): Promise<any | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 429 || res.status >= 500) {
        if (attempt < maxAttempts - 1) await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
        continue;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      if (attempt < maxAttempts - 1) await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
    }
  }
  return null;
}

const MAL_FALLBACK_QUERY = `query ($search: String) {
  Page(perPage: 8) { media(search: $search, type: ANIME) {
    id idMal title { romaji english native } synonyms format status episodes
    duration season seasonYear source studios { nodes { name } }
  } }
}`;

async function fetchText(url: string, timeoutMs = 12000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36" },
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchMalPage(url: string): Promise<MalData | null> {
  const html = await fetchText(url);
  if (!html || !/itemprop=["']ratingValue|<h2>Information<\/h2>|js-detail-information/i.test(html)) return null;
  const data = parseMalHtml(html);
  return data.score != null || data.fields.length ? { ...data, _complete: true } : null;
}

export async function fetchMalPrefix(
  title: string,
  getText: (url: string) => Promise<string | null> = fetchText,
): Promise<MalPrefixResult | null> {
  const cleaned = cleanQuery(title);
  const queries = [cleaned, title.trim()].filter((q, i, all) => q && all.indexOf(q) === i);
  for (const q of queries) {
    const raw = await getText(`https://myanimelist.net/search/prefix.json?type=anime&keyword=${encodeURIComponent(q)}&v=1`);
    if (!raw) continue;
    try {
      const hit = parseMalPrefix(JSON.parse(raw), title);
      if (hit) return hit;
    } catch {}
  }
  return null;
}

export function mergeMalFallback(
  prefix: MalData | null,
  page: MalData | null,
  anilistFields: AnimeInfoField[],
): MalData {
  if (page) {
    return {
      score: page.score ?? prefix?.score ?? null,
      fields: page.fields.length ? page.fields : (anilistFields.length ? anilistFields : prefix?.fields || []),
      _complete: true,
    };
  }
  return {
    score: prefix?.score ?? null,
    fields: anilistFields.length ? anilistFields : prefix?.fields || [],
    _complete: false,
  };
}

async function fetchMalFallback(title: string, full: boolean): Promise<MalData | null> {
  let prefixPartial: MalData | null = null;
  const hit = await fetchMalPrefix(title);
  if (hit) {
    if (!full) return hit.data;
    const page = await fetchMalPage(hit.url);
    if (page) return mergeMalFallback(hit.data, page, []);
    prefixPartial = hit.data;
  }

  for (const q of buildSearchQueries([title], null)) {
    const json = await anilistPost(MAL_FALLBACK_QUERY, { search: q });
    const best = pickBestMedia((json?.data?.Page?.media || []) as AniListMedia[], q) as (AniListMedia & { idMal?: number | null }) | null;
    if (!best) continue;
    const fields = buildAniListFields(best);
    if (typeof best.idMal === "number") {
      const page = await fetchMalPage(`https://myanimelist.net/anime/${best.idMal}`);
      if (page) return mergeMalFallback(prefixPartial, page, fields);
    }
    if (fields.length) return mergeMalFallback(prefixPartial, null, fields);
  }
  return prefixPartial ? mergeMalFallback(prefixPartial, null, []) : null;
}

async function doFetch(title: string, full = false): Promise<MalData> {
  if (!full) {
    const hit = await fetchMalPrefix(title);
    if (hit?.data.score != null) return hit.data;
  }
  // Try the cleaned query first ("Tomodachi Game الموسم الأول" → "Tomodachi
  // Game"); fall back to the raw title for the rare case cleaning empties out.
  const cleaned = cleanQuery(title);
  const attempts = [cleaned, title.trim()].filter((q, i, a) => q && a.indexOf(q) === i);
  for (const q of attempts) {
    const json = await jikanGet(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(q)}&limit=8&sfw`, 1);
    if (!json) continue; // transient failure exhausted its retries — try next query
    const best = pickMalCandidate(json?.data || [], title);
    if (best) {
      return { score: typeof best.score === "number" ? best.score : null, fields: buildFields(best), _complete: true };
    }
  }
  if (!full) return EMPTY;
  return (await fetchMalFallback(title, true)) || EMPTY;
}

/* ── Public API ─────────────────────────────────── */

const mem = new Map<string, MalData>();
const inflight = new Map<string, Promise<MalData>>();

export function shouldReplaceMalCache(current: MalData | undefined, next: MalData): boolean {
  return !current || current._complete === false || next._complete !== false;
}

/** Fetch (and cache) the full MAL payload — score + Arabic fact list. */
export async function fetchAnimeMal(title: string, full = false): Promise<MalData> {
  if (!title || !title.trim()) return EMPTY;
  const key = title.toLowerCase().trim();
  const cached = mem.get(key);
  if (cached && (!full || cached._complete !== false)) return cached;
  const inflightKey = `${key}:${full ? "full" : "score"}`;
  const pending = inflight.get(inflightKey);
  if (pending) return pending;

  const p = (async (): Promise<MalData> => {
    try {
      const raw = await AsyncStorage.getItem(CACHE_PREFIX + key);
      if (raw) {
        const parsed = JSON.parse(raw);
        const stored = parsed.data as MalData | undefined;
        if (stored && Date.now() - parsed.ts < CACHE_TTL && (!full || stored._complete !== false)) {
          const current = mem.get(key);
          if (!shouldReplaceMalCache(current, stored)) return current!;
          mem.set(key, stored);
          return stored;
        }
      }
    } catch {}
    try {
      const data = await schedule(() => doFetch(title, full));
      // Only cache a real hit; an empty result is likely a transient miss and
      // should be free to retry on the next visit.
      if (data.score != null || data.fields.length > 0) {
        if (shouldReplaceMalCache(mem.get(key), data)) {
          mem.set(key, data);
          try {
            await AsyncStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ ts: Date.now(), data }));
          } catch {}
        } else return mem.get(key)!;
      }
      return data;
    } catch {
      return EMPTY;
    } finally {
      inflight.delete(inflightKey);
    }
  })();
  inflight.set(inflightKey, p);
  return p;
}

/** Just the Arabic fact list (Info tab). */
export async function fetchAnimeInfo(title: string): Promise<AnimeInfoField[]> {
  return (await fetchAnimeMal(title, true)).fields;
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
    const best = pickMalCandidate(data, query);
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

const REL_CACHE_PREFIX = "@anime_relations_v7:";

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
    const best = pickMalCandidate(data, title);
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

async function fetchRelationsByQueries(
  variants: string[],
  viewedTitle: string,
): Promise<RelatedAnimeEntry[]> {
  for (const query of variants) {
    const json = await anilistPost(RELATIONS_PAGE_QUERY, { search: query });
    const medias: AniListMedia[] | undefined = json?.data?.Page?.media;
    if (!Array.isArray(medias) || medias.length === 0) continue;
    const best = pickBestMedia(medias, query);
    if (!best) continue;
    const out = await collectFranchise(best, viewedTitle, fetchMediaById);
    if (out.length > 0) return out;
  }
  return [];
}

async function doFetchRelations(title: string, href?: string | null): Promise<RelatedAnimeEntry[]> {
  const slugTitle = slugToTitle(href);

  // Start the Jikan/MAL bridge in parallel, but try AniList's own exact title
  // and source slug immediately. Jikan can be rate-limited or return 5xx for
  // minutes; previously that blocked even exact AniList hits such as
  // "Shiguang Dailiren III", making its known prequel look like no relations.
  const malPromise = getMalMatch(title)
    .catch(() => ({ malId: null as number | null, titles: [] as string[] }));
  const direct = await fetchRelationsByQueries(buildSearchQueries([title], slugTitle), title);
  if (direct.length > 0) return direct;

  // 1) MAL-ID bridge (most reliable). Jikan resolves the title robustly — even
  //    Arabic ones — then AniList is looked up EXACTLY by MAL id, with no fuzzy
  //    AniList title matching that some titles slip through. This is the main
  //    detection improvement; it catches the anime that title search misses.
  const mal = await malPromise;
  if (mal.malId != null) {
    const json = await anilistPost(RELATIONS_BY_MAL_QUERY, { idMal: mal.malId });
    const media = json?.data?.Media as AniListMedia | undefined;
    // Confidence gate: Jikan's pickBest has no title-match floor, so a generically
    // named anime can resolve to a popular-but-unrelated MAL entry — making the
    // ENTIRE related tab a different franchise. The source URL's romaji slug is a
    // trustworthy Latin-side anchor (Arabic scraped titles fold to empty in the
    // scorer), so when we have one, require the bridged media to actually match it
    // before trusting the bridge; a mismatch falls through to the already-
    // thresholded title search. No slug → keep the bridge (nothing better to check).
    if (media && (!slugTitle || scoreMedia(media, slugTitle) >= 50)) {
      const out = await collectFranchise(media, title, fetchMediaById);
      if (out.length > 0) return out;
    }
  }

  // 2) Fallback: AniList title search, seeded by the scraped title, the source
  //    slug AND every MAL alt-title (extra romanisations). Candidates are scored
  //    and low-confidence matches rejected so we never show a random anime's
  //    relations; self-exclusion keeps a Season-2 page from listing itself.
  return fetchRelationsByQueries(buildSearchQueries(mal.titles, slugTitle), title);
}

/** Related anime (sequels, prequels, side stories, spin-offs …) for a title.
 * `href` (the source URL) sharpens title detection via its romaji slug.
 * Resolved via AniList and cached for a week. Empty array on any miss. */
export async function fetchAnimeRelations(title: string, href?: string | null): Promise<RelatedAnimeEntry[]> {
  if (!title || !title.trim()) return [];
  const slug = slugToTitle(href).toLowerCase();
  const key = `${title.toLowerCase().trim()}|${slug}`;
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

/* ── Release year + movie/series format (AniList) ──
 * Powers the anime3rb old-vs-new disambiguation: franchises that have BOTH an
 * old film and a new TV remake share one base name ("Koukaku Kidoutai" 1995
 * vs "Koukaku Kidoutai (TV)" 2026), so title matching alone locks onto the
 * wrong entry — the release year / format is the only reliable discriminator.
 * Resolved via AniList (keyless), cached for a week. A null result simply
 * disables the check: the caller falls back to title-only matching. */
export type AnimeYearType = { year: number | null; isMovie: boolean | null };

const YT_CACHE_PREFIX = "@anime_yt_v1:";
const ytMem = new Map<string, AnimeYearType>();
const YEAR_TYPE_QUERY = `query ($s: String) { Page(perPage: 5) { media(search: $s, type: ANIME) { title { romaji english } seasonYear format } } }`;

export async function getAnimeYearType(title: string): Promise<AnimeYearType> {
  const none: AnimeYearType = { year: null, isMovie: null };
  const q = (title || "").trim();
  // AniList's search is Latin-only — an Arabic title can't resolve, so skip
  // the network entirely and let the caller run its title-only fallback.
  if (!q || !/[a-z]/i.test(q)) return none;
  const key = q.toLowerCase();
  const hit = ytMem.get(key);
  if (hit) return hit;
  try {
    const raw = await AsyncStorage.getItem(YT_CACHE_PREFIX + key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Date.now() - parsed.ts < CACHE_TTL) {
        ytMem.set(key, parsed.data);
        return parsed.data as AnimeYearType;
      }
    }
  } catch {}
  try {
    const json = await anilistPost(YEAR_TYPE_QUERY, { s: q });
    const medias: any[] = json?.data?.Page?.media || [];
    let best: { score: number; year: number | null; isMovie: boolean | null } | null = null;
    for (const m of medias) {
      const romaji = m?.title?.romaji || "";
      const english = m?.title?.english || "";
      const sc = Math.max(fuzzyScore(q, romaji), english ? fuzzyScore(q, english) : 0);
      if (!best || sc > best.score) {
        best = {
          score: sc,
          year: typeof m?.seasonYear === "number" ? m.seasonYear : null,
          isMovie: m?.format == null ? null : m.format === "MOVIE",
        };
      }
    }
    // A weak best match means AniList resolved to a different anime entirely —
    // treat as unknown rather than disambiguate against the wrong year.
    const out: AnimeYearType = best && best.score >= 0.55 ? { year: best.year, isMovie: best.isMovie } : none;
    ytMem.set(key, out);
    // Only persist real hits — a miss is likely transient (rate-limit, offline)
    // and shouldn't be frozen for the whole week.
    if (out.year != null || out.isMovie != null) {
      try { await AsyncStorage.setItem(YT_CACHE_PREFIX + key, JSON.stringify({ ts: Date.now(), data: out })); } catch {}
    }
    return out;
  } catch {
    return none;
  }
}

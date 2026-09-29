// Next-episode countdown for the anime detail page.
//
// The streaming sources expose no exact future air times, so the countdown uses
// AniList's nextAiringEpisode — the only source with a real timestamp. The
// weekly schedule screen (witanime) lists days but no times, so it can't back
// a countdown.
//
// One POST per title, deduped in-flight and cached. Because the payload is an
// absolute `airingAt` timestamp (not a relative "X seconds left"), a slightly
// stale cache is still correct — the countdown is always recomputed from the
// timestamp on the device clock. We still cap the cache at 6h so that once an
// episode airs the next one rolls in promptly. A null result (anime finished or
// not on the timetable) is cached briefly so finished series don't re-hit the network
// on every visit.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { getAltTitles } from "./animeInfo";

export interface NextAiring {
  /** Episode number that is about to air. */
  episode: number;
  /** Unix timestamp (seconds) when it airs. */
  airingAt: number;
}

// v2 drops outage-era null entries written while AniList was disabled.
const CACHE_PREFIX = "@anime_airing_v2:";
const HIT_TTL = 6 * 60 * 60 * 1000;  // 6h for "currently airing" hits
const MISS_TTL = 24 * 60 * 60 * 1000; // 24h for "no upcoming episode" misses

const ANILIST_URL = "https://graphql.anilist.co";
// Pull a *page* of candidates (not just AniList's single top hit) with every
// name they're known by. A plain `Media(search)` often locks onto a finished
// season/movie and reports "no upcoming episode" even when another season of
// the same show is actively airing — fetching several entries lets us pick the
// best title match that is genuinely releasing.
const QUERY = `query ($search: String) {
  Page(perPage: 10) {
    media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
      title { romaji english native }
      synonyms
      status
      episodes
      nextAiringEpisode { airingAt episode }
    }
  }
}`;

type Cached = { ts: number; data: NextAiring | null };

const mem = new Map<string, NextAiring | null>();
const inflight = new Map<string, Promise<NextAiring | null>>();

function norm(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Strip season / part / arc qualifiers so a noisy scraped title collapses to
// the base franchise name AniList indexes under. The source sites tack on lots
// of extra context the API never sees, e.g.
//   "Youkoso Jitsuryoku Shijou Shugi no Kyoushitsu e 4th Season : 2-nensei-hen 1 gakki"
//   → "youkoso jitsuryoku shijou shugi no kyoushitsu e"
// Searching the bare franchise name returns every season (one of which is the
// airing one we're after), whereas the full noisy string returns junk or
// nothing.
function baseTitle(title: string): string {
  let s = (title || "").toLowerCase();
  // Drop an arc subtitle after a colon ("… : 2-nensei-hen 1 gakki").
  s = s.split(/[:：]/)[0];
  // Cut from the first season/part/cour marker onward.
  s = s.replace(/\b\d+(st|nd|rd|th)\s+season\b.*$/i, "");
  s = s.replace(/\bseason\s*\d+\b.*$/i, "");
  s = s.replace(/\b(the\s+)?final\s+season\b.*$/i, "");
  s = s.replace(/\bpart\s*\d+\b.*$/i, "");
  s = s.replace(/\bcour\s*\d+\b.*$/i, "");
  s = s.replace(/\b\d+(st|nd|rd|th)\b.*$/i, ""); // bare ordinal: "4th …"
  s = s.replace(/[-–]?hen\b.*$/i, "");           // "-hen" arc marker
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

// How well a candidate's various titles match any of the query forms (the full
// scraped title and its stripped base). Exact (normalized) match scores
// highest; a candidate whose title STARTS WITH the query is a real same-series
// match ("… 4th Season"); a mere containment ("Boruto: Naruto Next
// Generations" for query "naruto") is too weak to trust with a countdown.
export function titleScore(c: any, queries: string[]): number {
  const titles: string[] = [
    c?.title?.romaji,
    c?.title?.english,
    c?.title?.native,
    ...(Array.isArray(c?.synonyms) ? c.synonyms : []),
  ].filter(Boolean).map(norm).filter(Boolean);
  let score = 0;
  for (const q of queries) {
    if (!q) continue;
    for (const nt of titles) {
      if (nt === q) score = Math.max(score, 1000);
      else if (nt.startsWith(q)) score = Math.max(score, 500);
      else if (nt.includes(q)) score = Math.max(score, 300);
    }
  }
  return score;
}

function validAiring(n: any): NextAiring | null {
  if (!n || typeof n.airingAt !== "number" || typeof n.episode !== "number") return null;
  // Guard against a stale "next" episode whose airing time has already passed.
  if (n.airingAt * 1000 <= Date.now()) return null;
  return { episode: n.episode, airingAt: n.airingAt };
}

async function searchCandidates(search: string): Promise<any[]> {
  const res = await fetch(ANILIST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query: QUERY, variables: { search: search.trim() } }),
  });
  if (!res.ok) return [];
  const json = await res.json();
  return json?.data?.Page?.media || [];
}

// From a candidate pool, return the airing episode of the best title match.
// ONLY exact/prefix matches are trusted: falling back to AniList's raw ordering
// (or to weak containment matches) is how a finished "Naruto" page ended up
// showing "Boruto" episode numbers. No trustworthy match = no countdown.
export function pickAiring(candidates: any[], queries: string[]): NextAiring | null {
  if (candidates.length === 0) return null;
  const ranked = candidates
    .map((c) => ({ c, s: titleScore(c, queries) }))
    .filter((x) => x.s >= 500)
    .sort((a, b) => b.s - a.s);
  for (const x of ranked) {
    const n = validAiring(x.c.nextAiringEpisode);
    if (n) return n;
  }
  return null;
}

function rankedCandidates(candidates: any[], queries: string[]): any[] {
  return candidates
    .map((c) => ({ c, s: titleScore(c, queries) }))
    .filter((x) => x.s >= 500)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.c);
}

function pickFinished(candidates: any[], queries: string[], lastKnownEp?: number | null): boolean | null {
  for (const c of rankedCandidates(candidates, queries)) {
    if (validAiring(c.nextAiringEpisode) || c.status === "RELEASING") return false;
    if (c.status === "FINISHED") {
      const total = typeof c.episodes === "number" ? c.episodes : null;
      if (total && lastKnownEp && lastKnownEp < total) return false;
      return true;
    }
  }
  return null;
}

async function doFetch(title: string): Promise<NextAiring | null> {
  // The weekly schedule carries no air times, so it can't back a countdown —
  // AniList is the only source with a real nextAiringEpisode timestamp.
  return doFetchAniList(title);
}

async function doFetchAniList(title: string): Promise<NextAiring | null> {
  const base = baseTitle(title);
  const queries = new Set([norm(title), norm(base)].filter(Boolean));

  // First try the title as-is (precise when it already matches AniList).
  let pick = pickAiring(await searchCandidates(title), [...queries]);
  if (pick) return pick;

  // Fall back to the stripped franchise name, which surfaces the airing season
  // for titles weighed down by arc/part suffixes the API doesn't recognize.
  if (base && base !== title.trim().toLowerCase()) {
    pick = pickAiring(await searchCandidates(base), [...queries]);
    if (pick) return pick;
  }

  // Last resort: resolve cross-language names via Jikan (romaji / English /
  // Japanese / synonyms) and search AniList with each. Catches titles whose
  // romanization on the source site differs from AniList's spelling — the same
  // bridge the search screen uses. Each alt also feeds the match queries so the
  // airing candidate is recognised. Bounded to a few tries; results are cached.
  try {
    const alts = await getAltTitles(base || title);
    for (const alt of alts.slice(0, 4)) {
      const altBase = baseTitle(alt);
      [norm(alt), norm(altBase)].filter(Boolean).forEach((q) => queries.add(q));
      pick = pickAiring(await searchCandidates(altBase || alt), [...queries]);
      if (pick) return pick;
    }
  } catch {}
  return null;
}

async function doFetchFinished(title: string, lastKnownEp?: number | null): Promise<boolean> {
  const base = baseTitle(title);
  const queries = new Set([norm(title), norm(base)].filter(Boolean));

  let pick = pickFinished(await searchCandidates(title), [...queries], lastKnownEp);
  if (pick != null) return pick;

  if (base && base !== title.trim().toLowerCase()) {
    pick = pickFinished(await searchCandidates(base), [...queries], lastKnownEp);
    if (pick != null) return pick;
  }

  try {
    const alts = await getAltTitles(base || title);
    for (const alt of alts.slice(0, 4)) {
      const altBase = baseTitle(alt);
      [norm(alt), norm(altBase)].filter(Boolean).forEach((q) => queries.add(q));
      pick = pickFinished(await searchCandidates(altBase || alt), [...queries], lastKnownEp);
      if (pick != null) return pick;
    }
  } catch {}
  return false;
}

/**
 * Resolve the next airing episode for `title`, or null when the anime isn't
 * currently airing (finished, between seasons, or not on the timetable). Cached in
 * memory + on disk so re-opening a page never re-hits the network.
 */
export async function fetchNextAiring(title: string): Promise<NextAiring | null> {
  if (!title || !title.trim()) return null;
  const key = title.toLowerCase().trim();
  if (mem.has(key)) {
    const hit = mem.get(key);
    // A memoized result whose airing time has passed is stale — the next
    // episode must be resolved instead of showing the just-aired one forever.
    if (!hit || hit.airingAt * 1000 > Date.now()) return hit!;
    mem.delete(key);
  }
  const pending = inflight.get(key);
  if (pending) return pending;

  const p = (async (): Promise<NextAiring | null> => {
    try {
      const raw = await AsyncStorage.getItem(CACHE_PREFIX + key);
      if (raw) {
        const parsed: Cached = JSON.parse(raw);
        const ttl = parsed.data ? HIT_TTL : MISS_TTL;
        // A cached hit is only valid while its airing time is still in the future.
        const stillFuture = !parsed.data || parsed.data.airingAt * 1000 > Date.now();
        if (Date.now() - parsed.ts < ttl && stillFuture) {
          mem.set(key, parsed.data);
          return parsed.data;
        }
      }
    } catch {}
    try {
      const data = await doFetch(title);
      mem.set(key, data);
      try {
        await AsyncStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ ts: Date.now(), data } as Cached));
      } catch {}
      return data;
    } catch {
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/** True only when AniList explicitly says the matching series is finished. */
export async function fetchSeriesFinished(title: string, lastKnownEp?: number | null): Promise<boolean> {
  if (!title || !title.trim()) return false;
  try { return await doFetchFinished(title, lastKnownEp); }
  catch { return false; }
}

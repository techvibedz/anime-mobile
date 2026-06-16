// Next-episode countdown for the anime detail page.
//
// witanime's scrape tells us nothing about *when* the next episode airs, and
// Jikan (MyAnimeList) only exposes a fuzzy "broadcast: Sundays at 17:00 (JST)"
// string — no concrete timestamp to count down to. AniList's GraphQL API, on the
// other hand, hands back `nextAiringEpisode { airingAt, episode }` as an exact
// unix timestamp, which is all we need to render a live ticking countdown.
//
// One POST per title, deduped in-flight and cached. Because the payload is an
// absolute `airingAt` timestamp (not a relative "X seconds left"), a slightly
// stale cache is still correct — the countdown is always recomputed from the
// timestamp on the device clock. We still cap the cache at 6h so that once an
// episode airs the next one rolls in promptly. A null result (anime finished or
// not on AniList) is cached briefly so finished series don't re-hit the network
// on every visit.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { getAltTitles } from "./animeInfo";

export interface NextAiring {
  /** Episode number that is about to air. */
  episode: number;
  /** Unix timestamp (seconds) when it airs. */
  airingAt: number;
}

const CACHE_PREFIX = "@anime_airing_v1:";
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
// highest; a containment match (one is a substring of the other) scores partial.
function titleScore(c: any, queries: string[]): number {
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
      else if (nt.includes(q) || q.includes(nt)) score = Math.max(score, 500);
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

// From a candidate pool, return the airing episode of the best title match,
// preferring well-matching entries but falling back to AniList's own ordering
// when nothing matches cleanly (e.g. a romaji-vs-Arabic title mismatch).
function pickAiring(candidates: any[], queries: string[]): NextAiring | null {
  if (candidates.length === 0) return null;
  const ranked = candidates
    .map((c) => ({ c, s: titleScore(c, queries) }))
    .sort((a, b) => b.s - a.s);
  const good = ranked.filter((x) => x.s >= 500);
  const pool = (good.length ? good : ranked).map((x) => x.c);
  for (const c of pool) {
    const n = validAiring(c.nextAiringEpisode);
    if (n) return n;
  }
  return null;
}

async function doFetch(title: string): Promise<NextAiring | null> {
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

/**
 * Resolve the next airing episode for `title`, or null when the anime isn't
 * currently airing (finished, between seasons, or not on AniList). Cached in
 * memory + on disk so re-opening a page never re-hits the network.
 */
export async function fetchNextAiring(title: string): Promise<NextAiring | null> {
  if (!title || !title.trim()) return null;
  const key = title.toLowerCase().trim();
  if (mem.has(key)) return mem.get(key)!;
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

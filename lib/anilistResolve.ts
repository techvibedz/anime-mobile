// Resolve an AniList-sourced entry (Related tab, For You rail) to a playable
// source URL — witanime / anime4up / anime3rb — through the same cross-source
// search the search screen uses, with hard season/format guardrails.
//
// Matching design (a card must NEVER open a different anime):
//   • A source result that carries one of the entry's OWN names (canon-aware
//     titles, incl. slug-derived names) opens immediately — that streamed fast
//     path keeps the common case instant.
//   • Everything weaker is CROSS-VERIFIED against AniList before opening: the
//     candidate's name is resolved to an AniList id, which must equal the
//     card's id. A different id means a different show — rejected silently.
//     Unresolvable names (Arabic-only) fall back to a near-exact-title gate.
//   • Token-overlap-only guesses (score ≤64) can never open a page; the floor
//     is 70 (containment/prefix/exact tiers).
//
// Speed design:
//   • No Jikan on the critical path — wave 1 searches only the names AniList
//     already gave us; MAL alt-titles load in wave 2, only after a wave-1 miss.
//   • Query waves are capped (lib/relations aniListLookupWaves).
//   • Resolved hrefs are cached per AniList id for 10 days; in-flight dedupe
//     shares ONE search between a background warm-up and a tap.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { searchAnime, type SearchResult } from "./api";
import { getAltTitles, fetchAniListIdForTitle } from "./animeInfo";
import {
  aniListLookupTitles,
  aniListLookupWaves,
  canonTitle,
  formatCat,
  relatedSeasonNum,
  scoreEntryAgainstNames,
  seasonNum,
  sourceCandidateNames,
  type AniListLookupEntry,
} from "./relations";

/** Structural shape resolution needs — RelatedAnimeEntry and RankedRec fit. */
export interface AniListResolveEntry extends AniListLookupEntry {
  anilistId: number;
  format?: string | null;
  /** Poster art (used by the card UI, not by resolution). */
  image?: string | null;
}

// Minimum title-match confidence before a candidate may open a source page.
// The token-overlap tier maxes out at 64, so 70 admits only containment,
// prefix and exact matches — overlap-only guesses are gone.
const MIN_TITLE_SCORE = 70;
// Near-exact tier: may open unverified when AniList can't resolve the name.
const STRONG_TITLE_SCORE = 82;

/* ── Resolved-href cache (per AniList id) ── */

// v2: pre-verification caches may point at the WRONG anime — never reuse them.
const CACHE_PREFIX = "@anilist_resolved_v2:";
const CACHE_TTL = 10 * 24 * 60 * 60 * 1000; // 10 days
const cacheMem = new Map<number, string>();

/** Cached source href for an entry, or null. Memory-first, then disk. */
export async function peekResolvedHref(anilistId: number): Promise<string | null> {
  const hit = cacheMem.get(anilistId);
  if (hit) return hit;
  try {
    const raw = await AsyncStorage.getItem(CACHE_PREFIX + anilistId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { href?: string; ts?: number };
    if (parsed?.href && typeof parsed.ts === "number" && Date.now() - parsed.ts < CACHE_TTL) {
      cacheMem.set(anilistId, parsed.href);
      return parsed.href;
    }
  } catch {}
  return null;
}

function rememberResolvedHref(anilistId: number, href: string) {
  cacheMem.set(anilistId, href);
  AsyncStorage.setItem(CACHE_PREFIX + anilistId, JSON.stringify({ href, ts: Date.now() })).catch(() => {});
}

/* ── Resolution ── */

const inflight = new Map<number, Promise<string | null>>();

/** Resolve an entry to a source URL. Cache-first, deduped, never throws. */
export function resolveEntryToSource(entry: AniListResolveEntry): Promise<string | null> {
  const existing = inflight.get(entry.anilistId);
  if (existing) return existing;
  const p = (async () => {
    const cached = await peekResolvedHref(entry.anilistId);
    if (cached) return cached;
    const href = await doResolve(entry);
    if (href) rememberResolvedHref(entry.anilistId, href);
    return href;
  })().finally(() => inflight.delete(entry.anilistId));
  inflight.set(entry.anilistId, p);
  return p;
}

type Candidate = {
  href: string;
  /** Candidate-side name that scored best (title or slug). */
  matchName: string;
  titleScore: number;
  /** titleScore with the format bias applied (pick-the-best ordering). */
  sc: number;
  canonKnown: boolean;
};

// Score a result against the card: title similarity (season-aware, either
// language, title or slug) that MUST clear MIN_TITLE_SCORE, biased hard by
// format so a 1-episode OVA card doesn't resolve to the 12-episode series.
function evaluateCandidate(
  r: SearchResult,
  entry: AniListLookupEntry,
  entryCanons: Set<string>,
  wantFmt: string | null,
): Candidate | null {
  const { score: titleScore, matchName } = scoreEntryAgainstNames(entry, sourceCandidateNames(r));
  if (titleScore < MIN_TITLE_SCORE) return null; // too weak — skip
  const titles = aniListLookupTitles(entry);
  const wantedSeason = Math.max(...titles.map((title) => seasonNum(title)), 0);
  if (wantedSeason > 1) {
    const gotSeason = relatedSeasonNum(matchName, wantedSeason);
    // Never open the unnumbered/base page for an explicit later-season card.
    if (gotSeason !== wantedSeason) return null;
  }
  let sc = titleScore;
  let fmtOk = true;
  if (wantFmt) {
    const gotFmt = formatCat(r.type) || formatCat(r.title);
    if (gotFmt) { sc += gotFmt === wantFmt ? 45 : -45; fmtOk = gotFmt === wantFmt; }
    else { if (wantFmt !== "tv") sc -= 15; fmtOk = wantFmt === "tv"; } // unmarked ⇒ series
  }
  return {
    href: r.href,
    matchName,
    titleScore,
    sc,
    canonKnown: entryCanons.has(canonTitle(matchName)),
  };
}

const isWitanimeHref = (href: string) => /witanime\./i.test(href);

/** Choose the candidate to open from the collected pool, or null.
 *  Order: a name that IS one of the entry's own names (zero risk) → higher
 *  title score → witanime first (fastest detail path) → format-adjusted score.
 *  Non-exact candidates are cross-verified against AniList (bounded lookups):
 *  same id opens, a different id is a different show and never opens. */
async function selectHit(
  entry: AniListResolveEntry,
  wantFmt: string | null,
  pool: readonly SearchResult[],
  entryCanons: Set<string>,
): Promise<string | null> {
  const candidates: Candidate[] = [];
  for (const r of pool) {
    const c = evaluateCandidate(r, entry, entryCanons, wantFmt);
    if (c) candidates.push(c);
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) =>
    Number(b.canonKnown) - Number(a.canonKnown) ||
    b.titleScore - a.titleScore ||
    Number(isWitanimeHref(b.href)) - Number(isWitanimeHref(a.href)) ||
    b.sc - a.sc,
  );
  const exact = candidates.find((c) => c.canonKnown);
  if (exact) return exact.href;
  for (const c of candidates.slice(0, 5)) {
    const id = await fetchAniListIdForTitle(c.matchName).catch(() => null);
    if (id == null) {
      // AniList couldn't resolve the name (Arabic-only / decorated) — trust a
      // near-exact title, reject anything looser.
      if (c.titleScore >= STRONG_TITLE_SCORE) return c.href;
      continue;
    }
    if (id === entry.anilistId) return c.href;
  }
  return null;
}

async function doResolve(entry: AniListResolveEntry): Promise<string | null> {
  const wantFmt = formatCat(entry.format);
  const canonsOf = (e: AniListLookupEntry) => new Set(aniListLookupTitles(e).map((t) => canonTitle(t)));
  const pool: SearchResult[] = [];
  const seenHrefs = new Set<string>();
  let hit: string | null = null;

  const consider = (results: SearchResult[], lookupEntry: AniListLookupEntry, canons: Set<string>) => {
    if (hit) return;
    for (const r of results) {
      if (r?.href && !seenHrefs.has(r.href)) { seenHrefs.add(r.href); pool.push(r); }
    }
    // The one safe streaming decision: a result carrying one of the entry's
    // OWN names can open immediately. Everything weaker waits for the wave to
    // finish and gets AniList-verified by selectHit.
    for (const r of pool) {
      if (evaluateCandidate(r, lookupEntry, canons, wantFmt)?.canonKnown) { hit = r.href; return; }
    }
  };

  // Search queries in parallel and navigate the INSTANT a streamed partial
  // yields an own-name match. `hit` doubles as the abort flag: still-running
  // search jobs just get their late partials ignored.
  const searchWave = async (queries: string[], lookupEntry: AniListLookupEntry, canons: Set<string>) => {
    await Promise.all(queries.map((q) =>
      searchAnime(q, (results) => consider(results, lookupEntry, canons))
        .then((res) => consider(res.data.results, lookupEntry, canons))
        .catch(() => {}),
    ));
  };

  // Wave 1 — names AniList already gave us (no Jikan wait).
  const primaryCanons = canonsOf(entry);
  const prime = aniListLookupWaves(entry, []);
  await searchWave(prime.primary, entry, primaryCanons);
  if (hit) return hit;
  hit = await selectHit(entry, wantFmt, pool, primaryCanons);
  if (hit) return hit;

  // Wave 2 — MAL alt-titles, paid only on a wave-1 miss (Jikan is
  // rate-limited; it must never delay the common case).
  const altTitles = (
    await Promise.all(
      [entry.title, entry.titleEnglish]
        .filter((q): q is string => !!q && q.trim().length > 0)
        .map((q) => getAltTitles(q).catch(() => [])),
    )
  ).flat();
  const enriched: AniListResolveEntry = { ...entry, lookupTitles: altTitles };
  const enrichedCanons = canonsOf(enriched);
  const alternate = aniListLookupWaves(entry, altTitles).alternate;
  if (alternate.length > 0) {
    await searchWave(alternate, enriched, enrichedCanons);
    if (hit) return hit;
  }
  return selectHit(enriched, wantFmt, pool, enrichedCanons);
}

// Per-anime "completion" state — the data behind the anime-card badges and the
// profile's "completed anime" stat. Synced to Supabase so it's tied to the user
// account and shared across devices (mobile ↔ desktop).
//
// An anime is considered:
//   • caught up — the user has watched the LAST episode currently available in
//     the app (the highest episode number across all sources).
//   • finished  — caught up AND the series is no longer airing (its finale is
//     out), i.e. the user has watched the actual final episode.
//
// A record carries EVERY known source href + title for the anime (witanime /
// anime4up / anime3rb), so a poster card from ANY source rail can resolve the
// badge regardless of which source URL it was opened/recorded under.

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { normAnimeKey, animeTitleKey, getCompletedSets, type CompletedSets } from "./history";
import { supabase, isSupabaseConfigured, getSessionUser } from "./supabase";

const KEY = "anime_completion_v2";

export interface AnimeCompletion {
  key: string;
  hrefs: string[];
  titles: string[];
  /** Highest episode number that was available when this was recorded. */
  lastEpNum: number;
  /** Watched the last available episode. */
  caughtUp: boolean;
  /** Caught up AND the series has finished airing (watched the real finale). */
  finished: boolean;
  updatedAt: number;
}

function uniq(arr: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of arr) {
    const s = (v || "").trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

export async function getCompletionMap(): Promise<Record<string, AnimeCompletion>> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function saveCompletionMap(map: Record<string, AnimeCompletion>) {
  try { await AsyncStorage.setItem(KEY, JSON.stringify(map)); } catch {}
}

// Lightweight change notifier so the provider re-loads after a record()/pull.
const listeners = new Set<() => void>();
function notify() {
  for (const l of listeners) {
    try { l(); } catch {}
  }
}

/** Push one record to Supabase (fire-and-forget; logs on failure). */
async function pushToCloud(rec: AnimeCompletion) {
  if (!isSupabaseConfigured) return;
  const user = await getSessionUser();
  if (!user) return;
  const { error } = await supabase.from("anime_completion").upsert({
    user_id: user.id,
    anime_key: rec.key,
    hrefs: rec.hrefs,
    titles: rec.titles,
    last_ep_num: rec.lastEpNum,
    caught_up: rec.caughtUp,
    finished: rec.finished,
    updated_at: new Date(rec.updatedAt).toISOString(),
  }, { onConflict: "user_id,anime_key" });
  if (error) console.warn("[completion] cloud sync failed:", error.message);
}

/**
 * Upsert the completion record for an anime. Keyed by the normalized primary
 * href (falling back to the title). All passed hrefs/titles are merged into the
 * record (union with any already stored) so cross-source cards keep matching.
 * Skipped when nothing meaningful changed so we don't churn storage / re-render.
 */
export async function recordAnimeCompletion(rec: {
  hrefs: (string | null | undefined)[];
  titles: (string | null | undefined)[];
  lastEpNum: number;
  caughtUp: boolean;
  finished: boolean;
}): Promise<void> {
  const hrefs = uniq(rec.hrefs);
  const titles = uniq(rec.titles);
  // ponytail: TLD-stable key. Records written under the old full-URL scheme keep
  // resolving via buildLookup (it re-indexes hrefs by normAnimeKey), so badges
  // still show; a stale old-key record may briefly co-exist until it's re-written.
  const key = normAnimeKey(hrefs[0]) || animeTitleKey(titles[0]);
  if (!key) return;
  const map = await getCompletionMap();
  const prev = map[key];
  const next: AnimeCompletion = {
    key,
    hrefs: uniq([...(prev?.hrefs || []), ...hrefs]),
    titles: uniq([...(prev?.titles || []), ...titles]),
    lastEpNum: Math.max(rec.lastEpNum || 0, prev?.lastEpNum || 0),
    caughtUp: rec.caughtUp,
    finished: rec.finished,
    updatedAt: Date.now(),
  };
  if (
    prev &&
    prev.caughtUp === next.caughtUp &&
    prev.finished === next.finished &&
    prev.lastEpNum === next.lastEpNum &&
    prev.hrefs.length === next.hrefs.length &&
    prev.titles.length === next.titles.length
  ) {
    return;
  }
  map[key] = next;
  await saveCompletionMap(map);
  notify();
  pushToCloud(next).catch(() => {});
}

/** Hydrate the local cache from Supabase (called after sign-in). */
export async function pullCompletionFromCloud(): Promise<void> {
  if (!isSupabaseConfigured) return;
  const user = await getSessionUser();
  if (!user) return;
  const { data, error } = await supabase.from("anime_completion")
    .select("*")
    .eq("user_id", user.id);
  if (error) { console.warn("[completion] pull failed:", error.message); return; }
  if (!data) return;
  const map = await getCompletionMap();
  for (const row of data as any[]) {
    const cloud: AnimeCompletion = {
      key: row.anime_key,
      hrefs: Array.isArray(row.hrefs) ? row.hrefs : [],
      titles: Array.isArray(row.titles) ? row.titles : [],
      lastEpNum: row.last_ep_num || 0,
      caughtUp: !!row.caught_up,
      finished: !!row.finished,
      updatedAt: new Date(row.updated_at).getTime(),
    };
    const local = map[cloud.key];
    // Newest write wins, but keep the union of known hrefs/titles either way.
    if (!local || cloud.updatedAt >= local.updatedAt) {
      map[cloud.key] = {
        ...cloud,
        hrefs: uniq([...(local?.hrefs || []), ...cloud.hrefs]),
        titles: uniq([...(local?.titles || []), ...cloud.titles]),
      };
    } else {
      map[cloud.key] = {
        ...local,
        hrefs: uniq([...local.hrefs, ...cloud.hrefs]),
        titles: uniq([...local.titles, ...cloud.titles]),
      };
    }
  }
  await saveCompletionMap(map);
  notify();
}

/** Count of anime whose final episode the user has watched (profile stat). */
export async function countCompletedAnime(): Promise<number> {
  const map = await getCompletionMap();
  return Object.values(map).filter((r) => r.finished).length;
}

/**
 * Reconcile tracked completion records against a freshly-fetched list of
 * recently-updated episodes (the home feed). Completion is otherwise only
 * recomputed on the detail page, so a "caught up" / "finished" badge goes stale
 * the moment a new episode drops — it keeps claiming the user is up to date
 * until they reopen that anime. Here we catch the new episode at the source.
 *
 * For each tracked anime that the feed shows a HIGHER episode number for than we
 * recorded, we bump `lastEpNum` and recompute `caughtUp` from the watch history
 * (did the user already watch that newest episode?). `finished` drops to false:
 * a series appearing in the "recently updated" feed with a new episode isn't
 * actually over — the detail page re-establishes `finished` via AniList on the
 * next visit. We never UPGRADE a badge here (that needs the detail page's full
 * episode list); we only clear one that a new episode has invalidated.
 */
export async function reconcileCompletionFromEpisodes(
  items: { animeHref?: string | null; animeTitle?: string | null; epNum: number | null }[],
): Promise<void> {
  if (!items || items.length === 0) return;
  const map = await getCompletionMap();
  if (Object.keys(map).length === 0) return;
  const lookup = buildLookup(map);

  // Highest episode number now available per matched record (by record key).
  const newestByKey = new Map<string, number>();
  for (const it of items) {
    if (it.epNum == null || it.epNum <= 0) continue;
    const rec = lookup.get({ hrefs: [it.animeHref], titles: [it.animeTitle] });
    if (!rec) continue;
    const cur = newestByKey.get(rec.key) || 0;
    if (it.epNum > cur) newestByKey.set(rec.key, it.epNum);
  }
  if (newestByKey.size === 0) return;

  let changed = false;
  let sets: CompletedSets | null = null; // history loaded lazily, only if needed
  for (const [key, newest] of newestByKey) {
    const rec = map[key];
    if (!rec || newest <= rec.lastEpNum) continue; // nothing newer than recorded

    if (!sets) sets = await getCompletedSets();
    let watchedNewest = false;
    for (const tt of rec.titles) {
      const nums = sets.numbersByTitle.get(animeTitleKey(tt));
      if (nums && nums.has(newest)) { watchedNewest = true; break; }
    }

    if (rec.lastEpNum === newest && rec.caughtUp === watchedNewest && !rec.finished) continue;
    map[key] = {
      ...rec,
      lastEpNum: newest,
      caughtUp: watchedNewest,
      finished: false,
      updatedAt: Date.now(),
    };
    changed = true;
    pushToCloud(map[key]).catch(() => {});
  }

  if (changed) {
    await saveCompletionMap(map);
    notify();
  }
}

/**
 * Mark an anime caught-up/finished the instant its LATEST episode is watched —
 * called from the player when an episode crosses the "completed" threshold, so
 * the badge updates without reopening the detail page.
 *
 * Only acts when a completion record already exists (the detail page is what
 * establishes the highest-available episode number, `lastEpNum`) AND the
 * just-watched episode is that latest one. It then re-checks AniList for finale
 * status: `finished` when the series is no longer airing, else `caughtUp`.
 * Never downgrades — a non-final episode (epNum < lastEpNum) is a no-op here;
 * the detail page owns the full recompute.
 */
export async function recordEpisodeWatched(opts: {
  animeHref?: string | null;
  animeTitle?: string | null;
  epNum: number | null;
}): Promise<void> {
  if (opts.epNum == null || opts.epNum <= 0) return;
  const map = await getCompletionMap();
  if (Object.keys(map).length === 0) return;
  const rec = buildLookup(map).get({ hrefs: [opts.animeHref], titles: [opts.animeTitle] });
  if (!rec) return;                       // detail page hasn't tracked this anime yet
  if (opts.epNum < rec.lastEpNum) return; // not the latest available episode
  if (rec.caughtUp && rec.finished) return; // already fully marked

  let finished = false;
  try {
    const { fetchSeriesFinished } = await import("./airing");
    finished = await fetchSeriesFinished(opts.animeTitle || rec.titles[0] || "", rec.lastEpNum || opts.epNum);
  } catch {}

  const next: AnimeCompletion = {
    ...rec,
    lastEpNum: Math.max(rec.lastEpNum, opts.epNum),
    caughtUp: true,
    finished,
    updatedAt: Date.now(),
  };
  if (next.caughtUp === rec.caughtUp && next.finished === rec.finished && next.lastEpNum === rec.lastEpNum) return;
  map[next.key] = next;
  await saveCompletionMap(map);
  notify();
  pushToCloud(next).catch(() => {});
}

/* ── Lookup + context ───────────────────────────────── */

export interface CompletionLookup {
  byHref: Map<string, AnimeCompletion>;
  byTitle: Map<string, AnimeCompletion>;
  /** Resolve a card to its completion record by any of its source hrefs/titles. */
  get(opts: {
    hrefs?: (string | null | undefined)[];
    titles?: (string | null | undefined)[];
  }): AnimeCompletion | null;
}

function buildLookup(map: Record<string, AnimeCompletion>): CompletionLookup {
  const byHref = new Map<string, AnimeCompletion>();
  const byTitle = new Map<string, AnimeCompletion>();
  // Index by the TLD-stable anime key + decoration-folded title so a badge
  // resolves regardless of which rotating witanime TLD (.life/.you) or which
  // source's decorated title a card carries vs. what was recorded.
  for (const rec of Object.values(map)) {
    for (const h of rec.hrefs) byHref.set(normAnimeKey(h), rec);
    for (const tt of rec.titles) byTitle.set(animeTitleKey(tt), rec);
  }
  return {
    byHref,
    byTitle,
    get({ hrefs, titles }) {
      for (const h of hrefs || []) {
        if (h) { const r = byHref.get(normAnimeKey(h)); if (r) return r; }
      }
      for (const tt of titles || []) {
        if (tt) { const r = byTitle.get(animeTitleKey(tt)); if (r) return r; }
      }
      return null;
    },
  };
}

const EMPTY = buildLookup({});
const CompletionContext = createContext<CompletionLookup>(EMPTY);

export function CompletionProvider({ children }: { children: React.ReactNode }) {
  const [lookup, setLookup] = useState<CompletionLookup>(EMPTY);
  const refresh = useCallback(() => {
    getCompletionMap().then((m) => setLookup(buildLookup(m))).catch(() => {});
  }, []);
  useEffect(() => {
    refresh();
    listeners.add(refresh);
    return () => { listeners.delete(refresh); };
  }, [refresh]);
  return <CompletionContext.Provider value={lookup}>{children}</CompletionContext.Provider>;
}

export function useCompletionLookup(): CompletionLookup {
  return useContext(CompletionContext);
}

/** Resolve the completion record for a card by its source hrefs/titles. */
export function useAnimeCompletion(
  hrefs?: (string | null | undefined)[],
  titles?: (string | null | undefined)[],
): AnimeCompletion | null {
  return useCompletionLookup().get({ hrefs, titles });
}

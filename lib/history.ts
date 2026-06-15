import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase, isSupabaseConfigured } from "./supabase";

const KEY = "watch_history";
const MAX_ITEMS = 200;

export interface WatchEntry {
  episodeHref: string;
  episodeTitle: string;
  animeTitle: string;
  animeHref: string;
  image: string;
  positionMs: number;
  durationMs: number;
  updatedAt: number;
  url4up?: string;
  completed?: boolean;
}

/** Treat playback as "watched" once past 85% of duration. */
function autoCompleted(e: WatchEntry): boolean {
  return e.durationMs > 0 && e.positionMs / e.durationMs >= 0.85;
}

/** Push a single history entry to Supabase (fire-and-forget; logs on failure). */
async function pushToCloud(entry: WatchEntry) {
  if (!isSupabaseConfigured) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase.from("watch_history").upsert({
    user_id: user.id,
    episode_href: entry.episodeHref,
    episode_title: entry.episodeTitle,
    anime_title: entry.animeTitle,
    anime_href: entry.animeHref,
    image: entry.image,
    position_ms: entry.positionMs,
    duration_ms: entry.durationMs,
    updated_at: new Date(entry.updatedAt).toISOString(),
    url4up: entry.url4up ?? null,
    completed: entry.completed ?? autoCompleted(entry),
  }, { onConflict: "user_id,episode_href" });
  if (error) console.warn("[history] cloud sync failed:", error.message);
}

async function deleteFromCloud(episodeHref: string) {
  if (!isSupabaseConfigured) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("watch_history").delete()
    .eq("user_id", user.id)
    .eq("episode_href", episodeHref);
}

/** Hydrate local cache from Supabase (called after sign-in). */
export async function pullHistoryFromCloud() {
  if (!isSupabaseConfigured) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { data, error } = await supabase.from("watch_history")
    .select("*")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(MAX_ITEMS);
  if (error) { console.warn("[history] pull failed:", error.message); return; }
  if (!data) return;
  const local: WatchEntry[] = data.map((row: any) => ({
    episodeHref: row.episode_href,
    episodeTitle: row.episode_title,
    animeTitle: row.anime_title,
    animeHref: row.anime_href,
    image: row.image || "",
    positionMs: row.position_ms,
    durationMs: row.duration_ms,
    updatedAt: new Date(row.updated_at).getTime(),
    url4up: row.url4up || undefined,
    completed: !!row.completed,
  }));
  await AsyncStorage.setItem(KEY, JSON.stringify(local));
}

export async function getHistory(): Promise<WatchEntry[]> {
  const raw = await AsyncStorage.getItem(KEY);
  return raw ? JSON.parse(raw) : [];
}

export async function saveProgress(entry: Omit<WatchEntry, "updatedAt">) {
  const list = await getHistory();
  const idx = list.findIndex((e) => e.episodeHref === entry.episodeHref);
  const merged: WatchEntry = {
    ...entry,
    updatedAt: Date.now(),
    // Auto-mark completed when crossing 85% — preserve a manual unmark.
    completed: entry.completed ?? (idx >= 0 ? list[idx].completed : false),
  };
  if (merged.completed !== true && autoCompleted(merged)) merged.completed = true;
  if (idx >= 0) {
    list[idx] = merged;
  } else {
    list.unshift(merged);
    if (list.length > MAX_ITEMS) list.length = MAX_ITEMS;
  }
  list.sort((a, b) => b.updatedAt - a.updatedAt);
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
  pushToCloud(merged).catch(() => {});
}

/**
 * One entry per anime for the "Continue Watching" row — the most recently
 * watched episode of each series, so the user resumes where they stopped
 * instead of seeing every episode they've watched.
 */
export async function getContinueWatching(): Promise<WatchEntry[]> {
  const list = await getHistory();
  // list is already sorted newest-first; keep the first seen per anime.
  const seen = new Set<string>();
  const out: WatchEntry[] = [];
  for (const e of list) {
    const key = e.animeHref || e.animeTitle;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

export async function getProgress(episodeHref: string): Promise<WatchEntry | null> {
  const list = await getHistory();
  return list.find((e) => e.episodeHref === episodeHref) ?? null;
}

export async function removeFromHistory(episodeHref: string) {
  const list = await getHistory();
  await AsyncStorage.setItem(KEY, JSON.stringify(list.filter((e) => e.episodeHref !== episodeHref)));
  deleteFromCloud(episodeHref).catch(() => {});
}

export function formatProgress(entry: WatchEntry): string {
  const pct = entry.durationMs > 0 ? Math.round((entry.positionMs / entry.durationMs) * 100) : 0;
  return `${pct}%`;
}

export function progressPercent(entry: WatchEntry): number {
  return entry.durationMs > 0 ? Math.min(entry.positionMs / entry.durationMs, 1) : 0;
}

/* ── Watched-episode flag (per user) ─────────────────── */

export function isCompleted(entry: WatchEntry | null | undefined): boolean {
  if (!entry) return false;
  if (entry.completed === true) return true;
  return autoCompleted(entry);
}

/**
 * Returns a Set of episode hrefs the user has watched within the given anime.
 * Used by the episode grid on the anime detail page to render "seen" badges.
 */
export async function getWatchedHrefsForAnime(animeHref: string): Promise<Set<string>> {
  const list = await getHistory();
  const set = new Set<string>();
  for (const e of list) {
    if (e.animeHref === animeHref && isCompleted(e)) set.add(e.episodeHref);
  }
  return set;
}

/**
 * Toggle the watched flag on a specific episode. Adds a stub history entry
 * if there isn't one yet (so the marker survives across launches).
 */
export async function toggleWatched(
  episodeHref: string,
  meta: { episodeTitle: string; animeTitle: string; animeHref: string; image?: string; url4up?: string },
): Promise<boolean> {
  const list = await getHistory();
  const idx = list.findIndex((e) => e.episodeHref === episodeHref);
  if (idx >= 0) {
    const cur = list[idx];
    const next: WatchEntry = { ...cur, completed: !isCompleted(cur), updatedAt: Date.now() };
    list[idx] = next;
    await AsyncStorage.setItem(KEY, JSON.stringify(list));
    pushToCloud(next).catch(() => {});
    return next.completed === true;
  }
  // No existing entry — create one marked as watched.
  const newEntry: WatchEntry = {
    episodeHref,
    episodeTitle: meta.episodeTitle,
    animeTitle: meta.animeTitle,
    animeHref: meta.animeHref,
    image: meta.image || "",
    positionMs: 0,
    durationMs: 0,
    url4up: meta.url4up,
    completed: true,
    updatedAt: Date.now(),
  };
  list.unshift(newEntry);
  if (list.length > MAX_ITEMS) list.length = MAX_ITEMS;
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
  pushToCloud(newEntry).catch(() => {});
  return true;
}

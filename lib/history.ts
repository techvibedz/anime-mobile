import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase, isSupabaseConfigured } from "./supabase";

const KEY = "watch_history";
const MAX_ITEMS = 50;

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
  const updated: WatchEntry = { ...entry, updatedAt: Date.now() };
  if (idx >= 0) {
    list[idx] = updated;
  } else {
    list.unshift(updated);
    if (list.length > MAX_ITEMS) list.length = MAX_ITEMS;
  }
  list.sort((a, b) => b.updatedAt - a.updatedAt);
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
  pushToCloud(updated).catch(() => {});
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

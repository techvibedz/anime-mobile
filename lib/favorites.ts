import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase, isSupabaseConfigured, getSessionUser } from "./supabase";
import { favoriteKey, isAnimeDetailUrl, toAnimeUrl } from "./favoritesIdentity";

export { favoriteKey, isAnimeDetailUrl, isEpisodeUrl, toAnimeUrl } from "./favoritesIdentity";

const KEY = "anime_favorites";

export type FavoriteList = "watching" | "planned";

export interface FavoriteAnime {
  title: string;
  href: string;
  image: string;
  addedAt: number;
  list: FavoriteList;
}

type FavoriteListener = () => void;
const listeners = new Set<FavoriteListener>();

function emitFavoritesChanged() {
  for (const listener of listeners) listener();
}

/** React screens subscribe so late cloud hydration updates the heart. */
export function subscribeFavorites(listener: FavoriteListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// In-memory cache: every screen that reads favorites (home, mylist, sidebar,
// profile, notifications) used to re-parse the whole JSON blob from storage.
let favCache: FavoriteAnime[] | null = null;

async function loadFavorites(): Promise<FavoriteAnime[]> {
  if (favCache) return favCache;
  const raw = await AsyncStorage.getItem(KEY);
  favCache = raw ? (JSON.parse(raw) as FavoriteAnime[]) : [];
  return favCache;
}

async function pushFavoriteToCloud(fav: FavoriteAnime) {
  if (!isSupabaseConfigured) return;
  const user = await getSessionUser();
  if (!user) return;
  const { error } = await supabase.from("favorites").upsert({
    user_id: user.id,
    href: fav.href,
    title: fav.title,
    image: fav.image,
    list: fav.list,
    added_at: new Date(fav.addedAt).toISOString(),
  }, { onConflict: "user_id,href" });
  if (error) console.warn("[favorites] cloud sync failed:", error.message);
}

async function deleteFavoritesFromCloud(hrefs: string[]) {
  if (!isSupabaseConfigured) return;
  const user = await getSessionUser();
  if (!user || hrefs.length === 0) return;
  await supabase.from("favorites").delete().eq("user_id", user.id).in("href", hrefs);
}

/** Hydrate local cache from Supabase (called after sign-in). */
export async function pullFavoritesFromCloud() {
  if (!isSupabaseConfigured) return;
  const user = await getSessionUser();
  if (!user) return;
  const { data, error } = await supabase.from("favorites")
    .select("*")
    .eq("user_id", user.id)
    .order("added_at", { ascending: false });
  if (error) { console.warn("[favorites] pull failed:", error.message); return; }
  if (!data) return;
  const list: FavoriteAnime[] = data.map((row: any) => ({
    title: row.title,
    href: row.href,
    image: row.image || "",
    list: (row.list || "planned") as FavoriteList,
    addedAt: new Date(row.added_at).getTime(),
  }));
  favCache = list;
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
  emitFavoritesChanged();
}

export async function getFavorites(filterList?: FavoriteList): Promise<FavoriteAnime[]> {
  const list = await loadFavorites();
  // Filter out legacy episode URLs; default `list` to "planned" for migrated entries.
  const cleaned: FavoriteAnime[] = [];
  const seen = new Set<string>();
  for (const favorite of list) {
    if (!isAnimeDetailUrl(favorite.href)) continue;
    const key = favoriteKey(favorite.href);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    cleaned.push({ ...favorite, list: (favorite.list || "planned") as FavoriteList });
  }
  return filterList ? cleaned.filter((f) => f.list === filterList) : cleaned;
}

export async function addFavorite(
  anime: Omit<FavoriteAnime, "addedAt" | "list"> & { list?: FavoriteList },
): Promise<boolean> {
  // If caller passed an episode URL, attempt to convert it. Refuse if no anime URL available.
  let href = anime.href;
  if (!isAnimeDetailUrl(href)) {
    const converted = toAnimeUrl(href);
    if (!converted || !isAnimeDetailUrl(converted)) return false;
    href = converted;
  }
  const targetList: FavoriteList = anime.list || "planned";
  const all = await getFavorites();
  const key = favoriteKey(href);
  const existing = all.find((f) => favoriteKey(f.href) === key);
  if (existing) {
    if (existing.list !== targetList) {
      const updated = all.map((f) => favoriteKey(f.href) === key ? { ...f, list: targetList } : f);
      favCache = updated;
      await AsyncStorage.setItem(KEY, JSON.stringify(updated));
      pushFavoriteToCloud({ ...existing, list: targetList }).catch(() => {});
      emitFavoritesChanged();
    }
    return true;
  }
  const newFav: FavoriteAnime = { title: anime.title, href, image: anime.image, addedAt: Date.now(), list: targetList };
  all.unshift(newFav);
  favCache = all;
  await AsyncStorage.setItem(KEY, JSON.stringify(all));
  pushFavoriteToCloud(newFav).catch(() => {});
  emitFavoritesChanged();
  return true;
}

export async function removeFavorite(href: string) {
  const list = await loadFavorites();
  const key = favoriteKey(href);
  const removedHrefs = list.filter((f) => favoriteKey(f.href) === key).map((f) => f.href);
  const filtered = list.filter((f) => favoriteKey(f.href) !== key);
  favCache = filtered;
  await AsyncStorage.setItem(KEY, JSON.stringify(filtered));
  deleteFavoritesFromCloud(removedHrefs.length ? removedHrefs : [href]).catch(() => {});
  emitFavoritesChanged();
}

/** Returns the list the anime is currently saved to, or null if not saved. */
export async function favoriteListOf(href: string): Promise<FavoriteList | null> {
  const all = await getFavorites();
  const animeHref = isAnimeDetailUrl(href) ? href : toAnimeUrl(href);
  if (!animeHref) return null;
  const key = favoriteKey(animeHref);
  const found = all.find((f) => favoriteKey(f.href) === key);
  return found ? found.list : null;
}

export async function isFavorite(href: string): Promise<boolean> {
  return (await favoriteListOf(href)) !== null;
}

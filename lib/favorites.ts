import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase, isSupabaseConfigured } from "./supabase";

const KEY = "anime_favorites";

export type FavoriteList = "watching" | "planned";

export interface FavoriteAnime {
  title: string;
  href: string;
  image: string;
  addedAt: number;
  list: FavoriteList;
}

/**
 * Converts an episode URL to the parent anime URL when possible.
 * witanime episodes: /episode/<slug>-الحلقة-N[-suffix]/ → /anime/<slug>/
 * anime4up episodes: similar pattern
 * Returns null if the URL is an episode that we can't safely convert.
 */
export function toAnimeUrl(href: string): string | null {
  if (!href) return null;
  if (href.includes('/anime/')) return href;
  if (!href.includes('/episode/')) return href; // unknown structure — assume safe
  try {
    const decoded = decodeURIComponent(href);
    // Strip the -الحلقة-N(-suffix) tail from the slug, then swap /episode/ → /anime/
    const stripped = decoded.replace(/-?الحلقة[-\s]*\d+[^/]*/, '');
    const converted = stripped.replace('/episode/', '/anime/');
    if (converted !== decoded && converted.includes('/anime/')) {
      // Re-encode the path safely
      const u = new URL(converted);
      return u.origin + u.pathname.split('/').map((seg, i) =>
        i === 0 ? seg : encodeURIComponent(decodeURIComponent(seg))
      ).join('/');
    }
  } catch {}
  return null;
}

function isAnimeUrl(href: string): boolean {
  return !!href && href.includes('/anime/') && !href.includes('/episode/');
}

async function pushFavoriteToCloud(fav: FavoriteAnime) {
  if (!isSupabaseConfigured) return;
  const { data: { user } } = await supabase.auth.getUser();
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

async function deleteFavoriteFromCloud(href: string) {
  if (!isSupabaseConfigured) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("favorites").delete().eq("user_id", user.id).eq("href", href);
}

/** Hydrate local cache from Supabase (called after sign-in). */
export async function pullFavoritesFromCloud() {
  if (!isSupabaseConfigured) return;
  const { data: { user } } = await supabase.auth.getUser();
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
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
}

export async function getFavorites(filterList?: FavoriteList): Promise<FavoriteAnime[]> {
  const raw = await AsyncStorage.getItem(KEY);
  const list: FavoriteAnime[] = raw ? JSON.parse(raw) : [];
  // Filter out legacy episode URLs; default `list` to "planned" for migrated entries.
  const cleaned = list
    .filter((f) => isAnimeUrl(f.href))
    .map((f) => ({ ...f, list: (f.list || "planned") as FavoriteList }));
  return filterList ? cleaned.filter((f) => f.list === filterList) : cleaned;
}

export async function addFavorite(
  anime: Omit<FavoriteAnime, "addedAt" | "list"> & { list?: FavoriteList },
): Promise<boolean> {
  // If caller passed an episode URL, attempt to convert it. Refuse if no anime URL available.
  let href = anime.href;
  if (!isAnimeUrl(href)) {
    const converted = toAnimeUrl(href);
    if (!converted || !isAnimeUrl(converted)) return false;
    href = converted;
  }
  const targetList: FavoriteList = anime.list || "planned";
  const all = await getFavorites();
  const existing = all.find((f) => f.href === href);
  if (existing) {
    if (existing.list !== targetList) {
      const updated = all.map((f) => f.href === href ? { ...f, list: targetList } : f);
      await AsyncStorage.setItem(KEY, JSON.stringify(updated));
      pushFavoriteToCloud({ ...existing, list: targetList }).catch(() => {});
    }
    return true;
  }
  const newFav: FavoriteAnime = { title: anime.title, href, image: anime.image, addedAt: Date.now(), list: targetList };
  all.unshift(newFav);
  await AsyncStorage.setItem(KEY, JSON.stringify(all));
  pushFavoriteToCloud(newFav).catch(() => {});
  return true;
}

export async function removeFavorite(href: string) {
  const raw = await AsyncStorage.getItem(KEY);
  const list: FavoriteAnime[] = raw ? JSON.parse(raw) : [];
  const filtered = list.filter((f) => f.href !== href);
  await AsyncStorage.setItem(KEY, JSON.stringify(filtered));
  deleteFavoriteFromCloud(href).catch(() => {});
}

/** Returns the list the anime is currently saved to, or null if not saved. */
export async function favoriteListOf(href: string): Promise<FavoriteList | null> {
  const all = await getFavorites();
  const animeHref = isAnimeUrl(href) ? href : toAnimeUrl(href);
  if (!animeHref) return null;
  const found = all.find((f) => f.href === animeHref);
  return found ? found.list : null;
}

export async function isFavorite(href: string): Promise<boolean> {
  return (await favoriteListOf(href)) !== null;
}

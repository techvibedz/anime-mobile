// AsyncStorage housekeeping.
//
// Android's AsyncStorage DB is capped (6 MB by default; the withAsyncStorageSize
// plugin raises new builds to 50 MB). When it fills, EVERY write fails silently
// — history, dismissals and the downloads index stop persisting, which surfaces
// as "my progress isn't saved" / "the card comes back after a refresh".
//
// Everything listed here is re-fetchable cache data, so dropping it is always
// safe: the app rebuilds it on demand. History, favorites, downloads, settings
// and the auth session are never touched.

import AsyncStorage from "@react-native-async-storage/async-storage";

const CACHE_PREFIXES = [
  "@home_cache_",
  "@detail_",
  "@up4_",
  "@search_",
  "@listing_",
  "@recent_",
  "@servers_",
  "@wit_anime_",
  "@wit_sections_",
  "@wit_base_",
  "@up4_ep_url_",
  "@a3rb_",
  "@xsource_",
  "@anime_catalog_",
  "@anime_airing_",
  "@anime_mal_",
  "@anime_relations_",
  "@anime_yt_",
  "@anime_schedule_",
  "@anime_srcurl_",
  "@translate_ar_",
  "@source_rail_",
];

function isCacheKey(key: string): boolean {
  return CACHE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** Drop every re-fetchable cache entry. Returns how many keys were removed. */
export async function pruneCacheStorage(): Promise<number> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const victims = keys.filter(isCacheKey);
    if (victims.length > 0) await AsyncStorage.multiRemove(victims);
    return victims.length;
  } catch {
    return 0;
  }
}

/**
 * Drop only EXPIRED cache entries (every cache stores `{ ts }`). Runs on app
 * start so the DB does not creep toward the cap during normal use.
 */
export async function pruneExpiredCaches(maxAgeMs = 7 * 24 * 60 * 60 * 1000): Promise<number> {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter(isCacheKey);
    if (keys.length === 0) return 0;
    const pairs = await AsyncStorage.multiGet(keys);
    const now = Date.now();
    const victims: string[] = [];
    for (const [key, raw] of pairs) {
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as { ts?: number };
        if (!parsed?.ts || now - parsed.ts > maxAgeMs) victims.push(key);
      } catch {
        victims.push(key);
      }
    }
    if (victims.length > 0) await AsyncStorage.multiRemove(victims);
    return victims.length;
  } catch {
    return 0;
  }
}

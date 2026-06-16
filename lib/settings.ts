import AsyncStorage from "@react-native-async-storage/async-storage";

// Lightweight user-preferences store backed by AsyncStorage. Each setting has a
// key, a default, and typed get/set helpers. Kept tiny and dependency-free so
// any screen can read/write a preference without a global state library.

const KEYS = {
  notificationsEnabled: "@settings_notifications_enabled",
  autoplayNext: "@settings_autoplay_next",
  notificationScope: "@settings_notification_scope",
} as const;

/** Which anime trigger new-episode notifications. */
export type NotificationScope = "all" | "mylist";

async function getBool(key: string, fallback: boolean): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === "1";
  } catch {
    return fallback;
  }
}

async function setBool(key: string, value: boolean) {
  try {
    await AsyncStorage.setItem(key, value ? "1" : "0");
  } catch {}
}

/** New-episode notifications master switch (default on). */
export const getNotificationsEnabled = () => getBool(KEYS.notificationsEnabled, true);
export const setNotificationsEnabled = (v: boolean) => setBool(KEYS.notificationsEnabled, v);

/** Autoplay the next episode when the current one ends (default on). */
export const getAutoplayNext = () => getBool(KEYS.autoplayNext, true);
export const setAutoplayNext = (v: boolean) => setBool(KEYS.autoplayNext, v);

/**
 * Notification scope (default "all"): notify for every new episode across all
 * anime, or only for anime saved in the user's list.
 */
export async function getNotificationScope(): Promise<NotificationScope> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.notificationScope);
    return raw === "mylist" ? "mylist" : "all";
  } catch {
    return "all";
  }
}

export async function setNotificationScope(value: NotificationScope) {
  try {
    await AsyncStorage.setItem(KEYS.notificationScope, value);
  } catch {}
}

/**
 * Clear the app's scraping/data caches (home feed, anime details, search,
 * listings, recent, servers, etc.) without touching favorites, watch history,
 * settings or notifications. Returns the number of keys removed.
 */
export async function clearContentCache(): Promise<number> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const cachePrefixes = [
      "@home_cache",
      "@detail_v1:",
      "@up4_eps_v2:",
      "@up4_ep_url_v1:",
      "@search_v1:",
      "@listing_v1:",
      "@recent_v1:",
      "@servers_v2:",
      "@xsource_v1",
      "@anime_airing_v1:",
    ];
    const toRemove = keys.filter((k) => cachePrefixes.some((p) => k.startsWith(p)));
    if (toRemove.length) await AsyncStorage.multiRemove(toRemove);
    return toRemove.length;
  } catch {
    return 0;
  }
}

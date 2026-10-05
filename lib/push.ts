// Local (on-device) push notifications via expo-notifications.
//
// The app is backend-free, so there is no remote push server — these are
// *local* notifications fired by the app itself the moment it detects (during a
// foreground sync) that a followed anime has a new episode. This is the native
// counterpart to the in-app notification center in lib/notifications.ts.
//
// Native module → only present in a real APK build (1.3.1+), not over OTA. All
// calls are wrapped so that on an older build (where the module is absent) they
// degrade to no-ops instead of crashing.

import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { getNotificationsEnabled, getNotificationScope, getDailyAnimeNotif, type NotificationScope } from "./settings";
import { supabase, isSupabaseConfigured, getSessionUser } from "./supabase";
import { fetchSeasonAnime, currentSeason } from "./seasons";
import { localDayKey, orderDailyPool, pickOfTheDay } from "./dailyPick";
import { t } from "./i18n";

let Notifications: typeof import("expo-notifications") | null = null;
try {
  // Lazy require so a JS-only OTA onto an older binary (without the native
  // module) doesn't crash at import time — mirrors the AppLovin lazy-load rule.
  Notifications = require("expo-notifications");
} catch {
  Notifications = null;
}

const CHANNEL_ID = "new-episodes";
const DAILY_IDS_KEY = "@daily_anime_notif_ids";
let configured = false;

/** Configure foreground behaviour + the Android notification channel. Safe to call repeatedly. */
export async function setupNotifications() {
  if (!Notifications || configured) return;
  configured = true;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        // Back-compat with older expo-notifications field names.
        shouldShowAlert: true,
      }),
    });
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: "حلقات جديدة",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#FF2D55",
      });
    }
  } catch {}
}

/**
 * Ask for notification permission. Returns true if granted. In Expo Go the
 * remote-push side is unsupported on Android, but local notifications still
 * work in a dev/standalone build, so we only need the OS permission grant.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!Notifications) return false;
  try {
    const settings = await Notifications.getPermissionsAsync();
    let status = settings.status;
    if (status !== "granted") {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    return status === "granted";
  } catch {
    return false;
  }
}

/** True when the native module exists AND the OS permission is already granted. */
export async function hasNotificationPermission(): Promise<boolean> {
  if (!Notifications) return false;
  try {
    const settings = await Notifications.getPermissionsAsync();
    return settings.status === "granted";
  } catch {
    return false;
  }
}

export function notificationsModuleAvailable(): boolean {
  return !!Notifications;
}

/**
 * Fire a local notification for a new episode. No-ops when the module is
 * missing, the user disabled notifications in settings, or permission is
 * denied. `data` is attached so a tap can deep-link to the episode.
 */
export async function presentNewEpisodeNotification(params: {
  title: string;
  body: string;
  episodeHref?: string;
  animeHref?: string;
  image?: string;
}): Promise<void> {
  if (!Notifications) return;
  try {
    if (!(await getNotificationsEnabled())) return;
    if (!(await hasNotificationPermission())) return;
    await setupNotifications();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: params.title,
        body: params.body,
        sound: true,
        data: {
          episodeHref: params.episodeHref,
          animeHref: params.animeHref,
          image: params.image,
        },
      },
      // Android reads the channel from the TRIGGER, not the content.
      trigger: Platform.OS === "android" ? { channelId: CHANNEL_ID } : null,
    });
  } catch {}
}

/** Cancel every scheduled "أنمي اليوم" notification and clear the stored ids. */
export async function cancelDailyAnimeReminders(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(DAILY_IDS_KEY);
    const ids: string[] = raw ? JSON.parse(raw) : [];
    if (Notifications) {
      for (const id of ids) {
        try {
          await Notifications.cancelScheduledNotificationAsync(id);
        } catch {}
      }
    }
    await AsyncStorage.removeItem(DAILY_IDS_KEY);
  } catch {
    // never throws
  }
}

/**
 * (Re)schedule the next 7 days of "أنمي اليوم" local notifications from the
 * current season's catalogue, one per day at 20:00 local time. Called on every
 * app start and when the setting is toggled; always cancels the previous batch
 * first so ids can't pile up. Never throws.
 */
export async function syncDailyAnimeReminders(): Promise<void> {
  try {
    await cancelDailyAnimeReminders();
    if (!notificationsModuleAvailable()) return;
    if (!(await getDailyAnimeNotif())) return;
    if (!(await getNotificationsEnabled())) return;
    if (!(await hasNotificationPermission())) return;
    await setupNotifications();

    const { season, year } = currentSeason();
    // Same shared pool as the home card (watchable + popularity order + cap),
    // so a notification can never name a different anime than the card.
    const list = orderDailyPool(await fetchSeasonAnime(season, year));
    if (!list.length) return; // offline / empty catalogue → nothing to schedule

    const ids: string[] = [];
    const now = Date.now();
    for (let i = 0; i < 7; i++) {
      const day = new Date();
      day.setDate(day.getDate() + i);
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 20, 0, 0, 0);
      if (at.getTime() <= now) continue; // skip today once 20:00 has passed
      const pick = pickOfTheDay(list, localDayKey(day));
      if (!pick) continue;
      ids.push(
        await Notifications!.scheduleNotificationAsync({
          content: {
            title: t.dailyNotifTitle,
            body: t.dailyNotifBody(pick.title),
            sound: true,
            data: { anilistId: pick.id },
          },
          trigger: {
            type: Notifications!.SchedulableTriggerInputTypes.DATE,
            date: at.getTime(),
            // Android reads the channel from the trigger, not the content.
            ...(Platform.OS === "android" ? { channelId: CHANNEL_ID } : {}),
          },
        }),
      );
      // Persist after EVERY schedule: if the loop dies mid-way (storage full,
      // app killed), the next sync can still cancel what already exists.
      await AsyncStorage.setItem(DAILY_IDS_KEY, JSON.stringify(ids));
    }
  } catch {
    // never throws
  }
}

/**
 * Register this device's Expo push token against the signed-in user so the
 * server (episode-notifier Edge Function) can push new-episode alerts even when
 * the app is fully closed. No-op when the native module is missing (older
 * build), Supabase isn't configured, or permission is denied.
 *
 * Requires FCM credentials configured for the Expo project (Android) — see the
 * 1.4.0 setup notes. Until then `getExpoPushTokenAsync` will throw on Android
 * and this degrades to a no-op.
 */
export async function registerPushTokenAsync(userId: string): Promise<void> {
  if (!Notifications || !isSupabaseConfigured || !userId) return;
  try {
    let granted = await hasNotificationPermission();
    if (!granted) granted = await requestNotificationPermission();
    if (!granted) return;
    await setupNotifications();

    const projectId =
      (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
    const resp = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    const token = resp?.data;
    if (!token) return;

    await supabase.from("push_tokens").upsert(
      {
        user_id: userId,
        token,
        platform: Platform.OS,
        // The server reads this to decide whether to push for every new episode
        // ("all") or only the user's saved anime ("mylist"). Mirrors the on-device
        // notification-scope setting.
        notification_scope: await getNotificationScope(),
        // Master on/off switch — the server skips tokens with enabled=false.
        enabled: await getNotificationsEnabled(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,token" },
    );
  } catch {
    // Missing FCM creds / no network / permission revoked → silent no-op.
  }
}

/**
 * Push the current notification-scope setting up to all of this user's
 * registered push tokens, so the server (episode-notifier) immediately honors a
 * change between "all anime" and "my list only" without waiting for the next
 * token re-registration. Best-effort: no-op when signed out / not configured.
 */
export async function updateNotificationScopeRemote(scope: NotificationScope): Promise<void> {
  if (!isSupabaseConfigured) return;
  try {
    const userId = (await getSessionUser())?.id;
    if (!userId) return;
    await supabase.from("push_tokens").update({ notification_scope: scope }).eq("user_id", userId);
  } catch {
    // ignore — scope will still sync on the next token registration
  }
}

/**
 * Push the notifications master on/off switch up to all of this user's tokens so
 * the server stops/resumes closed-app push immediately. Best-effort: no-op when
 * signed out / not configured.
 */
export async function updateNotificationsEnabledRemote(enabled: boolean): Promise<void> {
  if (!isSupabaseConfigured) return;
  try {
    const userId = (await getSessionUser())?.id;
    if (!userId) return;
    await supabase.from("push_tokens").update({ enabled }).eq("user_id", userId);
  } catch {
    // ignore — will still sync on the next token registration
  }
}

/**
 * Fire a real closed-app push notification (with image) to THIS user's own
 * device(s), via the episode-notifier Edge Function's test path. Lets the user
 * verify on demand that background notifications + images work, without waiting
 * for a real episode to flow through the shared queue. Ensures a token is
 * registered first. Returns ok=false with a reason on any failure.
 */
export async function sendTestNotificationAsync(
  userId: string,
): Promise<{ ok: boolean; reason?: string }> {
  if (!isSupabaseConfigured || !userId) return { ok: false, reason: "unconfigured" };
  try {
    // Make sure this device has a fresh token registered before we test.
    await registerPushTokenAsync(userId);
    const { data, error } = await supabase.functions.invoke("episode-notifier", {
      body: { test: true },
    });
    if (error) return { ok: false, reason: "invoke" };
    const res = (data ?? {}) as { ok?: boolean; error?: string };
    return res.ok ? { ok: true } : { ok: false, reason: res.error ?? "unknown" };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/** Remove this device's push token (call on sign-out). */
export async function unregisterPushTokenAsync(userId: string): Promise<void> {
  if (!Notifications || !isSupabaseConfigured || !userId) return;
  try {
    const projectId =
      (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
    const resp = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    const token = resp?.data;
    if (!token) return;
    await supabase.from("push_tokens").delete().eq("user_id", userId).eq("token", token);
  } catch {
    // ignore
  }
}

/** Subscribe to notification taps → returns the tapped notification's data payload. */
export function addNotificationTapListener(
  handler: (data: { episodeHref?: string; animeHref?: string; image?: string; anilistId?: number }) => void,
): { remove: () => void } {
  if (!Notifications) return { remove: () => {} };
  try {
    const sub = Notifications.addNotificationResponseReceivedListener((response: any) => {
      const data = response?.notification?.request?.content?.data ?? {};
      handler(data);
    });
    return sub;
  } catch {
    return { remove: () => {} };
  }
}

/**
 * Data payload of the notification that launched the app from a cold start, or
 * null. `addNotificationResponseReceivedListener` never fires for that tap, so
 * startup routing must read it explicitly.
 */
export async function getLastNotificationTapData(): Promise<{
  episodeHref?: string;
  animeHref?: string;
  image?: string;
  anilistId?: number;
} | null> {
  if (!Notifications) return null;
  try {
    const response = await Notifications.getLastNotificationResponseAsync();
    const data = response?.notification?.request?.content?.data;
    return (data as { episodeHref?: string; animeHref?: string; image?: string; anilistId?: number }) ?? null;
  } catch {
    return null;
  }
}

/**
 * Subscribe to notification taps for chat notifications only. The handler
 * fires with `{ chatId, chatKind }` when the tapped notification had
 * `chatKind === "admin"`. Episode notifications are ignored here so the two
 * listeners can coexist without overlap. The actual closed-app push delivery
 * is handled server-side by the pg_net trigger in supabase/admin-chat.sql.
 */
export function addChatNotificationTapListener(
  handler: (data: { chatId?: string; chatKind?: "admin" }) => void,
): { remove: () => void } {
  if (!Notifications) return { remove: () => {} };
  try {
    const sub = Notifications.addNotificationResponseReceivedListener((response: any) => {
      const data = response?.notification?.request?.content?.data ?? {};
      if (data?.chatKind !== "admin") return;
      handler({ chatId: data.chatId, chatKind: "admin" });
    });
    return sub;
  } catch {
    return { remove: () => {} };
  }
}

// Silence "unused" while keeping Constants import meaningful for future
// projectId-based remote push (kept intentionally local for now).
void Constants;

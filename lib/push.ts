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
import Constants from "expo-constants";
import { getNotificationsEnabled, getNotificationScope, type NotificationScope } from "./settings";
import { supabase, isSupabaseConfigured } from "./supabase";

let Notifications: typeof import("expo-notifications") | null = null;
try {
  // Lazy require so a JS-only OTA onto an older binary (without the native
  // module) doesn't crash at import time — mirrors the AppLovin lazy-load rule.
  Notifications = require("expo-notifications");
} catch {
  Notifications = null;
}

const CHANNEL_ID = "new-episodes";
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
        ...(Platform.OS === "android" ? { channelId: CHANNEL_ID } : {}),
      },
      trigger: null, // deliver immediately
    });
  } catch {}
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
    const { data } = await supabase.auth.getUser();
    const userId = data?.user?.id;
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
    const { data } = await supabase.auth.getUser();
    const userId = data?.user?.id;
    if (!userId) return;
    await supabase.from("push_tokens").update({ enabled }).eq("user_id", userId);
  } catch {
    // ignore — will still sync on the next token registration
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
  handler: (data: { episodeHref?: string; animeHref?: string; image?: string }) => void,
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

// Silence "unused" while keeping Constants import meaningful for future
// projectId-based remote push (kept intentionally local for now).
void Constants;

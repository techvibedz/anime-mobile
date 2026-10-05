import { useEffect, useRef, useState } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useFonts } from "expo-font";
import { View, ActivityIndicator, I18nManager, AppState } from "react-native";
import * as Updates from "expo-updates";
import * as SplashScreen from "expo-splash-screen";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { C } from "../lib/theme";

// Keep the native splash screen up until our fonts are ready. Without this the
// native splash hides the instant JS boots, flashing a bare spinner before the
// first real frame — on low-end phones that flash can last a noticeable beat.
// Holding the splash makes the launch feel like one continuous animation.
SplashScreen.preventAutoHideAsync().catch(() => {});

// The whole UI is built LTR-base and we paint the Arabic look manually with
// `flexDirection: "row-reverse"` and text alignment. If the phone's system
// language is RTL (Arabic), React Native auto-flips the entire layout, which
// double-flips our manual rows and mirrors the app into a broken state.
// Lock the app to LTR so layout is consistent regardless of device language.
if (I18nManager.isRTL) {
  try {
    I18nManager.allowRTL(false);
    I18nManager.forceRTL(false);
    // forceRTL persists natively but the running views were already laid out
    // RTL — reload once so the new direction takes effect. After reload
    // isRTL is false, so this branch won't run again (no loop).
    Updates.reloadAsync().catch(() => {});
  } catch {
    // no-op in environments where Updates/I18nManager isn't available
  }
}
import { AuthProvider, useAuth } from "../lib/auth";
import { pullFavoritesFromCloud } from "../lib/favorites";
import { pullHistoryFromCloud, flushHistoryCloudPushes } from "../lib/history";
import { pruneExpiredCaches } from "../lib/storageMaintenance";
import { pullCompletionFromCloud } from "../lib/completion";
import { checkForApkUpdate, checkForOtaUpdate } from "../lib/updater";
import type { UpdateInfo } from "../lib/updater";
import { UpdateModal } from "../components/UpdateModal";
import { ScraperHost } from "../lib/scraper";
import { initAds } from "../lib/ads";
import { SidebarProvider } from "../components/Sidebar";
import { CompletionProvider } from "../lib/completion";
import { setupNotifications, requestNotificationPermission, addNotificationTapListener, addChatNotificationTapListener, syncDailyAnimeReminders, getLastNotificationTapData } from "../lib/push";
import { reportRecentEpisodes } from "../lib/notifications";
import { startPresence, stopPresence, isAdmin } from "../lib/presence";
import { startUsageSession, endUsageSession } from "../lib/usage";
import { getNotificationsEnabled } from "../lib/settings";
import { toAnimeUrl } from "../lib/favorites";
import { syncDownloads } from "../lib/downloads";
import { takePendingInvite } from "../lib/partyInvite";
import "../global.css";

function AuthGate() {
  const { user, ready, isConfigured } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (!ready) return;
    // If auth backend isn't configured, treat the app as anonymous-OK (legacy mode).
    if (!isConfigured) return;
    const inAuth = segments[0] === "(auth)";
    const inDebug = segments[0] === "scraper-debug";
    const inCallback = segments[0] === "auth-callback";
    if (!user && !inAuth && !inDebug && !inCallback) {
      router.replace("/(auth)/welcome");
    } else if (user && inAuth) {
      // A watch-party invite that arrived while signed out was stashed by the
      // watch-party screen; after sign-in, head back into the party instead of
      // the home tabs.
      void takePendingInvite().then((code) => {
        router.replace(code ? { pathname: "/watch-party", params: { code } } : "/(tabs)");
      });
    }
  }, [user, ready, isConfigured, segments, router]);

  // Hydrate cloud data once on sign-in — and at most every few minutes per
  // user. This used to re-pull three full tables on every relaunch, so opening
  // the app twice in a row paid three network round-trips + three full local
  // read-modify-writes before the synced data settled.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const key = `@cloud_pull_at:${user.id}`;
    (async () => {
      try {
        const last = Number(await AsyncStorage.getItem(key)) || 0;
        if (Date.now() - last < 5 * 60 * 1000) return;
        await AsyncStorage.setItem(key, String(Date.now()));
      } catch {}
      if (cancelled) return;
      pullFavoritesFromCloud().catch(() => {});
      // History emits the final badge refresh after cloud completion has settled.
      pullCompletionFromCloud().catch(() => {}).then(() => pullHistoryFromCloud()).catch(() => {});
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  // Advertise this device as "online" via Supabase Realtime presence while a
  // user is signed in. Powers the admin-only live-users screen (app/live.tsx).
  //
  // Battery: presence holds a live Realtime WebSocket open. Left running while
  // the app is backgrounded it keeps the radio awake for no benefit (a
  // backgrounded device isn't "actively using" the app), so we tear the channel
  // down on background and re-establish it on foreground. startPresence is
  // idempotent, so re-calling on "active" is cheap.
  useEffect(() => {
    if (!user) return;
    if (AppState.currentState === "active") {
      startPresence(user).catch(() => {});
      startUsageSession(user).catch(() => {});
    }
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") {
        startPresence(user).catch(() => {});
        startUsageSession(user).catch(() => {});
      } else {
        stopPresence().catch(() => {});
        endUsageSession().catch(() => {});
        // The history push timer doesn't survive an app-kill — send the final
        // progress/completion now so the cloud (admin history, other devices)
        // can't lose a watched mark.
        flushHistoryCloudPushes();
      }
    });
    return () => {
      sub.remove();
      stopPresence().catch(() => {});
      endUsageSession().catch(() => {});
      flushHistoryCloudPushes();
    };
  }, [user?.id]);

  // Keep the shared new-episode feed fresh from ANY screen: when signed in,
  // report recently-available episodes on mount AND whenever the app returns to
  // the foreground (throttled inside reportRecentEpisodes). Previously this only
  // ran on the home tab mount, so a user who opened straight into the player —
  // or just kept the app backgrounded — never contributed/triggered detection.
  // The feed is global, so any one foregrounded device keeps push fresh for all.
  useEffect(() => {
    if (!user) return;
    reportRecentEpisodes().catch(() => {});
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") reportRecentEpisodes().catch(() => {});
    });
    return () => sub.remove();
  }, [user?.id]);

  // Notifications: configure channel + request permission once at startup
  // (only if the user hasn't disabled them), and route taps to the episode.
  useEffect(() => {
    if (!ready) return;
    // Notification channel setup + permission prompt aren't needed for the
    // first frame — defer with a plain timer so they don't compete with the
    // home screen's initial render. (NOT InteractionManager.runAfterInteractions:
    // the looping skeleton animations hold interaction handles and starve that
    // callback — the same bug documented on the update check below.)
    const timer = setTimeout(() => {
      (async () => {
        await setupNotifications();
        if (await getNotificationsEnabled()) {
          await requestNotificationPermission();
        }
        // Refresh the 7-day "أنمي اليوم" batch (fire-and-forget — must not delay
        // startup; also picks up permission granted above on the first run).
        void syncDailyAnimeReminders().catch(() => {});
      })().catch(() => {});
    }, 2500);

    const routeNotificationData = (data: {
      episodeHref?: string;
      animeHref?: string;
      image?: string;
      anilistId?: number;
    } | null | undefined) => {
      // "أنمي اليوم" tap → open the title page for the picked AniList id.
      if (data?.anilistId) {
        router.push(`/title/${data.anilistId}`);
        return;
      }
      if (!data?.episodeHref) return;
      const params: Record<string, string> = {};
      if (data.image) params.img = encodeURIComponent(data.image);
      const animeUrl = data.animeHref?.includes("/anime/")
        ? data.animeHref
        : toAnimeUrl(data.episodeHref) ?? data.animeHref;
      if (animeUrl) params.anime = animeUrl;
      router.push({ pathname: `/watch/${encodeURIComponent(data.episodeHref)}`, params });
    };

    const sub = addNotificationTapListener(routeNotificationData);

    // Cold start: the tap that launched a killed app never reaches the
    // listener above, so route the pending response explicitly.
    void getLastNotificationTapData()
      .then((data) => { if (data) routeNotificationData(data); })
      .catch(() => {});

    // Admin-chat push tap routing. The closed-app push fires from a DB trigger
    // (supabase/admin-chat.sql) and carries { chatId, chatKind: 'admin' } in
    // its data payload. An admin tapping their thread opens the admin
    // conversation; any other user opens the public /chat thread (their only
    // thread). Routes only when the user is already signed-in — otherwise the
    // AuthGate redirect will handle it.
    const chatSub = addChatNotificationTapListener(({ chatId }) => {
      if (isAdmin(user?.email) && chatId) {
        router.push({ pathname: "/admin/chat/[id]", params: { id: chatId } });
      } else {
        router.push("/chat");
      }
    });
    return () => { clearTimeout(timer); sub.remove(); chatSub.remove(); };
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    syncDownloads().catch(() => {});
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") syncDownloads().catch(() => {});
    });
    return () => sub.remove();
  }, [ready]);

  // Update checks (APK first, then OTA)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  // Each prompt surfaces at most once per app session, so the foreground
  // re-checks can't nag the user every time they resume the app.
  const otaSurfacedRef = useRef(false);
  // The APK check keeps its own flag and may OVERRIDE a pending-OTA prompt.
  // An OTA can only patch the JS of the CURRENT native runtime — when a new
  // APK exists (native layer changed), the APK is the only update that can
  // land, so a pending OTA must never hide the APK prompt.
  const apkSurfacedRef = useRef(false);

  // Belt-and-suspenders for the background OTA download. With
  // updates.checkAutomatically = "ON_LOAD" (app.json), expo-updates fetches a
  // new bundle in the BACKGROUND and only swaps it in on the next *cold* start —
  // which a warm resume from the recents list never triggers, so users report
  // "I closed and reopened and still didn't get the update". The imperative
  // checkForOtaUpdate() below also misses this window: once ON_LOAD has staged
  // the update, checkForUpdateAsync() reports isAvailable:false. The
  // useUpdates() hook flips isUpdatePending → true the instant a downloaded
  // update is staged, so prompt for the restart right then — no cold start
  // needed; "Restart now" calls Updates.reloadAsync() and applies it.
  const { isUpdatePending } = Updates.useUpdates();
  useEffect(() => {
    if (isUpdatePending && !otaSurfacedRef.current && !apkSurfacedRef.current) {
      otaSurfacedRef.current = true;
      setUpdateInfo({ type: "ota" });
    }
  }, [isUpdatePending]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    const runApkCheck = async () => {
      if (apkSurfacedRef.current) return true;
      const apk = await checkForApkUpdate();
      if (!cancelled && apk) {
        apkSurfacedRef.current = true;
        // Overrides an OTA prompt already on screen: a new APK supersedes it.
        setUpdateInfo(apk);
        return true;
      }
      return false;
    };

    // Initial check — deferred ~1.2s past first paint with a plain timer.
    // (Deliberately NOT InteractionManager.runAfterInteractions: looping skeleton
    // animations hold interaction handles and would starve that callback so the
    // modal never appears — the exact bug this replaces.)
    const timer = setTimeout(() => {
      (async () => {
        if (await runApkCheck()) return;
        const ota = await checkForOtaUpdate();
        if (!cancelled && ota && !otaSurfacedRef.current && !apkSurfacedRef.current) {
          otaSurfacedRef.current = true;
          setUpdateInfo(ota);
        }
      })();
    }, 1200);

    // Re-check whenever the app returns to the foreground. The cold-start check
    // misses two common cases: the user resumed from the background (no cold
    // start), or version.json was still CDN-cached at launch. Guarded to fire
    // only until an APK update has been surfaced once this session.
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void runApkCheck();
    });

    return () => { cancelled = true; clearTimeout(timer); sub.remove(); };
  }, [ready]);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color={C.accent} />
      </View>
    );
  }

  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: C.bg },
          animation: "fade",
          // Rapid-navigation memory/CPU guard. Backgrounded screens in the stack
          // (e.g. a chain of detail pages opened via "related anime") otherwise
          // keep re-rendering their heavy trees — 80-episode grids, poster/banner
          // images — whenever a late async result (AniList / Supabase / download
          // tick) lands, and their native views stay attached. freezeOnBlur
          // suspends every off-top screen (react-freeze) so only the focused
          // screen does work; react-native-screens detaches the rest. This is the
          // fix for the progressive slowdown / "stuck" state after hopping
          // through many pages.
          freezeOnBlur: true,
        }}
      >
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="anime/[id]" />
        <Stack.Screen
          name="watch/[episode]"
          options={{
            // Go fully immersive while watching: hide the Android on-screen
            // system navigation bar (and status bar) so the video isn't
            // overlapped by the phone's button bar. react-native-screens
            // restores both when leaving this route. JS-only → OTA-safe.
            navigationBarHidden: true,
            statusBarHidden: true,
          }}
        />
        <Stack.Screen name="see-all/[section]" />
        <Stack.Screen name="notifications" />
        <Stack.Screen name="news" />
        <Stack.Screen name="news/[id]" />
        <Stack.Screen name="schedule" />
        <Stack.Screen name="upcoming" />
        <Stack.Screen name="seasons" />
        <Stack.Screen name="popular/[kind]" />
        <Stack.Screen name="downloads" />
        <Stack.Screen name="title/[id]" />
        <Stack.Screen name="manga/[id]" />
        <Stack.Screen name="manga-library" />
        <Stack.Screen
          name="manga-reader/[chapter]"
          options={{
            // Immersive reading, same treatment as the video player: hide the
            // Android system bars so pages own the full screen.
            navigationBarHidden: true,
            statusBarHidden: true,
          }}
        />
        <Stack.Screen name="profile" />
        <Stack.Screen name="history" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="report" />
        <Stack.Screen name="live" />
        <Stack.Screen name="watch-party" />
        <Stack.Screen name="users" />
        <Stack.Screen name="user/[id]" />
        <Stack.Screen name="admin/chats" />
        <Stack.Screen name="admin/chat/[id]" />
        <Stack.Screen name="chat" />
        <Stack.Screen name="scraper-debug" />
        <Stack.Screen name="auth-callback" options={{ animation: "none" }} />
      </Stack>
      <UpdateModal 
        info={updateInfo} 
        onClose={() => {
          const wasApk = updateInfo?.type === "apk";
          setUpdateInfo(null);
          if (wasApk) {
            checkForOtaUpdate().then((ota) => {
              if (ota) setUpdateInfo(ota);
            });
          }
        }} 
      />
    </>
  );
}

export default function RootLayout() {
  // Expo Go and web don't embed app.json's font plugin assets. Register the
  // same aliases in every runtime; useFonts reuses fonts already loaded natively.
  const [fontsLoaded, fontError] = useFonts({
    Outfit_400Regular: require("../assets/fonts/Outfit_400Regular.ttf"),
    Outfit_600SemiBold: require("../assets/fonts/Outfit_600SemiBold.ttf"),
    Outfit_700Bold: require("../assets/fonts/Outfit_700Bold.ttf"),
    Outfit_800ExtraBold: require("../assets/fonts/Outfit_800ExtraBold.ttf"),
    Outfit_900Black: require("../assets/fonts/Outfit_900Black.ttf"),
    Cairo_500Medium: require("../assets/fonts/Cairo_500Medium.ttf"),
    Cairo_600SemiBold: require("../assets/fonts/Cairo_600SemiBold.ttf"),
    Cairo_700Bold: require("../assets/fonts/Cairo_700Bold.ttf"),
    DMSans_400Regular: require("../assets/fonts/DMSans_400Regular.ttf"),
    DMSans_500Medium: require("../assets/fonts/DMSans_500Medium.ttf"),
    DMSans_600SemiBold: require("../assets/fonts/DMSans_600SemiBold.ttf"),
    DMSans_700Bold: require("../assets/fonts/DMSans_700Bold.ttf"),
  });

  // Kick off the ad SDK shortly after first paint (no-op until ad IDs are
  // configured). A plain timer — see the notification effect above for why
  // runAfterInteractions is unreliable while skeleton animations run.
  useEffect(() => {
    const timer = setTimeout(() => { initAds(); }, 3000);
    return () => clearTimeout(timer);
  }, []);

  // Housekeeping: drop expired AsyncStorage cache entries so the (Android-
  // capped) DB never fills up — a full DB silently fails EVERY write, which
  // stopped watch history and Continue Watching dismissals from persisting.
  useEffect(() => {
    const timer = setTimeout(() => { void pruneExpiredCaches(); }, 8000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!fontsLoaded && !fontError) return;
    if (fontError) console.warn("App fonts could not load:", fontError);
    SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <AuthProvider>
          <CompletionProvider>
            <SidebarProvider>
              <AuthGate />
            </SidebarProvider>
          </CompletionProvider>
        </AuthProvider>
        <ScraperHost />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

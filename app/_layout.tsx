import { useEffect, useRef, useState } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts, Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold, Outfit_800ExtraBold, Outfit_900Black } from "@expo-google-fonts/outfit";
// Cairo is the Arabic UI font. Outfit (Latin-only) is kept ONLY for numerals and
// the brand display (ranks, countdown digits, durations) — Latin glyphs that don't
// have the Arabic measuring problem. All Arabic word labels use Cairo, because
// Latin fonts under-measure Arabic glyphs and the text spilled out of tight rows
// (e.g. filter pills overlapping their count badges).
import { Cairo_500Medium, Cairo_600SemiBold, Cairo_700Bold } from "@expo-google-fonts/cairo";
import { View, ActivityIndicator, I18nManager, InteractionManager, AppState } from "react-native";
import * as Updates from "expo-updates";
import * as SplashScreen from "expo-splash-screen";
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
import { pullHistoryFromCloud } from "../lib/history";
import { checkForApkUpdate, checkForOtaUpdate } from "../lib/updater";
import type { UpdateInfo } from "../lib/updater";
import { UpdateModal } from "../components/UpdateModal";
import { ScraperHost } from "../lib/scraper";
import { initAds } from "../lib/ads";
import { SidebarProvider } from "../components/Sidebar";
import { setupNotifications, requestNotificationPermission, addNotificationTapListener } from "../lib/push";
import { reportRecentEpisodes } from "../lib/notifications";
import { startPresence, stopPresence } from "../lib/presence";
import { getNotificationsEnabled } from "../lib/settings";
import { toAnimeUrl } from "../lib/favorites";
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
      router.replace("/(tabs)");
    }
  }, [user, ready, isConfigured, segments, router]);

  // Hydrate cloud data once on sign-in
  useEffect(() => {
    if (user) {
      pullFavoritesFromCloud().catch(() => {});
      pullHistoryFromCloud().catch(() => {});
    }
  }, [user?.id]);

  // Advertise this device as "online" via Supabase Realtime presence while a
  // user is signed in. Powers the admin-only live-users screen (app/live.tsx).
  useEffect(() => {
    if (user) {
      startPresence(user).catch(() => {});
      return () => { stopPresence().catch(() => {}); };
    }
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
    // first frame — run them after the UI has settled so they don't compete
    // with the home screen's initial render on slower devices.
    const task = InteractionManager.runAfterInteractions(() => {
      (async () => {
        await setupNotifications();
        if (await getNotificationsEnabled()) {
          await requestNotificationPermission();
        }
      })().catch(() => {});
    });

    const sub = addNotificationTapListener((data) => {
      if (!data?.episodeHref) return;
      const params: Record<string, string> = {};
      if (data.image) params.img = encodeURIComponent(data.image);
      const animeUrl = data.animeHref?.includes("/anime/")
        ? data.animeHref
        : toAnimeUrl(data.episodeHref) ?? data.animeHref;
      if (animeUrl) params.anime = animeUrl;
      router.push({ pathname: `/watch/${encodeURIComponent(data.episodeHref)}`, params });
    });
    return () => { task.cancel(); sub.remove(); };
  }, [ready]);

  // Update checks (APK first, then OTA)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  // Surface an update prompt at most once per app session, so the foreground
  // re-check below can't nag the user every time they resume the app.
  const updateSurfacedRef = useRef(false);

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
    if (isUpdatePending && !updateSurfacedRef.current) {
      updateSurfacedRef.current = true;
      setUpdateInfo({ type: "ota" });
    }
  }, [isUpdatePending]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    const runApkCheck = async () => {
      if (updateSurfacedRef.current) return true;
      const apk = await checkForApkUpdate();
      if (!cancelled && apk) {
        updateSurfacedRef.current = true;
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
        if (!cancelled && ota) {
          updateSurfacedRef.current = true;
          setUpdateInfo(ota);
        }
      })();
    }, 1200);

    // Re-check whenever the app returns to the foreground. The cold-start check
    // misses two common cases: the user resumed from the background (no cold
    // start), or version.json was still CDN-cached at launch. Guarded to fire
    // only until an update has been surfaced once this session.
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
        <Stack.Screen name="schedule" />
        <Stack.Screen name="profile" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="report" />
        <Stack.Screen name="live" />
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
  const [fontsLoaded] = useFonts({
    Outfit_400Regular,
    Outfit_600SemiBold,
    Outfit_700Bold,
    Outfit_800ExtraBold,
    Outfit_900Black,
    Cairo_500Medium,
    Cairo_600SemiBold,
    Cairo_700Bold,
  });

  // Kick off the ad SDK once the UI is interactive (no-op until ad IDs are
  // configured). Deferring keeps it off the critical first-paint path.
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => { initAds(); });
    return () => task.cancel();
  }, []);

  // Hand off from the native splash to the first real frame the moment fonts
  // are ready — no spinner flash in between.
  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  // Native splash is still covering the screen here, so render nothing rather
  // than a spinner that the user would never actually see.
  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <StatusBar style="light" translucent backgroundColor="transparent" />
      <AuthProvider>
        <SidebarProvider>
          <AuthGate />
        </SidebarProvider>
      </AuthProvider>
      <ScraperHost />
    </SafeAreaProvider>
  );
}

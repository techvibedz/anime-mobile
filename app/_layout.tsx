import { useEffect, useState } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts, Outfit_400Regular, Outfit_600SemiBold, Outfit_700Bold, Outfit_800ExtraBold, Outfit_900Black } from "@expo-google-fonts/outfit";
import { DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold } from "@expo-google-fonts/dm-sans";
import { View, ActivityIndicator } from "react-native";
import { C } from "../lib/theme";
import { AuthProvider, useAuth } from "../lib/auth";
import { pullFavoritesFromCloud } from "../lib/favorites";
import { pullHistoryFromCloud } from "../lib/history";
import { checkForApkUpdate, checkForOtaUpdate } from "../lib/updater";
import type { UpdateInfo } from "../lib/updater";
import { UpdateModal } from "../components/UpdateModal";
import { ScraperHost } from "../lib/scraper";
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

  // Update checks (APK first, then OTA)
  const [updateChecked, setUpdateChecked] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    if (!ready || updateChecked) return;
    setUpdateChecked(true);

    (async () => {
      const apk = await checkForApkUpdate();
      if (apk) {
        setUpdateInfo(apk);
        return;
      }
      const ota = await checkForOtaUpdate();
      if (ota) {
        setUpdateInfo(ota);
      }
    })();
  }, [ready, updateChecked]);

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
        <Stack.Screen name="watch/[episode]" />
        <Stack.Screen name="see-all/[section]" />
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
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
  });

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color={C.accent} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" translucent backgroundColor="transparent" />
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
      <ScraperHost />
    </SafeAreaProvider>
  );
}

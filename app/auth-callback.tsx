import { useEffect, useRef, useState } from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import { router } from "expo-router";
import * as Linking from "expo-linking";
import { supabase } from "../lib/supabase";
import { C } from "../lib/theme";

// Deep-link handler for Supabase auth flows:
//   - Google OAuth redirect (anime-mobile://auth-callback#access_token=...)
//   - Password reset redirect (anime-mobile://auth-callback?code=...)
//
// Handles three arrival modes:
//   (a) Cold-start from deep link  → getInitialURL() returns the URL
//   (b) Warm-start from deep link  → Linking 'url' event fires
//   (c) OAuth already completed inline via openAuthSessionAsync in
//       lib/auth.tsx → supabase session is already set; just redirect
export default function AuthCallback() {
  const [status, setStatus] = useState<"working" | "ok" | "err">("working");
  const [message, setMessage] = useState("Finalizing sign-in…");
  const handled = useRef(false);

  async function processUrl(url: string) {
    if (handled.current) return;
    handled.current = true;
    try {
      const hashPart = url.split("#")[1] ?? "";
      const queryPart = url.split("?")[1]?.split("#")[0] ?? "";
      const params = new URLSearchParams(hashPart || queryPart);

      const access_token = params.get("access_token");
      const refresh_token = params.get("refresh_token");
      const code = params.get("code");
      const errorDescription = params.get("error_description") || params.get("error");

      if (errorDescription) {
        setStatus("err");
        setMessage(decodeURIComponent(errorDescription));
        setTimeout(() => router.replace("/(auth)/welcome"), 2500);
        return;
      }
      if (access_token && refresh_token) {
        const { error } = await supabase.auth.setSession({ access_token, refresh_token });
        if (error) throw error;
        setStatus("ok");
        router.replace("/(tabs)");
        return;
      }
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) throw error;
        setStatus("ok");
        router.replace("/(tabs)");
        return;
      }
      setStatus("err");
      setMessage("Sign-in callback missing tokens");
      setTimeout(() => router.replace("/(auth)/welcome"), 2000);
    } catch (e: any) {
      setStatus("err");
      setMessage(e?.message ?? "Auth callback failed");
      setTimeout(() => router.replace("/(auth)/welcome"), 2500);
    }
  }

  useEffect(() => {
    let cancelled = false;
    let urlSub: { remove: () => void } | null = null;

    (async () => {
      // (c) Maybe the OAuth flow in lib/auth.tsx already set the session
      // via openAuthSessionAsync. If so, we're done.
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) {
        handled.current = true;
        setStatus("ok");
        router.replace("/(tabs)");
        return;
      }

      // (a) Cold-start case
      const initial = await Linking.getInitialURL();
      if (cancelled) return;
      if (initial && initial.includes("auth-callback")) {
        processUrl(initial);
        return;
      }

      // (b) Warm-start case — wait for the url event
      urlSub = Linking.addEventListener("url", (e) => {
        if (e.url && e.url.includes("auth-callback")) {
          processUrl(e.url);
        }
      });

      // Also poll session for ~6s in case OAuth completes via openAuthSession
      // shortly after we mount.
      let elapsed = 0;
      const iv = setInterval(async () => {
        elapsed += 500;
        const { data } = await supabase.auth.getSession();
        if (cancelled) { clearInterval(iv); return; }
        if (data.session) {
          clearInterval(iv);
          handled.current = true;
          setStatus("ok");
          router.replace("/(tabs)");
          return;
        }
        if (elapsed >= 6000) {
          clearInterval(iv);
          if (!handled.current) {
            setStatus("err");
            setMessage("No callback URL detected");
            setTimeout(() => router.replace("/(auth)/welcome"), 2500);
          }
        }
      }, 500);
    })();

    return () => {
      cancelled = true;
      urlSub?.remove();
    };
  }, []);

  return (
    <View style={ss.root}>
      {status === "working" && <ActivityIndicator size="large" color={C.accent} />}
      <Text style={[ss.msg, status === "err" && { color: "#ff6b6b" }]}>{message}</Text>
    </View>
  );
}

const ss = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, alignItems: "center", justifyContent: "center", gap: 16, padding: 24 },
  msg: { color: C.textSecondary, fontSize: 13, textAlign: "center", fontFamily: "DMSans_500Medium" },
});

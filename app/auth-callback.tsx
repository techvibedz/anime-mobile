import { useEffect, useState } from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import { router } from "expo-router";
import * as Linking from "expo-linking";
import { supabase } from "../lib/supabase";
import { C } from "../lib/theme";

// Deep-link handler for Supabase auth flows:
//   - Google OAuth redirect (anime-mobile://auth-callback#access_token=...)
//   - Password reset redirect (anime-mobile://auth-callback?code=...)
// Parses tokens from the URL fragment or query, finalizes the session,
// and routes to the appropriate screen.
export default function AuthCallback() {
  const [status, setStatus] = useState<"working" | "ok" | "err">("working");
  const [message, setMessage] = useState("Finalizing sign-in…");

  useEffect(() => {
    (async () => {
      try {
        const initial = await Linking.getInitialURL();
        const url = initial ?? "";
        if (!url) {
          setStatus("err");
          setMessage("No callback URL detected");
          return;
        }

        // Try fragment first (#access_token=...&refresh_token=...)
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

        // No usable tokens — go back to welcome.
        setStatus("err");
        setMessage("Sign-in callback missing tokens");
        setTimeout(() => router.replace("/(auth)/welcome"), 2000);
      } catch (e: any) {
        setStatus("err");
        setMessage(e?.message ?? "Auth callback failed");
        setTimeout(() => router.replace("/(auth)/welcome"), 2500);
      }
    })();
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

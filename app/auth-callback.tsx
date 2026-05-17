import { useEffect, useState } from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import { router } from "expo-router";
import { supabase } from "../lib/supabase";
import { C } from "../lib/theme";

// Visual landing screen for the auth-callback deep link.
// The actual URL parsing + setSession happens in AuthProvider (lib/auth.tsx)
// via a global Linking listener, so this screen just polls for the session
// to appear and routes accordingly.
export default function AuthCallback() {
  const [status, setStatus] = useState<"working" | "err">("working");
  const [message, setMessage] = useState("Finalizing sign-in…");

  useEffect(() => {
    let cancelled = false;
    let elapsed = 0;

    // Quick initial check.
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) {
        router.replace("/(tabs)");
      }
    });

    // Also subscribe — fires the moment AuthProvider's deep-link handler
    // calls setSession.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      if (cancelled) return;
      if (sess) {
        router.replace("/(tabs)");
      }
    });

    // Safety timeout: bounce back to welcome after 10s if nothing arrived.
    const iv = setInterval(() => {
      elapsed += 500;
      if (elapsed >= 10000) {
        clearInterval(iv);
        if (cancelled) return;
        setStatus("err");
        setMessage("Sign-in did not complete. Please try again.");
        setTimeout(() => router.replace("/(auth)/welcome"), 2000);
      }
    }, 500);

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
      clearInterval(iv);
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

import { useEffect, useState } from "react";
import { View, StyleSheet } from "react-native";
import { router } from "expo-router";
import { supabase } from "../lib/supabase";
import { C } from "../lib/theme";
import { StateView } from "../components/StateView";
import { t } from "../lib/i18n";

// Visual landing screen for the auth-callback deep link.
// The actual URL parsing + setSession happens in AuthProvider (lib/auth.tsx)
// via a global Linking listener, so this screen just polls for the session
// to appear and routes accordingly.
export default function AuthCallback() {
  const [status, setStatus] = useState<"working" | "err">("working");

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
      <StateView icon="log-in-outline" variant={status === "working" ? "loading" : "error"} title={status === "working" ? t.loading : t.signInFailed} message={status === "working" ? undefined : t.authErrors.unknown} />
    </View>
  );
}

const ss = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
});

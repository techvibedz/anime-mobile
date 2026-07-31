import { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { supabase, isSupabaseConfigured } from "./supabase";
import { registerPushTokenAsync, unregisterPushTokenAsync } from "./push";
import { remoteLog, errText, setLogUser } from "./remoteLog";

WebBrowser.maybeCompleteAuthSession();

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  ready: boolean;
  isConfigured: boolean;
  signInWithEmail: (email: string, password: string) => Promise<{ error?: string }>;
  signUpWithEmail: (email: string, password: string) => Promise<{ error?: string; needsConfirmation?: boolean }>;
  signInWithGoogle: () => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<{ error?: string }>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setReady(true);
      return;
    }
    // `ready` flipping to true ONLY here strand a user whose persisted session
    // is corrupted (or whose refresh-token call hangs) on the root spinner
    // forever — a single-user "stuck on loading" with everyone else fine.
    // ponytail: 12s ceiling + local-clear on any failure clears the poisoned
    // token and routes the AuthGate to the welcome screen instead of hanging.
    const fail = () => {
      void supabase.auth.signOut({ scope: "local" }).catch(() => {});
      void remoteLog("error", "auth", "getSession timed out (12s) — cleared local session");
      setReady(true);
    };
    Promise.race([
      supabase.auth.getSession(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("auth-getSession-timeout")), 12000),
      ),
    ])
      .then(({ data }) => {
        setSession(data.session);
        setUser(data.session?.user ?? null);
        setLogUser(data.session?.user ?? null);
        setReady(true);
      })
      .catch(fail);
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      setLogUser(sess?.user ?? null);
    });

    // Global deep-link handler. On Android the OS often hijacks the OAuth
    // redirect (anime-mobile://auth-callback#access_token=...) before
    // openAuthSessionAsync can capture it. Catching it here at app root
    // means we don't depend on any specific screen being mounted.
    async function handleDeepLink(url: string | null) {
      if (!url || !url.includes("auth-callback")) return;
      const hashPart = url.split("#")[1] ?? "";
      const queryPart = url.split("?")[1]?.split("#")[0] ?? "";
      const params = new URLSearchParams(hashPart || queryPart);
      const access_token = params.get("access_token");
      const refresh_token = params.get("refresh_token");
      const code = params.get("code");
      try {
        if (access_token && refresh_token) {
          await supabase.auth.setSession({ access_token, refresh_token });
        } else if (code) {
          await supabase.auth.exchangeCodeForSession(code);
        }
      } catch (e) {
        console.warn("[auth] deep-link session set failed", e);
        void remoteLog("warn", "auth", "deep-link session set failed", { error: errText(e) });
      }
    }
    // Cold start: app launched FROM the deep link.
    Linking.getInitialURL().then(handleDeepLink);
    // Warm start: app already running, OS foregrounds via deep link.
    const urlSub = Linking.addEventListener("url", (e) => { handleDeepLink(e.url); });

    return () => {
      sub.subscription.unsubscribe();
      urlSub.remove();
    };
  }, []);

  // Register this device's Expo push token whenever a user is signed in, so the
  // server can deliver new-episode push even when the app is closed.
  useEffect(() => {
    if (user?.id) void registerPushTokenAsync(user.id);
  }, [user?.id]);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    return { error: error?.message };
  }, []);

  const signUpWithEmail = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
    if (error) return { error: error.message };
    // Supabase requires email confirmation if enabled — no session returned until confirmed
    return { needsConfirmation: !data.session };
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const redirectTo = Linking.createURL("/auth-callback");
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error || !data?.url) return { error: error?.message ?? "Google sign-in failed" };
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== "success" || !result.url) {
      return { error: result.type === "cancel" ? undefined : "Sign-in cancelled" };
    }
    // Parse access token from callback URL fragment (#access_token=...&refresh_token=...)
    const fragment = result.url.split("#")[1] || result.url.split("?")[1] || "";
    const params = new URLSearchParams(fragment);
    const access_token = params.get("access_token");
    const refresh_token = params.get("refresh_token");
    if (!access_token || !refresh_token) {
      return { error: "Could not parse auth tokens from response" };
    }
    const { error: setErr } = await supabase.auth.setSession({ access_token, refresh_token });
    return { error: setErr?.message };
  }, []);

  const signOut = useCallback(async () => {
    if (user?.id) await unregisterPushTokenAsync(user.id);
    await supabase.auth.signOut();
    setLogUser(null);
  }, [user?.id]);

  const sendPasswordReset = useCallback(async (email: string) => {
    const redirectTo = Linking.createURL("/auth-callback");
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
    return { error: error?.message };
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading: !ready,
        ready,
        isConfigured: isSupabaseConfigured,
        signInWithEmail,
        signUpWithEmail,
        signInWithGoogle,
        signOut,
        sendPasswordReset,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase, isSupabaseConfigured, readStoredSession } from "./supabase";
import { registerPushTokenAsync, unregisterPushTokenAsync } from "./push";
import { remoteLog, errText, setLogUser } from "./remoteLog";
import { claimLocalData, releaseLocalData } from "./accountData";
import { flushHistoryCloudPushes } from "./history";
import { flushMangaStore } from "./manga/store";

WebBrowser.maybeCompleteAuthSession();

// Android re-delivers the LAUNCH intent when the app is reopened from recents,
// so getInitialURL() can hand back an auth-callback link from days ago. Feeding
// its long-rotated refresh token to setSession made the server reject it and
// signed the user out. Each callback is applied once; expired ones never.
const HANDLED_AUTH_LINK_KEY = "@auth_handled_link_v1";
async function claimAuthLink(fingerprint: string): Promise<boolean> {
  try {
    if ((await AsyncStorage.getItem(HANDLED_AUTH_LINK_KEY)) === fingerprint) return false;
    await AsyncStorage.setItem(HANDLED_AUTH_LINK_KEY, fingerprint);
  } catch {}
  return true;
}

// True only while the user's own sign-out runs — any other SIGNED_OUT is logged.
let userSigningOut = false;

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  ready: boolean;
  isConfigured: boolean;
  signInWithEmail: (email: string, password: string) => Promise<{ error?: string }>;
  signUpWithEmail: (email: string, password: string) => Promise<{ error?: string; needsConfirmation?: boolean; emailExists?: boolean }>;
  signInWithGoogle: () => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<{ error?: string }>;
  /** Re-send the confirmation link. This project requires email confirmation,
   * so a password sign-in is rejected until the link is opened. */
  resendConfirmation: (email: string) => Promise<{ error?: string }>;
  /** One-time sign-in link — works even when the account is unconfirmed. */
  sendSignInLink: (email: string) => Promise<{ error?: string }>;
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
    // `ready` must never wait on getSession alone — a hung refresh would strand
    // the user on the root spinner (see slowStart below). A different account than the one whose data is on this phone wipes that
    // data BEFORE the user is exposed — every cloud sync keys off `user`, so
    // nothing of the previous account can merge into this one. Serialized so a
    // getSession + INITIAL_SESSION pair can't interleave.
    let claimChain: Promise<void> = Promise.resolve();
    const applySession = (sess: Session | null) => {
      const next = sess?.user ?? null;
      claimChain = claimChain
        .then(() => (next ? claimLocalData(next.id) : undefined))
        .catch(() => {})
        .then(() => {
          setSession(sess);
          setUser(next);
          setLogUser(next);
        });
      return claimChain;
    };
    // getSession() refreshes an expired access token over the network (auth-js
    // retries for up to ~30s). It used to race a 12s timer that then CLEARED the
    // session — anyone opening the app after an hour on a slow link was signed
    // out. Now a slow start shows the session already on disk and lets the
    // refresh finish in the background; only the server can end a session.
    const slowStart = setTimeout(() => {
      void readStoredSession()
        .then((stored) => applySession(stored))
        .finally(() => setReady(true));
      void remoteLog("warn", "auth", "getSession slow (12s) — using stored session");
    }, 12000);
    supabase.auth.getSession()
      .then(({ data }) => applySession(data.session))
      .catch(() => readStoredSession().then((stored) => applySession(stored)))
      .finally(() => {
        clearTimeout(slowStart);
        setReady(true);
      });
    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      if (event === "SIGNED_OUT" && !userSigningOut) {
        void remoteLog("warn", "auth", "session ended without user sign-out");
      }
      void applySession(sess);
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
      const expiresAt = Number(params.get("expires_at"));
      if (access_token && expiresAt && expiresAt * 1000 < Date.now()) return;
      const fingerprint = refresh_token || code;
      if (!fingerprint || !(await claimAuthLink(fingerprint))) return;
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
  // server can deliver new-episode push even when the app is closed. Deferred
  // a few seconds so the native token fetch + upsert land after the startup
  // notification prompt (which owns the permission ask), not on the first taps.
  useEffect(() => {
    const id = user?.id;
    if (!id) return;
    const timer = setTimeout(() => { void registerPushTokenAsync(id); }, 4000);
    return () => clearTimeout(timer);
  }, [user?.id]);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    return { error: error?.message };
  }, []);

  const signUpWithEmail = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      // Send the confirmation link BACK INTO THE APP. Without this GoTrue
      // redirects to the project's Site URL — a website that has nothing to do
      // with this flow — so the user "confirms" on the web and the app never
      // gets a session (the account then looks permanently unconfirmed).
      options: { emailRedirectTo: Linking.createURL("/auth-callback") },
    });
    if (error) return { error: error.message };
    // Supabase answers "success" with a user that has NO identities when the
    // address is already registered (it refuses to confirm that to the caller).
    // Left alone the screen told an existing user "check your inbox" forever.
    if (data.user && (data.user.identities?.length ?? 0) === 0) return { emailExists: true };
    // Confirmation is enabled on this project — no session until confirmed.
    return { needsConfirmation: !data.session };
  }, []);

  const resendConfirmation = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: email.trim(),
      options: { emailRedirectTo: Linking.createURL("/auth-callback") },
    });
    return { error: error?.message };
  }, []);

  const sendSignInLink = useCallback(async (email: string) => {
    // shouldCreateUser:false — this is a SIGN-IN link for an existing account,
    // never a registration path (GoTrue silently no-ops for unknown addresses).
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false, emailRedirectTo: Linking.createURL("/auth-callback") },
    });
    return { error: error?.message };
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
    // The same callback may also arrive via the deep-link listener — apply once.
    if (!(await claimAuthLink(refresh_token))) return {};
    const { error: setErr } = await supabase.auth.setSession({ access_token, refresh_token });
    return { error: setErr?.message };
  }, []);

  const signOut = useCallback(async () => {
    if (user?.id) await unregisterPushTokenAsync(user.id);
    // Last progress reaches the account before the device copy is wiped.
    flushMangaStore();
    await Promise.race([
      flushHistoryCloudPushes(),
      new Promise((resolve) => setTimeout(resolve, 4000)),
    ]).catch(() => {});
    userSigningOut = true;
    try {
      await supabase.auth.signOut();
    } finally {
      userSigningOut = false;
    }
    await releaseLocalData();
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
        resendConfirmation,
        sendSignInLink,
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

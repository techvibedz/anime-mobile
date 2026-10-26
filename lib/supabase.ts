import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { createClient } from "@supabase/supabase-js";
import type { Session } from "@supabase/supabase-js";
import { pruneCacheStorage } from "./storageMaintenance";

/**
 * Supabase client for the anime mobile app.
 *
 * Configuration can be overridden by env vars at build time:
 *   EXPO_PUBLIC_SUPABASE_URL=<your project URL>
 *   EXPO_PUBLIC_SUPABASE_ANON_KEY=<your project anon key>
 *
 * The public project URL and anon key remain bundled as OTA-safe defaults.
 */
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || "https://iwrphgttbjqifstqttqm.supabase.co";
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml3cnBoZ3R0YmpxaWZzdHF0dHFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMTQ1NTgsImV4cCI6MjA5NDU5MDU1OH0.eKooQPiqXAdBvnjvVCWW837pFbXjVdQ_xywinm82EUE";

// Session storage that survives a full AsyncStorage DB. Each token refresh
// ROTATES the refresh token; if the write of the new one fails (Android's
// 6 MB cap on older builds), the next cold start loads a refresh token the
// server has already retired → "Already Used" → the user is signed out.
// On a failed write, drop re-fetchable caches and try once more.
const authStorage = {
  getItem: (key: string) => AsyncStorage.getItem(key),
  removeItem: (key: string) => AsyncStorage.removeItem(key),
  async setItem(key: string, value: string) {
    try {
      await AsyncStorage.setItem(key, value);
    } catch {
      await pruneCacheStorage();
      await AsyncStorage.setItem(key, value);
    }
  },
};

// auth-js wipes the session on ANY refresh failure it does not class as
// "retryable" — and a non-JSON body (ISP block page, captive portal, CF 429 /
// HTML 500) is classed as fatal. That signed users out at random on flaky
// networks. Only a real GoTrue JSON 4xx (revoked / reused refresh token) may
// end the session; every other failure is reported as a retryable 503 so the
// session is kept and refreshed again later.
async function authSafeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const res = await fetch(input, init);
  if (res.ok || !url.includes("/auth/v1/token") || !url.includes("grant_type=refresh_token")) return res;
  const isJson = (res.headers.get("content-type") ?? "").includes("json");
  const genuine = isJson && res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429;
  if (genuine) return res;
  return new Response(JSON.stringify({ message: `transient refresh failure (${res.status})` }), {
    status: 503,
    headers: { "content-type": "application/json" },
  });
}

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    auth: {
      storage: authStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
    global: { fetch: authSafeFetch },
  },
);

// Supabase's React Native guidance: refresh only while foregrounded. A refresh
// fired as Android freezes/kills the backgrounded process can rotate the token
// server-side without the new one ever being saved.
AppState.addEventListener("change", (state) => {
  if (state === "active") void supabase.auth.startAutoRefresh();
  else void supabase.auth.stopAutoRefresh();
});

const AUTH_STORAGE_KEY =
  (supabase.auth as unknown as { storageKey?: string }).storageKey ??
  `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`;

/** The session exactly as persisted on disk — no lock, no network. Used when
 * getSession() is slow (offline refresh) so the user isn't shown as signed out. */
export async function readStoredSession(): Promise<Session | null> {
  try {
    const raw = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
    const sess = raw ? (JSON.parse(raw) as Session) : null;
    return sess?.access_token && sess.refresh_token && sess.user?.id ? sess : null;
  } catch {
    return null;
  }
}

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/** Read the persisted client session without a remote Auth user request. */
export async function getSessionUser() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}

/** Base URL for invoking Edge Functions, e.g. `${SUPABASE_FUNCTIONS_URL}/episode-notifier`. */
export const SUPABASE_FUNCTIONS_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1` : "";

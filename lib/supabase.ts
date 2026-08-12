import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

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

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/** Read the persisted client session without a remote Auth user request. */
export async function getSessionUser() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}

/** Base URL for invoking Edge Functions, e.g. `${SUPABASE_FUNCTIONS_URL}/episode-notifier`. */
export const SUPABASE_FUNCTIONS_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1` : "";

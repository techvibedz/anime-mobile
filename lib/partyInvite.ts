// Pending watch-party invite stash.
//
// A deep link can arrive while the user is signed OUT: the watch-party screen
// stashes the code, AuthGate redirects to the auth flow, and after sign-in it
// routes back into /watch-party, which consumes the stash. Memory-first so the
// common same-session trip is synchronous; AsyncStorage so the code survives an
// app restart between the tap and the sign-in.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { normalizePartyCode } from "./watchPartySync";

const KEY = "@wp_pending_invite";
let pending: string | null = null;

/** Stash a code (validated). A null/invalid input clears the stash. */
export function setPendingInvite(raw: string): void {
  pending = normalizePartyCode(raw);
  if (pending) AsyncStorage.setItem(KEY, pending).catch(() => {});
  else AsyncStorage.removeItem(KEY).catch(() => {});
}

/** Consume the stored code (memory first, disk fallback). */
export async function takePendingInvite(): Promise<string | null> {
  if (!pending) {
    try {
      const stored = await AsyncStorage.getItem(KEY);
      if (stored) pending = normalizePartyCode(stored);
    } catch {}
  }
  const code = pending;
  if (code) {
    pending = null;
    AsyncStorage.removeItem(KEY).catch(() => {});
  }
  return code;
}

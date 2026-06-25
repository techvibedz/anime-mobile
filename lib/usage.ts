// Persistent app-usage tracking — last time each user opened the app and how
// much time they've spent inside it. Powers the admin "all users" screen
// (app/users.tsx). Complements lib/presence.ts, which only knows who's online
// *right now* (ephemeral); this module accumulates durable totals in Supabase.
//
// How time is counted: a "session" begins when the app becomes active and ends
// when it backgrounds. While active we accrue wall-clock seconds and flush them
// to the `usage_stats` table — on a 60s heartbeat (so a hard-kill loses at most
// a minute) and again on background. All writes go through the record_usage()
// RPC, which can only ever touch the caller's own row.

import type { User } from "@supabase/supabase-js";
import { supabase, isSupabaseConfigured } from "./supabase";

const FLUSH_INTERVAL_MS = 60_000;

let activeUser: User | null = null;
// Timestamp (ms) from which unflushed foreground seconds have been accruing.
// null = no active session.
let accrualStart: number | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;

function metaOf(user: User): { email: string; name: string; avatar: string | null } {
  const meta = user.user_metadata ?? {};
  const name =
    meta.full_name || meta.name || (user.email ? user.email.split("@")[0] : "User");
  const avatar = meta.avatar_url || meta.picture || null;
  return { email: user.email ?? "", name, avatar };
}

/** Today's date in the device's LOCAL timezone as "YYYY-MM-DD". */
function localDay(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

async function call(seconds: number, newSession: boolean): Promise<void> {
  if (!isSupabaseConfigured || !activeUser) return;
  const { email, name, avatar } = metaOf(activeUser);
  try {
    await supabase.rpc("record_usage", {
      p_seconds: seconds,
      p_email: email,
      p_name: name,
      p_avatar: avatar,
      p_new_session: newSession,
      p_local_day: localDay(),
    });
  } catch {
    // Network/auth hiccups are non-fatal — usage stats are best-effort.
  }
}

/** Push the seconds accrued since the last flush, then reset the accrual point. */
export async function flushUsage(): Promise<void> {
  if (accrualStart == null) return;
  const now = Date.now();
  const elapsed = Math.floor((now - accrualStart) / 1000);
  accrualStart = now;
  if (elapsed > 0) await call(elapsed, false);
}

/**
 * Begin (or resume) counting usage for this user. Idempotent while a session is
 * already running for the same user — repeated "active" events won't double the
 * session counter. Marks a new session + refreshes last_seen on a fresh start.
 */
export async function startUsageSession(user: User): Promise<void> {
  if (activeUser && activeUser.id === user.id && accrualStart != null) return;
  await endUsageSession();
  activeUser = user;
  accrualStart = Date.now();
  if (!flushTimer) {
    flushTimer = setInterval(() => {
      void flushUsage();
    }, FLUSH_INTERVAL_MS);
  }
  await call(0, true);
}

/** End the current session: flush any pending seconds and stop the heartbeat. */
export async function endUsageSession(): Promise<void> {
  await flushUsage();
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  accrualStart = null;
  activeUser = null;
}

export interface UsageRow {
  userId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  /** Cumulative seconds spent in the app, across all sessions. */
  totalSeconds: number;
  /** Number of foreground sessions. */
  sessions: number;
  /** ISO time the user was first tracked (null = never opened the new build). */
  firstSeenAt: string | null;
  /** ISO time the app was last opened (falls back to last sign-in / sign-up). */
  lastSeenAt: string;
  /** ISO time the account was created. */
  createdAt: string | null;
}

/**
 * Admin-only: fetch EVERY registered user (from auth.users), most-recently-
 * active first, with their usage stats (zeroed for users who haven't opened
 * the new build yet). Goes through the admin_list_users() RPC, which enforces
 * the admin email — non-admin callers get an exception, surfaced here as [].
 */
export async function fetchAllUsage(): Promise<UsageRow[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase.rpc("admin_list_users");
  if (error || !data) return [];
  return (data as any[]).map((r) => ({
    userId: r.user_id,
    email: r.email ?? "",
    name: r.name ?? "",
    avatarUrl: r.avatar_url ?? null,
    totalSeconds: Number(r.total_seconds) || 0,
    sessions: Number(r.sessions) || 0,
    firstSeenAt: r.first_seen_at ?? null,
    lastSeenAt: r.last_seen_at,
    createdAt: r.created_at ?? null,
  }));
}

export interface DailyRow {
  /** Local calendar day, "YYYY-MM-DD". */
  day: string;
  /** Seconds spent in the app that day. */
  seconds: number;
  /** Number of times the app was opened (foreground sessions) that day. */
  opens: number;
}

/**
 * Admin-only: a single user's day-by-day usage, newest day first. Enforced by
 * the admin email inside admin_user_daily(); non-admin callers get [].
 */
export async function fetchUserDaily(userId: string): Promise<DailyRow[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase.rpc("admin_user_daily", { p_user_id: userId });
  if (error || !data) return [];
  return (data as any[]).map((r) => ({
    day: r.day,
    seconds: Number(r.seconds) || 0,
    opens: Number(r.opens) || 0,
  }));
}

// Remote device logger — ships failure traces to Supabase so the admin can
// diagnose "stuck on loading" / scrape-fail issues WITHOUT the user filing a
// manual report. Write-only: users never see these logs; only the admin reads
// them (via the admin_list_logs RPC, gated by the email allowlist).
//
// PERF: `remoteLog` itself does NO network I/O beyond the one insert. The
// current user id/email is pushed in by AuthProvider (setLogUser) whenever the
// session changes, so we never call supabase.auth.getUser() per-log (that was
// a network round-trip on EVERY failure — a real perf regression on slow links).
// A dedup cooldown also stops a tight retry loop from flooding near-identical
// rows: the same (tag, message) inside 5s is dropped as a duplicate.

// NOTE: react-native / expo-device / supabase are required LAZILY below, not
// imported at the top. lib/scraper/direct.ts imports this module, and
// seasonNum.test.ts imports direct.ts under plain node (tsx) — a static
// `import "react-native"` explodes there (Flow `typeof` syntax). Lazy require
// keeps the module importable anywhere; in node it just logs without device
// metadata (and skips the network insert if supabase can't load).

import appVersion from "../version.json";

export type LogLevel = "info" | "warn" | "error";
export type LogTag = "auth" | "home" | "scraper" | "video" | "app";

let _env: {
  supabase: typeof import("./supabase").supabase;
  configured: boolean;
  platform: string;
  osVersion: string;
  device: string | null;
} | null = null;

function env() {
  if (_env) return _env;
  try {
    // Literal-string requires: Metro bundles these statically, tsx catches.
    const { Platform } = require("react-native");
    const Device = require("expo-device");
    const { supabase, isSupabaseConfigured } = require("./supabase");
    _env = {
      supabase,
      configured: isSupabaseConfigured,
      platform: Platform.OS,
      osVersion: String(Platform.Version),
      device:
        [Device.manufacturer, Device.modelName].filter(Boolean).join(" ").trim() || null,
    };
  } catch {
    // No RN runtime (node tests / scripts) — stays null, remoteLog no-ops.
    _env = null;
  }
  return _env;
}

// Pushed in by AuthProvider on session change — keeps the logger off the
// getUser() hot path entirely.
let _userId: string | null = null;
let _email: string | null = null;

/** Called by AuthProvider whenever the session changes. Synchronous, free. */
export function setLogUser(user: { id: string; email?: string } | null): void {
  _userId = user?.id ?? null;
  _email = user?.email ?? null;
}

// Dedup: drop the same (tag, message) within this window so a retry loop
// (home retries up to 5×) doesn't insert 5 near-identical rows. 5s is enough
// to collapse a tight retry burst while still letting genuinely separate
// failures (minutes apart) through.
const DEDUP_MS = 5000;
const _recent = new Map<string, number>();

function isDuplicate(tag: LogTag, message: string): boolean {
  const key = tag + "|" + message;
  const now = Date.now();
  const last = _recent.get(key);
  if (last && now - last < DEDUP_MS) return true;
  _recent.set(key, now);
  // Bounded: prune entries older than the window so the map can't grow.
  if (_recent.size > 200) {
    for (const [k, ts] of _recent) if (now - ts > DEDUP_MS) _recent.delete(k);
  }
  return false;
}

/** Log a remote event. Fire-and-forget; never throws, rejects, or awaits.
 *  Safe to call from render paths, catch blocks, and hot loops. */
export function remoteLog(
  level: LogLevel,
  tag: LogTag,
  message: string,
  context?: Record<string, unknown>,
): void {
  if (isDuplicate(tag, message)) return;
  const e = env();
  if (!e || !e.configured) return;
  e.supabase
    .from("device_logs")
    .insert({
      user_id: _userId,
      email: _email,
      level,
      tag,
      message,
      context: context ?? null,
      app_version: appVersion.version,
      platform: e.platform,
      device: e.device,
      os_version: e.osVersion,
    })
    .then(() => {}, () => {});
}

/** Canonicalize an unknown catch value to a short string for the message. */
export function errText(e: unknown): string {
  if (!e) return "unknown";
  if (e instanceof Error) return e.message;
  return String(e).slice(0, 300);
}
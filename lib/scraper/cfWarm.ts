// Background Cloudflare warm-up (Phase 2 of the speed pass).
//
// Hosts that Cloudflare challenged recently (remembered across launches by
// cfGate.ts) get their challenge solved in the background shortly after
// startup, and again when the app returns to the foreground after the
// clearance cookie has gone stale (~25 min). One hidden-WebView page load per
// host; the user's first real request on that host then finds a fresh
// cf_clearance in the shared cookie jar instead of paying the 10–15s challenge
// in front of them.
//
// Hosts that were never challenged are never warmed: no WebView is created at
// launch for users whose network passes the sources directly.

import { AppState, type AppStateStatus } from "react-native";
import { enqueue } from "./bus";
import { hostsNeedingWarm, loadCfGate } from "./cfGate";
import { identifySource } from "./sourceDomains";
import { WARM_CF } from "./scripts";
import { flushTimingSummary, recordTiming } from "./timing";
import { remoteLog } from "../remoteLog";

const FIRST_WARM_DELAY_MS = 4000;
const RECHECK_THROTTLE_MS = 5 * 60_000;

let started = false;
let lastCheckAt = 0;
const inFlight = new Set<string>();

async function warmHost(host: string): Promise<void> {
  if (inFlight.has(host)) return;
  inFlight.add(host);
  const t0 = Date.now();
  try {
    // Background priority: real user work always goes first, and the host
    // keeps a slot reserved for priority jobs anyway.
    await enqueue({ url: `https://${host}/`, injectAfter: WARM_CF, timeoutMs: 30_000 });
    recordTiming({ kind: "cf-warm", host, ms: Date.now() - t0, outcome: "ok" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    recordTiming({ kind: "cf-warm", host, ms: Date.now() - t0, outcome: /challenge/i.test(msg) ? "cf" : /timeout|timed out/i.test(msg) ? "timeout" : "error" });
  } finally {
    inFlight.delete(host);
  }
}

async function checkAndWarm(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastCheckAt < RECHECK_THROTTLE_MS) return;
  lastCheckAt = now;
  await loadCfGate();
  const hosts = hostsNeedingWarm().filter((h) => identifySource(`https://${h}/`) !== null);
  for (const host of hosts) void warmHost(host);
}

/** Start the warm-up scheduler. Call once from the root layout; returns a cleanup. */
export function startCfWarmup(): () => void {
  if (started) return () => {};
  started = true;
  const timer = setTimeout(() => { void checkAndWarm(true).catch(() => {}); }, FIRST_WARM_DELAY_MS);
  const sub = AppState.addEventListener("change", (s: AppStateStatus) => {
    if (s === "active") void checkAndWarm().catch(() => {});
    else if (s === "background") {
      // One aggregated timing row per ~30 min, so real-device scrape speed
      // reaches the admin (device_logs) without a row per request.
      flushTimingSummary((message, context) => remoteLog("info", "scraper", message, context));
    }
  });
  return () => {
    started = false;
    clearTimeout(timer);
    sub.remove();
  };
}

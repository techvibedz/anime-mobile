// Cloudflare gate memory (Phase 2 of the speed pass).
//
// When a plain fetch to a source host comes back as a Cloudflare challenge, the
// host is marked BLOCKED for a few minutes. While blocked, the direct path skips
// that host entirely and the caller falls straight through to the hidden
// WebView. Without this, every request in a burst paid a doomed direct GET
// first (and on anime3rb burned the shared ~48 req/min rate budget doing it).
//
// The WebView and RN fetch share Android's cookie jar, and the scraper sends
// the same User-Agent on both, so once a WebView job on that host finishes
// (markCfCleared), the cf_clearance cookie is usable by the direct path again:
// the block is lifted and the next request tries the fast path once more. If
// Cloudflare still rejects it, the host is simply re-blocked.
//
// Hosts that were challenged recently are remembered across launches
// ("CF-prone") so cfWarm.ts can solve the challenge in the background right
// after startup, before the user asks for anything from that host.
//
// Pure apart from a lazily-required AsyncStorage, so node tests can load it.

const BLOCK_MS = 4 * 60_000;
/** A host challenged within this window counts as CF-prone for launch warm-up. */
const PRONE_MS = 3 * 24 * 60 * 60_000;
const STORAGE_KEY = "@cf_gate_prone_v1";

type HostState = { blockedUntil: number; lastBlockedAt: number; lastClearedAt: number; persistedAt: number };

const hosts = new Map<string, HostState>();
let loaded = false;
let loadPromise: Promise<void> | null = null;

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function state(host: string): HostState {
  let s = hosts.get(host);
  if (!s) {
    s = { blockedUntil: 0, lastBlockedAt: 0, lastClearedAt: 0, persistedAt: 0 };
    hosts.set(host, s);
  }
  return s;
}

function storage(): { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void> } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@react-native-async-storage/async-storage");
    return mod?.default ?? mod ?? null;
  } catch {
    return null;
  }
}

/** Load the persisted CF-prone hosts. Safe to call repeatedly. */
export function loadCfGate(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const raw = await storage()?.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as Record<string, number>) : {};
      const now = Date.now();
      for (const [host, at] of Object.entries(parsed)) {
        if (typeof at === "number" && now - at < PRONE_MS) {
          const s = state(host);
          s.lastBlockedAt = Math.max(s.lastBlockedAt, at);
        }
      }
    } catch { /* corrupt/missing: start empty */ }
    loaded = true;
  })();
  return loadPromise;
}

function persist(): void {
  const now = Date.now();
  const out: Record<string, number> = {};
  for (const [host, s] of hosts) if (s.lastBlockedAt && now - s.lastBlockedAt < PRONE_MS) out[host] = s.lastBlockedAt;
  void storage()?.setItem(STORAGE_KEY, JSON.stringify(out)).catch(() => {});
}

/** A direct fetch to this URL's host just received a Cloudflare challenge. */
export function markCfBlocked(url: string, now = Date.now()): void {
  const host = hostnameOf(url);
  if (!host) return;
  const s = state(host);
  s.blockedUntil = now + BLOCK_MS;
  s.lastBlockedAt = now;
  // Persist on the first block of a host, then at most every 10 minutes.
  if (now - s.persistedAt > 10 * 60_000) {
    s.persistedAt = now;
    persist();
  }
}

/** A real browser just finished a page on this host: its cookies are fresh. */
export function markCfCleared(url: string, now = Date.now()): void {
  const host = hostnameOf(url);
  if (!host) return;
  const s = hosts.get(host);
  // Only hosts that were challenged at some point are tracked.
  if (!s) return;
  s.blockedUntil = 0;
  s.lastClearedAt = now;
}

/** True while direct fetches to this host should be skipped. */
export function isCfBlocked(url: string, now = Date.now()): boolean {
  const host = hostnameOf(url);
  if (!host) return false;
  const s = hosts.get(host);
  return !!s && s.blockedUntil > now;
}

/**
 * Hosts worth warming in the background: challenged within the last few days
 * and not cleared by a browser within `freshMs` (Cloudflare clearance cookies
 * typically last ~30 minutes, so 25 minutes refreshes them just before expiry).
 */
export function hostsNeedingWarm(freshMs = 25 * 60_000, now = Date.now()): string[] {
  const out: string[] = [];
  for (const [host, s] of hosts) {
    if (!s.lastBlockedAt || now - s.lastBlockedAt >= PRONE_MS) continue;
    if (s.lastClearedAt && now - s.lastClearedAt < freshMs) continue;
    out.push(host);
  }
  return out;
}

/** Snapshot for the debug screen. */
export function cfGateSnapshot(now = Date.now()): { host: string; blocked: boolean; blockedForS: number; lastBlockedMinAgo: number | null; lastClearedMinAgo: number | null }[] {
  return [...hosts].map(([host, s]) => ({
    host,
    blocked: s.blockedUntil > now,
    blockedForS: Math.max(0, Math.round((s.blockedUntil - now) / 1000)),
    lastBlockedMinAgo: s.lastBlockedAt ? Math.round((now - s.lastBlockedAt) / 60_000) : null,
    lastClearedMinAgo: s.lastClearedAt ? Math.round((now - s.lastClearedAt) / 60_000) : null,
  }));
}

/** Test hook. */
export function _resetCfGate(): void {
  hosts.clear();
  loaded = false;
  loadPromise = null;
}

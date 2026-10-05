// Pure helpers for the silent next-episode prefetch (feature: صفر انتظار).
// Framework-free so the selection logic stays unit-testable.

export type PrefetchServerLike = {
  provider?: string;
  iframeUrl?: string;
  quality?: string;
};

/** Seconds of video to pre-buffer into the expo-video disk cache. */
export const PREFETCH_BUFFER_SECONDS = 120;

/** Hard cap on how long a hidden prefetch player may live, in ms. */
export const PREFETCH_MAX_MS = 90_000;

/**
 * Pick the server to pre-buffer from an anime3rb server list. Only vid3rb is
 * eligible: it resolves with a plain static GET (no WebView slot) and ranks
 * first for reliability, so prefetching anything else would burn scrape time
 * for a worse stream.
 */
export function choosePrefetchServer<T extends PrefetchServerLike>(
  servers: readonly T[],
): T | null {
  for (const server of servers) {
    if (server && server.provider === "vid3rb" && server.iframeUrl) return server;
  }
  return null;
}

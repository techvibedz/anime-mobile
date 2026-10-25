// Silent next-episode prefetch (صفر انتظار).
//
// While an episode plays, resolve the NEXT episode's anime3rb (vid3rb) direct
// stream with plain HTTP and pre-buffer ~2 minutes into the expo-video disk
// cache using a muted, viewless player. When the real player opens the same
// URL, the first segments come off disk instead of the throttled CDN.
//
// All of this is OTA-safe: the disk cache and useCaching already exist in the
// shipped native binary (expo-video), and no WebView slot is consumed.
// Best-effort by design: signed URLs may rotate, so a miss just means the next
// episode starts normally.

import { AppState } from "react-native";
import { createVideoPlayer, type VideoPlayer } from "expo-video";
import { fetchAnime3rbServers, resolveVideo } from "./api";
import { getPrefetchNext } from "./settings";
import { videoContentType, videoPlaybackHeaders } from "./videoProviders";
import { PREFETCH_BUFFER_SECONDS, PREFETCH_MAX_MS, choosePrefetchServer } from "./prefetchPlan";

type ActivePrefetch = {
  key: string;
  player: VideoPlayer;
  timer: ReturnType<typeof setTimeout>;
};

let active: ActivePrefetch | null = null;
// Bumped on every call so a slow invocation from a previous episode can never
// install (or cancel) the player belonging to the current one.
let generation = 0;

/** Release the hidden player and clear its timer. Safe to call any time. */
export function stopPrefetch(): void {
  // Also void any start still awaiting settings/resolution: leaving the watch
  // screen mid-warm-up used to install the hidden player AFTER this ran, and it
  // kept the vid3rb file's only connection busy (503) when the episode reopened.
  generation++;
  if (!active) return;
  const { player, timer } = active;
  active = null;
  clearTimeout(timer);
  try { player.pause(); } catch {}
  try { player.release(); } catch {}
}

/**
 * Warm the next episode end-to-end: a3rb server list -> vid3rb direct URL ->
 * hidden muted playback with disk caching. Single-flight per episode key;
 * callers should invoke it fire-and-forget.
 */
export async function prefetchNextEpisode(opts: {
  animeTitle: string;
  epNum: number;
  /** Re-checked before any expensive step + right before buffering starts. */
  shouldRun?: () => boolean;
}): Promise<void> {
  const { animeTitle, epNum, shouldRun } = opts;
  if (!animeTitle || !Number.isFinite(epNum) || epNum < 1) return;
  const key = `${animeTitle.toLowerCase().trim()}#${epNum}`;
  if (active?.key === key) return;
  const gen = ++generation;
  const stale = () => gen !== generation;
  if (!(await getPrefetchNext())) return;
  if (stale() || (shouldRun && !shouldRun())) return;

  try {
    const servers = await fetchAnime3rbServers(animeTitle, epNum);
    if (stale() || !(await getPrefetchNext())) return;
    if (shouldRun && !shouldRun()) return;

    const pick = choosePrefetchServer(servers);
    if (!pick) return;

    const result = await resolveVideo(pick.iframeUrl, "vid3rb");
    if (stale()) return;
    if (!result.success || !result.data?.videoUrl) return;
    if (shouldRun && !shouldRun()) return;

    startHiddenBuffer(key, result.data.videoUrl, pick.iframeUrl, "vid3rb");
  } catch {
    // Best-effort: prefetch failures must never surface anywhere.
  }
}

function startHiddenBuffer(key: string, videoUrl: string, iframeUrl: string, provider: string): void {
  stopPrefetch();
  const source = {
    uri: videoUrl,
    headers: videoPlaybackHeaders(videoUrl, iframeUrl, provider),
    contentType: videoContentType(videoUrl, provider),
    useCaching: true,
  };
  const player = createVideoPlayer(source);
  const timer = setTimeout(() => stopPrefetch(), PREFETCH_MAX_MS);
  active = { key, player, timer };
  try {
    player.muted = true;
    player.bufferOptions = {
      preferredForwardBufferDuration: PREFETCH_BUFFER_SECONDS,
      prioritizeTimeOverSizeThreshold: true,
    };
    player.play();
  } catch {
    stopPrefetch();
  }
}

/**
 * Warm an already-resolved stream (the server picker's top anime3rb entry)
 * into the disk cache while the user is still choosing. Long movies carry a
 * ~9 MB MP4 index that must download before the first frame on vid3rb's
 * ~0.9 MB/s per-file throttle; caching it here makes the tap start at once.
 * Callers MUST stopPrefetch() before real playback: the CDN answers 503 to a
 * second concurrent connection on the same file.
 */
export async function prefetchStream(videoUrl: string, iframeUrl: string, provider: string): Promise<void> {
  if (!videoUrl || active?.key === videoUrl) return;
  const gen = ++generation;
  if (!(await getPrefetchNext()) || gen !== generation) return;
  startHiddenBuffer(videoUrl, videoUrl, iframeUrl, provider);
}

// Backgrounding must never keep the hidden player downloading: it has no
// VideoView, so expo-video's own app-background pause never reaches it.
AppState.addEventListener("change", (state) => {
  if (state !== "active") stopPrefetch();
});

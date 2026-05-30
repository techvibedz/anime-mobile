// Remote video proxy (Cloudflare Worker or the Express /api/proxy-video route).
// The native player can't inject per-host Referer / retry strategies / rewrite
// HLS playlists — the proxy does. See proxy/worker.js.
//
// Set EXPO_PUBLIC_VIDEO_PROXY at build/OTA time, or replace the fallback below
// with your deployed URL. Point it at the request entrypoint that accepts
// ?url=<video> (getProxyUrl appends the query):
//   Worker:  https://pantoufa-video-proxy.<sub>.workers.dev
//   Express: https://<host>/api/proxy-video
export const VIDEO_PROXY_BASE =
  process.env.EXPO_PUBLIC_VIDEO_PROXY ||
  "https://xpirox-pantoufa.hf.space/api/proxy-video";

// Hosts that refuse playback from the native player without a proxy
// (Referer-gated / non-standard port / Cloudflare). Everything else plays
// directly.
const PROXY_HOSTS =
  /mp4upload|streamwish|hgcloud|wishfast|wishembed|jwembed|hlswish|vibuxer|audinifer|masukestin|hanerix|swhoi|streamruby|playerwish|voe\.|anime4up|dood|uqload/i;

export function needsProxy(videoUrl: string): boolean {
  if (!videoUrl || !VIDEO_PROXY_BASE) return false;
  // HLS playlists always go through the proxy so segment sub-requests inherit
  // the right Referer (the player fetches segments itself, header-less).
  if (/\.m3u8(\?|$)/i.test(videoUrl)) return true;
  try {
    return PROXY_HOSTS.test(new URL(videoUrl).hostname);
  } catch {
    return false;
  }
}

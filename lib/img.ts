// Poster image sizing.
//
// Source posters come from raw WordPress hosts (witanime.*, w1.anime4up.rest,
// images.anime3rb.com), often at full resolution — crisp but heavy (50–100 KB+)
// which taxes scroll, decode and memory for a screen full of cards.
//
// witanime.* posters can be re-served at the EXACT display size, as WebP, through
// Jetpack Photon (`i0.wp.com`) — the origin's own CDN, already implied by the
// wp-content URL. No extra dependency, no Cloudflare problem, ~70–85% fewer bytes
// AND sharper-at-display-size than a downscaled full-res JPEG.
//
// Tested: anime4up + anime3rb return 403 through Photon (and wsrv.nl times out),
// so those pass through untouched. Applied at RENDER time, not scrape time, so it
// also right-sizes the full-res URLs already persisted in favorites /
// watch_history / metadata cache — one OTA fixes them all. Scrape-time
// `_upgradeImg` still stores the canonical full-res URL; each consumer sizes it.

// Photon only serves the witanime WordPress origins for us. Match every TLD.
const PHOTON_OK = /(^|\.)witanime\./i;

// Snap to a small set of widths so slightly different card widths across screens
// don't fragment the disk cache with near-duplicate downloads.
const BUCKETS = [180, 240, 320, 420, 560, 800, 1200];
function bucketPx(px: number, maxPx: number): number {
  for (const b of BUCKETS) if (b >= px) return Math.min(b, maxPx);
  return maxPx;
}

/** Pure: wrap a witanime URL in Photon at `targetPx` wide, else return unchanged. */
export function buildPhotonUrl(src: string, targetPx: number, maxPx = 800): string {
  let u: URL;
  try { u = new URL(src); } catch { return src; }
  if (!PHOTON_OK.test(u.hostname)) return src;
  return `https://i0.wp.com/${u.hostname}${u.pathname}?w=${bucketPx(targetPx, maxPx)}&quality=75&strip=all&ssl=1`;
}

/**
 * Poster URL sized for a `width`-dp display slot. Caps device pixel ratio at 2×
 * (a 2:3 poster gains nothing from 3× density). Returns undefined for empty input,
 * the raw URL when width is unknown or the host isn't Photon-serviceable.
 */
export function posterUrl(src?: string | null, width?: number, maxPx = 800): string | undefined {
  if (!src) return undefined;
  if (!width) return src;
  // Lazy require so pure helpers stay importable in node (tests) without RN.
  const dpr = Math.min(require("react-native").PixelRatio.get() || 2, 2);
  return buildPhotonUrl(src, Math.ceil(width * dpr), maxPx);
}

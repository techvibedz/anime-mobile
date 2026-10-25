// Tall webtoon strips → screen-sized tiles.
//
// hijala uploads whole episodes as a handful of giant strips (690x17600,
// 855x14000, 1743x16383 — measured 2026-10-25). Decoded at screen width a
// strip becomes a 1080x27000 bitmap: past GL_MAX_TEXTURE_SIZE (4096–16384 by
// device) and Android's 100 MB draw limit, so the platform shrinks it or draws
// only part of it — pages look narrow, blurry or cut. Expo-image has no region
// decoder (and an OTA can't add one), so the reader instead asks Photon
// (i0.wp.com, which already serves this host) for exact-pixel crops of the
// strip and stacks them: each tile decodes at full display density.
//
// Photon only takes whole-percent crops in percent mode (33.33% → 33%, which
// would leave seams), so crops are in pixels — which needs the strip's real
// size before rendering. probeImageSize reads it from the first 64 KB of the
// file (HTTP Range; verified 206 on hijala) instead of downloading the strip.

/** Hosts whose tall strips are tiled (Photon-served WordPress uploads). */
const TILE_HOST = /(^|\.)hijala\.com$/i;

/** Strips taller than this (height / width) are tiled. ~3.5 keeps ordinary
 * pages and short strips on the single-image path. */
export const TALL_RATIO = 3.5;

/** Max tile shape (height / width): at a 1080px-wide display a tile decodes
 * to ≤ ~2700px tall — under every device's texture limit. */
export const TILE_RATIO = 2.5;

export interface ImageSize {
  width: number;
  height: number;
}

export interface Tile {
  /** Source pixel offset / height of this slice. */
  y: number;
  height: number;
  uri: string;
}

export function isTileHost(uri: string): boolean {
  try {
    return TILE_HOST.test(new URL(uri).hostname);
  } catch {
    return false;
  }
}

/** Photon crop of `[0, y, width, height]` in source pixels. */
export function tileUrl(uri: string, width: number, y: number, height: number): string {
  const u = new URL(uri);
  return `https://i0.wp.com/${u.hostname}${u.pathname}?ssl=1&crop=0px,${y}px,${width}px,${height}px`;
}

/** Slices for a strip, or [] when it is short enough to render whole. Equal
 * integer-pixel slices that exactly cover the strip (no gaps, no overlap). */
export function planTiles(uri: string, size: ImageSize): Tile[] {
  const { width, height } = size;
  if (!(width > 0 && height > 0) || height / width <= TALL_RATIO || !isTileHost(uri)) return [];
  const count = Math.ceil(height / width / TILE_RATIO);
  const tiles: Tile[] = [];
  for (let i = 0; i < count; i++) {
    const y = Math.round((i * height) / count);
    const next = Math.round(((i + 1) * height) / count);
    tiles.push({ y, height: next - y, uri: tileUrl(uri, width, y, next - y) });
  }
  return tiles;
}

// ── header parsing ───────────────────────────────────────────────────────────

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);

/** Pixel size from the first bytes of a PNG / JPEG / WebP / GIF, or null. */
export function parseImageSize(b: Uint8Array): ImageSize | null {
  const ok = (width: number, height: number) => (width > 0 && height > 0 ? { width, height } : null);
  if (b.length < 26) return null;
  // PNG: IHDR right after the signature.
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return ok(u32be(b, 16), u32be(b, 20));
  // GIF
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return ok(u16le(b, 6), u16le(b, 8));
  // WebP: RIFF....WEBP + VP8 / VP8L / VP8X chunk.
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) {
    const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (chunk === "VP8X" && b.length >= 30) return ok(u24le(b, 24) + 1, u24le(b, 27) + 1);
    if (chunk === "VP8 " && b.length >= 30) return ok(u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
    if (chunk === "VP8L" && b.length >= 25) {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return ok((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    return null;
  }
  // JPEG: walk segments to the first SOFn frame header.
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker === 0xff) { i++; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return ok(u16be(b, i + 7), u16be(b, i + 5));
      i += 2 + u16be(b, i + 2);
    }
  }
  return null;
}

// ── probe (network) ──────────────────────────────────────────────────────────

const sizeCache = new Map<string, ImageSize>();
const inflight = new Map<string, Promise<ImageSize | null>>();

export function cachedImageSize(uri: string): ImageSize | undefined {
  return sizeCache.get(uri);
}

/** Real pixel size from the file header. Null on any failure — callers then
 * render the strip whole, exactly as before tiling existed. */
export function probeImageSize(uri: string, headers?: Record<string, string>): Promise<ImageSize | null> {
  const known = sizeCache.get(uri);
  if (known) return Promise.resolve(known);
  const existing = inflight.get(uri);
  if (existing) return existing;
  const pending = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(uri, { signal: controller.signal, headers: { ...headers, Range: "bytes=0-65535" } });
      if (!res.ok) return null;
      const bytes = new Uint8Array(await res.arrayBuffer());
      return parseImageSize(bytes.subarray(0, 65536));
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  })().then((size) => {
    // Failures aren't cached: a flaky network shouldn't pin the whole-strip path.
    if (size) sizeCache.set(uri, size);
    if (sizeCache.size > 3000) sizeCache.delete(sizeCache.keys().next().value as string);
    inflight.delete(uri);
    return size;
  });
  inflight.set(uri, pending);
  return pending;
}

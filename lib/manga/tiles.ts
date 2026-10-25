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
//
// Many hijala chapters live on Blogger's CDN (blogger.googleusercontent.com),
// where Photon ignores `crop` and returns the whole strip — those tiles come
// from wsrv.nl, which crops in exact pixels (verified 2026-10-25).
//
// Split columns: some hijala uploads cut every page into a LEFT and a RIGHT
// half — `01_001.jpg` + `01_002.jpg`, equal sizes (345x15000 each; Fight
// Class 3 ch.144). Stacked, each half rendered full-width: "half a page,
// blown up". joinColumnPages folds such runs back into one page entry, and
// planPage lays the columns out side by side (seam continuity measured
// left|right 2–12 vs top|bottom 67–255 mean pixel diff, so _001 = left).

/** Hosts whose tall strips are tiled (Photon / wsrv crops). */
const TILE_HOST = /(^|\.)(hijala\.com|googleusercontent\.com|bp\.blogspot\.com)$/i;
const PHOTON_HOST = /(^|\.)hijala\.com$/i;

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

/** Crop of `[0, y, width, height]` in source pixels — Photon for hijala's own
 * uploads, wsrv.nl elsewhere (Blogger: Photon ignores the crop there). */
export function tileUrl(uri: string, width: number, y: number, height: number): string {
  const u = new URL(uri);
  if (PHOTON_HOST.test(u.hostname)) {
    return `https://i0.wp.com/${u.hostname}${u.pathname}?ssl=1&crop=0px,${y}px,${width}px,${height}px`;
  }
  return `https://wsrv.nl/?url=${encodeURIComponent(uri)}&cx=0&cy=${y}&cw=${width}&ch=${height}&q=95`;
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

// ── split columns ────────────────────────────────────────────────────────────

const COLUMNS_MARK = "#pantoufa-cols=";
const COLUMN_PART = /^(.*?)(\d+)_0*(\d+)\.([a-z0-9]+)$/i;

/** Stem = host + file name without the `_00N` part. Directories are ignored on
 * purpose: Blogger stores every file under its own unique hash directory
 * (`/img/b/<hash>/s0/01_001.jpg`), and the runs are consecutive pages of one
 * chapter anyway. */
function columnPart(url: string): { stem: string; index: number } | null {
  let host: string;
  let name: string;
  try {
    const u = new URL(url);
    host = u.hostname;
    name = decodeURIComponent(u.pathname.split("/").pop() ?? "");
  } catch {
    return null;
  }
  const m = COLUMN_PART.exec(name);
  return m ? { stem: `${host}|${m[1]}${m[2]}.${m[4].toLowerCase()}`, index: Number(m[3]) } : null;
}

/** Folds `N_001, N_002[, N_003…]` runs (same directory + stem) into one entry:
 * the first column's URL carrying the rest after a fragment. Fragments never
 * reach the server, so a consumer that ignores them still loads column 1. */
export function joinColumnPages(pages: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    const first = columnPart(pages[i]);
    if (!first || first.index !== 1) { out.push(pages[i]); continue; }
    const run = [pages[i]];
    while (i + run.length < pages.length) {
      const next = columnPart(pages[i + run.length]);
      if (!next || next.stem !== first.stem || next.index !== run.length + 1) break;
      run.push(pages[i + run.length]);
    }
    if (run.length < 2) { out.push(pages[i]); continue; }
    out.push(`${run[0]}${COLUMNS_MARK}${run.slice(1).map(encodeURIComponent).join(",")}`);
    i += run.length - 1;
  }
  return out;
}

/** Column URLs of a page entry, left to right (a plain page → [itself]). */
export function pageColumns(uri: string): string[] {
  const at = uri.indexOf(COLUMNS_MARK);
  if (at < 0) return [uri];
  const rest = uri.slice(at + COLUMNS_MARK.length).split(",").filter(Boolean).map((part) => {
    try { return decodeURIComponent(part); } catch { return part; }
  });
  return [uri.slice(0, at), ...rest];
}

export interface PageCell {
  uri: string;
  /** Source pixel width of this cell (its column's width). */
  width: number;
}

export interface PageRow {
  /** Source pixel height of this row. */
  height: number;
  cells: PageCell[];
}

export interface PageLayout {
  /** Combined source size: columns side by side. */
  width: number;
  height: number;
  rows: PageRow[];
}

/** Layout for a page entry given each column's real size, or null when the
 * page should render as one ordinary image (single short column / unknown
 * sizes / columns that don't share a height). Columns sit side by side; a
 * tall result is cut into rows of crops (each ≤ TILE_RATIO of the combined
 * width), exact and gap-free. */
export function planPage(uri: string, sizes: (ImageSize | null | undefined)[]): PageLayout | null {
  const columns = pageColumns(uri);
  if (sizes.length !== columns.length || sizes.some((size) => !size || !(size.width > 0 && size.height > 0))) return null;
  const known = sizes as ImageSize[];
  const height = known[0].height;
  if (known.some((size) => Math.abs(size.height - height) > 2)) return null;
  const width = known.reduce((sum, size) => sum + size.width, 0);
  const tall = height / width > TALL_RATIO && columns.every(isTileHost);
  if (!tall) {
    return columns.length > 1
      ? { width, height, rows: [{ height, cells: columns.map((col, i) => ({ uri: col, width: known[i].width })) }] }
      : null;
  }
  const count = Math.ceil(height / width / TILE_RATIO);
  const rows: PageRow[] = [];
  for (let i = 0; i < count; i++) {
    const y = Math.round((i * height) / count);
    const next = Math.round(((i + 1) * height) / count);
    rows.push({
      height: next - y,
      cells: columns.map((col, c) => ({ uri: tileUrl(col, known[c].width, y, next - y), width: known[c].width })),
    });
  }
  return { width, height, rows };
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

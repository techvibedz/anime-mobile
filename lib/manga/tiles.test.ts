import assert from "node:assert/strict";
import { isTileHost, parseImageSize, planTiles, TILE_RATIO } from "./tiles";

function bytes(...parts: (number[] | string)[]): Uint8Array {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === "string") for (const ch of part) out.push(ch.charCodeAt(0));
    else out.push(...part);
  }
  while (out.length < 40) out.push(0);
  return Uint8Array.from(out);
}

function main() {
  const strip = "https://hijala.com/wp-content/uploads/manga/938583e6/02.jpg";

  // Hosts: only hijala strips are tiled.
  assert.equal(isTileHost(strip), true);
  assert.equal(isTileHost("https://3asq.online/wp-content/x.jpg"), false);
  assert.equal(isTileHost("not a url"), false);

  // Ordinary pages and short strips render whole.
  assert.deepEqual(planTiles(strip, { width: 800, height: 1200 }), []);
  assert.deepEqual(planTiles(strip, { width: 700, height: 2400 }), []);
  assert.deepEqual(planTiles("https://mangawy.org/a.jpg", { width: 690, height: 17600 }), []);

  // 690x16360 (BAEK XX ch.1, measured live) → exact, gap-free pixel slices.
  const tiles = planTiles(strip, { width: 690, height: 16360 });
  assert.equal(tiles.length, Math.ceil(16360 / 690 / TILE_RATIO));
  assert.equal(tiles[0].y, 0);
  for (let i = 1; i < tiles.length; i++) assert.equal(tiles[i].y, tiles[i - 1].y + tiles[i - 1].height);
  assert.equal(tiles.at(-1)!.y + tiles.at(-1)!.height, 16360);
  for (const tile of tiles) assert.ok(tile.height / 690 <= TILE_RATIO + 0.01);
  assert.equal(tiles[0].uri, `https://i0.wp.com/hijala.com/wp-content/uploads/manga/938583e6/02.jpg?ssl=1&crop=0px,0px,690px,${tiles[0].height}px`);
  // Percent-encoded Arabic filenames pass through untouched.
  assert.ok(planTiles("https://hijala.com/wp-content/uploads/manga/449caab6/%D8%A8%D8%AF%D9%88%D9%86.webp", { width: 720, height: 13500 })[0]
    .uri.startsWith("https://i0.wp.com/hijala.com/wp-content/uploads/manga/449caab6/%D8%A8%D8%AF%D9%88%D9%86.webp?ssl=1&crop="));

  // Header parsing.
  const png = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], "IHDR", [0, 0, 0x02, 0xb2, 0, 0, 0x3f, 0xe8]);
  assert.deepEqual(parseImageSize(png), { width: 690, height: 16360 });
  const vp8 = bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 ", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0x57, 0x03, 0xb0, 0x36]);
  assert.deepEqual(parseImageSize(vp8), { width: 855, height: 14000 });
  const vp8x = bytes("RIFF", [0, 0, 0, 0], "WEBPVP8X", [0, 0, 0, 0, 0, 0, 0, 0], [0xce, 0x06, 0x00, 0xfe, 0x3f, 0x00]);
  assert.deepEqual(parseImageSize(vp8x), { width: 1743, height: 16383 });
  // JPEG: APP0 segment, then SOF0 (height 16360, width 690).
  const jpeg = bytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], "JFIF", [0, 1, 1, 0, 0, 1, 0, 1, 0, 0],
    [0xff, 0xc0, 0x00, 0x11, 0x08, 0x3f, 0xe8, 0x02, 0xb2, 0x03]);
  assert.deepEqual(parseImageSize(jpeg), { width: 690, height: 16360 });
  const gif = bytes("GIF89a", [0xb2, 0x02, 0xe8, 0x3f]);
  assert.deepEqual(parseImageSize(gif), { width: 690, height: 16360 });
  assert.equal(parseImageSize(bytes("hello world")), null);
  assert.equal(parseImageSize(new Uint8Array(4)), null);

  console.log("manga tile tests passed");
}

main();

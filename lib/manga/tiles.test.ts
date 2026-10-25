import assert from "node:assert/strict";
import { isTileHost, joinColumnPages, pageColumns, parseImageSize, planPage, planTiles, TILE_RATIO, tileUrl } from "./tiles";

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

  // Blogger-hosted strips are tiled through wsrv.nl (Photon ignores crops there).
  const blogger = "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEgz6nOV/s0/01_001.jpg";
  assert.equal(isTileHost(blogger), true);
  assert.equal(tileUrl(blogger, 345, 100, 800), `https://wsrv.nl/?url=${encodeURIComponent(blogger)}&cx=0&cy=100&cw=345&ch=800&q=95`);

  // Split columns (Fight Class 3 ch.144: every page cut into a left + right half).
  const dir = "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvX";
  const raw = [`${dir}a/s0/01_001.jpg`, `${dir}b/s0/01_002.jpg`, `${dir}c/s0/02_001.jpg`, `${dir}d/s0/02_002.jpg`];
  // Blogger gives every file its own hash directory — the run still joins.
  const bloggerJoined = joinColumnPages(raw);
  assert.equal(bloggerJoined.length, 2);
  assert.deepEqual(pageColumns(bloggerJoined[0]), [raw[0], raw[1]]);
  assert.deepEqual(pageColumns(bloggerJoined[1]), [raw[2], raw[3]]);
  // Different hosts or extensions never join.
  assert.equal(joinColumnPages([`${dir}a/s0/01_001.jpg`, "https://hijala.com/x/01_002.jpg"]).length, 2);
  assert.equal(joinColumnPages(["https://hijala.com/x/01_001.jpg", "https://hijala.com/x/01_002.png"]).length, 2);
  const h = "https://hijala.com/wp-content/uploads/manga/x1";
  const split = [`${h}/00.webp`, `${h}/01_001.webp`, `${h}/01_002.webp`, `${h}/02_001.webp`, `${h}/02_002.webp`, `${h}/03_001.webp`, `${h}/04.webp`];
  const joined = joinColumnPages(split);
  assert.equal(joined.length, 5);
  assert.equal(joined[0], `${h}/00.webp`);
  assert.deepEqual(pageColumns(joined[1]), [`${h}/01_001.webp`, `${h}/01_002.webp`]);
  assert.deepEqual(pageColumns(joined[2]), [`${h}/02_001.webp`, `${h}/02_002.webp`]);
  assert.equal(joined[3], `${h}/03_001.webp`); // a lone _001 stays a page
  assert.deepEqual(pageColumns(`${h}/04.webp`), [`${h}/04.webp`]);
  // Three-way splits and encoded names survive the round trip.
  const three = joinColumnPages([`${h}/05_001.jpg`, `${h}/05_002.jpg`, `${h}/05_003.jpg`]);
  assert.deepEqual(pageColumns(three[0]), [`${h}/05_001.jpg`, `${h}/05_002.jpg`, `${h}/05_003.jpg`]);

  // Two 345x14525 halves → one 690x14525 page, rows of crops across both columns.
  const page = planPage(joined[1], [{ width: 345, height: 14525 }, { width: 345, height: 14525 }]);
  assert.ok(page);
  assert.equal(page.width, 690);
  assert.equal(page.height, 14525);
  assert.equal(page.rows.length, Math.ceil(14525 / 690 / TILE_RATIO));
  assert.equal(page.rows.reduce((sum, row) => sum + row.height, 0), 14525);
  for (const row of page.rows) {
    assert.equal(row.cells.length, 2);
    assert.ok(row.cells[0].uri.includes("01_001.webp") && row.cells[1].uri.includes("01_002.webp"));
    assert.ok(row.height / 690 <= TILE_RATIO + 0.01);
  }
  // A short split page (two 1632x1841 halves) stays one row of whole images.
  const short = planPage(joined[1], [{ width: 1632, height: 1841 }, { width: 1632, height: 1841 }]);
  assert.deepEqual(short?.rows, [{ height: 1841, cells: [{ uri: `${h}/01_001.webp`, width: 1632 }, { uri: `${h}/01_002.webp`, width: 1632 }] }]);
  // Mismatched heights / unknown sizes → no plan (the reader falls back).
  assert.equal(planPage(joined[1], [{ width: 345, height: 14525 }, { width: 345, height: 9000 }]), null);
  assert.equal(planPage(joined[1], [{ width: 345, height: 14525 }, null]), null);
  // A plain short page needs no plan; a plain tall strip gets single-column rows.
  assert.equal(planPage(`${h}/04.webp`, [{ width: 800, height: 1200 }]), null);
  assert.equal(planPage(strip, [{ width: 690, height: 16360 }])?.rows.length, tiles.length);

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

import assert from "node:assert/strict";
import { upgradeMangaCover } from "./cover";

// Fixture URLs are real (captured from the live sites) and each rewrite was
// probed with sharp: the left dimensions are what the parsed URL returns, the
// right dimensions are what upgradeMangaCover returns.
const MANGY_THUMB = "https://img.mangawy.org/covers/9c92d276bde5e4c36116d584b8247d41-thumb-sm.webp"; // 160x240
const MANGY_MD = "https://img.mangawy.org/covers/c6a868960678023fd919390675b87ab4-cover-md.webp"; // 320x480
const MANGY_BARE = "https://img.mangawy.org/covers/c6a868960678023fd919390675b87ab4.webp"; // 715x1000 original
const ASQ_THUMB = "https://3asq.online/wp-content/uploads/2025/07/Baki-Rahen-175x238.jpg"; // 175x238
const ASQ_ORIGINAL = "https://3asq.online/wp-content/uploads/2025/07/Baki-Rahen.jpg"; // 1326x2048
const MANGALIK_THUMB = "https://io.mangalik.net/wp-content/uploads/2022/04/I-Tried-to-Be-a-Loyal-Sword-110x150.jpg"; // 110x150
const MANGALIK_ORIGINAL = "https://io.mangalik.net/wp-content/uploads/2022/04/I-Tried-to-Be-a-Loyal-Sword.jpg"; // 450x611
const AZORA_COVER = "https://storage.azorafly.com/upload/series/featured/oGmL0DQZ16QInTPaeDKwFEK9ryegoy88/2e3a7772-2afc-4b38-81bc-6447c6cc3c89.jpg"; // 960x1392

/** A result must never still point at a thumbnail-sized asset. */
function assertNotThumb(url: string | null): void {
  assert.ok(url);
  assert.doesNotMatch(url, /-thumb-sm|-\d{2,3}x\d{2,3}\.(?:jpe?g|png|webp)$/i, `still a thumb: ${url}`);
}

function main() {
  // null / undefined / empty pass through (never throw).
  assert.equal(upgradeMangaCover(null), null);
  assert.equal(upgradeMangaCover(undefined), null);
  assert.equal(upgradeMangaCover(""), "");

  // Malformed / unknown input is returned unchanged.
  assert.equal(upgradeMangaCover("not a url"), "not a url");
  assert.equal(upgradeMangaCover("http://"), "http://");
  assert.equal(upgradeMangaCover("ftp://img.mangawy.org/covers/9c92d276bde5e4c36116d584b8247d41-thumb-sm.webp"), "ftp://img.mangawy.org/covers/9c92d276bde5e4c36116d584b8247d41-thumb-sm.webp");
  assert.equal(upgradeMangaCover("https://cdn.example.com/uploads/foo-110x150.jpg"), "https://cdn.example.com/uploads/foo-110x150.jpg");
  assert.equal(upgradeMangaCover("https://cdn.other.org/covers/9c92d276bde5e4c36116d584b8247d41-thumb-sm.webp"), "https://cdn.other.org/covers/9c92d276bde5e4c36116d584b8247d41-thumb-sm.webp");

  // mangawy: -thumb-sm (160x240) and -cover-md (320x480) -> -cover-lg (640x960).
  assert.equal(
    upgradeMangaCover(MANGY_THUMB),
    "https://img.mangawy.org/covers/9c92d276bde5e4c36116d584b8247d41-cover-lg.webp",
  );
  assert.equal(
    upgradeMangaCover(MANGY_MD),
    "https://img.mangawy.org/covers/c6a868960678023fd919390675b87ab4-cover-lg.webp",
  );
  assertNotThumb(upgradeMangaCover(MANGY_THUMB));
  assertNotThumb(upgradeMangaCover(MANGY_MD));

  // -cover-lg is already the best token (idempotent); the bare original is
  // kept because it is the true maximum for some uploads (this one is
  // 715x1000 > 640x960).
  assert.equal(
    upgradeMangaCover("https://img.mangawy.org/covers/c6a868960678023fd919390675b87ab4-cover-lg.webp"),
    "https://img.mangawy.org/covers/c6a868960678023fd919390675b87ab4-cover-lg.webp",
  );
  assert.equal(upgradeMangaCover(MANGY_BARE), MANGY_BARE);

  // Query/hash survive the rewrite.
  assert.equal(
    upgradeMangaCover(`${MANGY_THUMB}?v=2#top`),
    "https://img.mangawy.org/covers/9c92d276bde5e4c36116d584b8247d41-cover-lg.webp?v=2#top",
  );

  // 3asq: WordPress thumbs (175x238, 110x150) -> originals (1326x2048, 1304x2048).
  assert.equal(upgradeMangaCover(ASQ_THUMB), ASQ_ORIGINAL);
  assert.equal(
    upgradeMangaCover("https://3asq.online/wp-content/uploads/2019/04/v1-1-110x150.jpg"),
    "https://3asq.online/wp-content/uploads/2019/04/v1-1.jpg",
  );
  assertNotThumb(upgradeMangaCover(ASQ_THUMB));
  assert.equal(upgradeMangaCover(ASQ_ORIGINAL), ASQ_ORIGINAL);

  // mangalik: same WordPress rule, hosts io/leksolo/tempsolo.mangalik.net.
  assert.equal(upgradeMangaCover(MANGALIK_THUMB), MANGALIK_ORIGINAL);
  assert.equal(
    upgradeMangaCover("https://io.mangalik.net/wp-content/uploads/2026/01/large_d33c402679c97bff71f1b8136f70b37824c9203b_439_571_26388-175x238.webp"),
    "https://io.mangalik.net/wp-content/uploads/2026/01/large_d33c402679c97bff71f1b8136f70b37824c9203b_439_571_26388.webp",
  );
  assert.equal(
    upgradeMangaCover("https://tempsolo.mangalik.net/wp-content/uploads/2019/03/cover_250x350-125x180.jpg"),
    "https://tempsolo.mangalik.net/wp-content/uploads/2019/03/cover_250x350.jpg",
  );
  assertNotThumb(upgradeMangaCover(MANGALIK_THUMB));

  // Only the trailing -WxH is a generated size: …-210x286-1 is the original
  // (210x286) of the 110x150 thumb and must itself stay untouched.
  assert.equal(
    upgradeMangaCover("https://io.mangalik.net/wp-content/uploads/2024/08/8ba3b-4422a-44ff0-210x286-1-110x150.jpg"),
    "https://io.mangalik.net/wp-content/uploads/2024/08/8ba3b-4422a-44ff0-210x286-1.jpg",
  );
  assert.equal(
    upgradeMangaCover("https://io.mangalik.net/wp-content/uploads/2024/08/8ba3b-4422a-44ff0-210x286-1.jpg"),
    "https://io.mangalik.net/wp-content/uploads/2024/08/8ba3b-4422a-44ff0-210x286-1.jpg",
  );

  // Chapter-page data URLs carry no size token: unchanged.
  assert.equal(
    upgradeMangaCover("https://leksolo.mangalik.net/manga/arb6/data/manga_6957e45e34f6c/c37cccfe2a52643872879ab95713a51e/image-01.jpg"),
    "https://leksolo.mangalik.net/manga/arb6/data/manga_6957e45e34f6c/c37cccfe2a52643872879ab95713a51e/image-01.jpg",
  );

  // azora: no larger variant exists (960x1392 native; ?w/?width/?size are
  // ignored byte-for-byte), so covers and reader pages stay as parsed.
  assert.equal(upgradeMangaCover(AZORA_COVER), AZORA_COVER);
  assert.equal(upgradeMangaCover(`${AZORA_COVER}?w=2000`), `${AZORA_COVER}?w=2000`);
  assert.equal(
    upgradeMangaCover("https://storage.azorafly.com/public//upload/series/a-bad-example-of-a-perfect-curse/JUJl6dz3mS/01.webp"),
    "https://storage.azorafly.com/public//upload/series/a-bad-example-of-a-perfect-curse/JUJl6dz3mS/01.webp",
  );

  console.log("cover upgrade tests passed");
}

main();

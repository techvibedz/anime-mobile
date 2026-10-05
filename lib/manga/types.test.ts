import assert from "node:assert/strict";
import {
  decodeChapterRef,
  decodeMangaRef,
  encodeChapterRef,
  encodeMangaRef,
} from "./types";

// Route refs carry source-native ids that are often full URLs (3asq) or slugs
// (mangawy/mangalik/azora), and chapter refs append "#chapterId" — these
// round-trips are the contract between every screen and the reader deep links.

const urls = [
  "https://3asq.online/manga/one-piece/",
  "a92bd70d-a716-4e48-90c6-137682742137",
  "return-of-the-mount-hua-sect-k2c31iwr",
  "white-dragon-duke-pendragon",
];

for (const id of urls) {
  const ref = encodeMangaRef("asq", id);
  assert.deepEqual(decodeMangaRef(ref), { source: "asq", id });
}

// Only the FIRST colon separates source from id — the id itself may be a URL.
assert.deepEqual(decodeMangaRef("asq:https://3asq.online/manga/one-piece/"), {
  source: "asq",
  id: "https://3asq.online/manga/one-piece/",
});

assert.equal(decodeMangaRef("no-separator"), null);
assert.equal(decodeMangaRef("asq:"), null);

const chapterRef = encodeChapterRef("asq", "https://3asq.online/manga/one-piece/", "https://3asq.online/manga/one-piece/1194/");
assert.deepEqual(decodeChapterRef(chapterRef), {
  source: "asq",
  mangaId: "https://3asq.online/manga/one-piece/",
  chapterId: "https://3asq.online/manga/one-piece/1194/",
});

assert.deepEqual(decodeChapterRef(encodeChapterRef("mangadek" as any, "one piece", "1194")), {
  source: "mangadek",
  mangaId: "one piece",
  chapterId: "1194",
});

assert.equal(decodeChapterRef("asq:abc"), null);
assert.equal(decodeChapterRef("nocolon#chapter"), null);

console.log("manga types tests passed");

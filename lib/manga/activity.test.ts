// Run: npx tsx lib/manga/activity.test.ts
import assert from "node:assert/strict";
import { buildMangaActivityRows, MANGA_ACTIVITY_CAP } from "./activity";

const rows = buildMangaActivityRows("u1",
  [
    { source: "asq", id: "kingdom", title: "Kingdom", cover: "k.jpg", addedAt: 1000 },
    { source: "mangawy", id: "solo", title: "Solo", cover: null, addedAt: 3000 },
  ],
  [
    { source: "asq", id: "kingdom", title: "", cover: null, chapterNumber: "891", page: 4.7, total: 20, updatedAt: 2000 },
  ]);
assert.equal(rows.length, 2, "library + progress of one work collapse to one row");
const kingdom = rows.find((r) => r.manga_key === "asq:kingdom")!;
assert.equal(kingdom.in_library, true);
assert.equal(kingdom.chapter_number, "891");
assert.equal(kingdom.page, 4);
assert.equal(kingdom.title, "Kingdom", "missing progress title is filled from the library");
assert.equal(kingdom.cover, "k.jpg");
assert.equal(rows[0].manga_key, "mangawy:solo", "newest first");
assert.equal(rows.find((r) => r.manga_key === "mangawy:solo")!.chapter_number, null);
const many = Array.from({ length: MANGA_ACTIVITY_CAP + 5 }, (_, i) => ({ source: "s", id: String(i), title: "t", cover: null, addedAt: i }));
assert.equal(buildMangaActivityRows("u1", many, []).length, MANGA_ACTIVITY_CAP);
console.log("manga activity tests passed");

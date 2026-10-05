import assert from "node:assert/strict";
import {
  chapterNumberKey,
  filterMangaCards,
  mangaTitleKey,
  mergeCards,
  mergeDetails,
  mergeHomes,
  strictTitleScore,
} from "./aggregate";
import { decodeReaderRef, encodeReaderRef, type MangaCard, type MangaDetail, type MangaHome } from "./types";

// Pure aggregation contract: identity, dedupe, rail union, chapter gap-fill
// and the reader ref round-trip. Network paths are exercised by the app.

function card(partial: Partial<MangaCard> & { source: MangaCard["source"]; id: string; title: string }): MangaCard {
  return { cover: null, ...partial };
}

function detail(
  source: MangaDetail["source"],
  id: string,
  title: string,
  chapters: { id: string; number: string }[],
  extra: Partial<MangaDetail> = {},
): MangaDetail {
  return {
    source,
    id,
    title,
    cover: null,
    genres: [],
    chapters: chapters.map((chapter) => ({ id: chapter.id, number: chapter.number })),
    ...extra,
  };
}

async function main() {
  // ── identity ──────────────────────────────────────────────────────────────
  assert.equal(mangaTitleKey("Solo Leveling"), "solo leveling");
  assert.equal(mangaTitleKey("Solo Leveling (مانهوا)"), "solo leveling");
  assert.equal(mangaTitleKey("  Re:Zero  "), "re zero");
  assert.equal(mangaTitleKey("One Piece Colored"), "one piece");

  assert.equal(chapterNumberKey("الفصل 179"), "179");
  assert.equal(chapterNumberKey("١٧٩"), "179");
  assert.equal(chapterNumberKey("24.1"), "24.1");
  assert.equal(chapterNumberKey("2.5.1"), "2.5.1");
  assert.notEqual(chapterNumberKey("2.5.1"), chapterNumberKey("2.5"));
  assert.equal(chapterNumberKey("خاص"), "خاص");
  assert.equal(chapterNumberKey(null), "");

  assert.equal(strictTitleScore("Solo Leveling", "solo leveling"), 1);
  assert.ok(strictTitleScore("Solo Leveling", "Solo Leveling Ragnarok") < 0.88);
  assert.ok(strictTitleScore("Return of the Mount Hua Sect", "Return of Mount Hua Sect") >= 0.88);
  assert.equal(strictTitleScore("Naruto", "One Piece"), 0);

  // ── card merge ────────────────────────────────────────────────────────────
  const mergedCards = mergeCards([
    card({ source: "mangawy", id: "a", title: "Solo Leveling", cover: "c" }),
    card({ source: "asq", id: "b", title: "Solo Leveling", cover: "c", latest: "الفصل 200", rating: "9" }),
    card({ source: "mangalik", id: "d", title: "Solo Leveling Ragnarok" }),
  ]);
  assert.equal(mergedCards.length, 2);
  assert.equal(mergedCards[0].id, "b");
  assert.equal(mergedCards[0].source, "asq");

  // ── home merge ────────────────────────────────────────────────────────────
  const homeA: MangaHome = {
    featured: [card({ source: "asq", id: "h1", title: "Alpha" })],
    sections: [
      {
        id: "latest",
        title: "أحدث الفصول",
        kind: "latest",
        items: [
          card({ source: "asq", id: "a1", title: "Alpha", latest: "الفصل 10" }),
          card({ source: "asq", id: "a2", title: "Beta", latest: "الفصل 50" }),
        ],
      },
      {
        id: "popular",
        title: "الأكثر قراءة",
        kind: "ranked",
        items: [card({ source: "asq", id: "p1", title: "Gamma" })],
      },
    ],
  };
  const homeB: MangaHome = {
    featured: [card({ source: "mangalik", id: "h2", title: "Alpha" })],
    sections: [
      {
        id: "latest",
        title: "أحدث الفصول",
        kind: "latest",
        items: [
          card({ source: "mangalik", id: "b1", title: "Alpha", latest: "الفصل 99" }),
          card({ source: "mangalik", id: "b2", title: "Delta", latest: "الفصل 5" }),
        ],
      },
      {
        id: "popular",
        title: "الأكثر قراءة",
        kind: "ranked",
        items: [card({ source: "mangalik", id: "p2", title: "Epsilon" })],
      },
    ],
  };
  const home = mergeHomes([
    { source: "asq", home: homeA },
    { source: "mangalik", home: homeB },
  ]);
  assert.equal(home.featured.length, 1); // Alpha deduped across sources
  const latest = home.sections.find((section) => section.id === "latest")!;
  assert.deepEqual(latest.items.map((item) => item.title), ["Alpha", "Beta", "Delta"]);
  assert.equal(latest.items[0].latest, "الفصل 99"); // richest card wins the dup
  const popular = home.sections.find((section) => section.id === "popular")!;
  assert.deepEqual(popular.items.map((item) => item.title), ["Gamma", "Epsilon"]);

  // ── detail merge: gap fill + quality routing ──────────────────────────────
  const asqDetail = detail("asq", "asq-url", "Solo Leveling", [
    { id: "asq-100", number: "100" },
    { id: "asq-99", number: "99" },
  ], { synopsis: "من 3asq" });
  const mangalikDetail = detail("mangalik", "slug", "Solo Leveling", [
    { id: "ml-101", number: "101" },
    { id: "ml-100", number: "100" },
    { id: "ml-99", number: "99" },
  ]);
  const mangawyDetail = detail("mangawy", "slug2", "Solo Leveling", [
    { id: "mw-99", number: "99" },
  ]);
  const merged = mergeDetails([
    { source: "mangalik", detail: mangalikDetail },
    { source: "mangawy", detail: mangawyDetail },
    { source: "asq", detail: asqDetail },
  ]);
  assert.deepEqual(merged.chapters.map((chapter) => chapter.number), ["101", "100", "99"]);
  // 101 exists only on mangalik; 100/99 prefer asq (best page quality).
  assert.equal(merged.chapters[0].source, "mangalik");
  assert.equal(merged.chapters[0].mangaId, "slug");
  assert.equal(merged.chapters[1].source, "asq");
  assert.equal(merged.chapters[2].source, "asq");
  assert.equal(merged.synopsis, "من 3asq");
  assert.equal(merged.latest, "الفصل 101");

  // ── filters ───────────────────────────────────────────────────────────────
  const filterPool = [
    card({ source: "asq", id: "1", title: "A", type: "مانجا", status: "مستمر", latest: "الفصل 5" }),
    card({ source: "asq", id: "2", title: "B", type: "مانهوا", status: "مكتمل", latest: "الفصل 50" }),
    card({ source: "asq", id: "3", title: "C" }),
  ];
  assert.deepEqual(
    filterMangaCards(filterPool, { type: "مانهوا", status: null, sort: "default" }).map((item) => item.id),
    ["2", "3"], // unknown metadata is kept, not hidden
  );
  assert.deepEqual(
    filterMangaCards(filterPool, { type: null, status: null, sort: "latest" }).map((item) => item.id),
    ["2", "1", "3"],
  );

  // ── reader ref round-trip ─────────────────────────────────────────────────
  const ref = encodeReaderRef(
    { source: "asq", id: "https://3asq.online/manga/solo-leveling/" },
    { source: "mangalik", mangaId: "roxana", id: "3" },
  );
  assert.deepEqual(decodeReaderRef(ref), {
    source: "asq",
    mangaId: "https://3asq.online/manga/solo-leveling/",
    chapterSource: "mangalik",
    chapterMangaId: "roxana",
    chapterId: "3",
  });
  assert.equal(decodeReaderRef("asq:abc"), null);

  console.log("manga aggregate tests passed");
}

void main();

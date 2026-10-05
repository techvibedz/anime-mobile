// Manga navigation helpers — one place that knows how manga route params are
// built, so hub / detail / reader / library never drift apart.

import { router } from "expo-router";
import { encodeReaderRef, type MangaSourceId } from "./types";

export interface MangaOpenTarget {
  source: MangaSourceId;
  id: string;
  title: string;
  cover?: string | null;
}

export function openMangaDetail(target: MangaOpenTarget): void {
  router.push({
    pathname: "/manga/[id]",
    params: {
      id: `${target.source}:${target.id}`,
      title: target.title,
      cover: target.cover ?? "",
    },
  });
}

export interface MangaChapterTarget {
  /** Source that owns this chapter's native ids. */
  source: MangaSourceId;
  /** Native manga id on `source`. */
  mangaId: string;
  id: string;
  number: string;
}

export interface MangaReaderTarget {
  /** Anchor work identity (stable for progress/library across sources). */
  source: MangaSourceId;
  mangaId: string;
  mangaTitle: string;
  chapter: MangaChapterTarget;
  cover?: string | null;
}

function readerParams(target: MangaReaderTarget) {
  return {
    chapter: encodeReaderRef(
      { source: target.source, id: target.mangaId },
      { source: target.chapter.source, mangaId: target.chapter.mangaId, id: target.chapter.id },
    ),
    title: target.mangaTitle,
    num: target.chapter.number,
    cover: target.cover ?? "",
  };
}

export function openMangaReader(target: MangaReaderTarget): void {
  router.push({ pathname: "/manga-reader/[chapter]", params: readerParams(target) });
}

/** Swap the reader to another chapter without stacking routes. */
export function replaceMangaReader(target: MangaReaderTarget): void {
  router.replace({ pathname: "/manga-reader/[chapter]", params: readerParams(target) });
}

export function openMangaLibrary(): void {
  router.push("/manga-library");
}

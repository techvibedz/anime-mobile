// Readable chapter — a chapter whose page images actually load. Sources delete
// old uploads while the chapter page keeps listing them: 3asq's original
// Naruto 590–700 all point at 404 images (measured 2026-10-31), so the reader
// sat on empty spinners even though mangalik serves the same chapters fine.
// The chosen copy's first and last page are probed; a definitive dead answer
// moves on to the other sources' copies of the same chapter number.

import { fetchMangaChapter } from "./api";
import type { ChapterCopy, MangaReaderData } from "./types";

/** The Referer each source's image host expects (hot-link protection). */
export function chapterImageReferer(copy: ChapterCopy): string {
  switch (copy.source) {
    case "asq":
      return copy.id;
    case "mangalik":
      return `https://lekmanga.site/manga/${encodeURIComponent(copy.mangaId)}/${encodeURIComponent(copy.id)}/`;
    case "hijala":
      return `https://hijala.com/${encodeURIComponent(copy.id)}/`;
    default:
      return `https://mangawy.org/series/${encodeURIComponent(copy.mangaId)}/chapter/${encodeURIComponent(copy.id)}`;
  }
}

type FetchLike = (uri: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
}>;

/** False only on a definitive "this file is gone" answer (403/404/410, or an
 * HTML error page where an image should be). Timeouts and network errors
 * count as alive — a slow connection must never switch sources. */
export async function probePageAlive(
  uri: string,
  headers: Record<string, string>,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  timeoutMs = 6000,
): Promise<boolean> {
  // Column entries (hijala) carry a fragment; the first column is the file.
  const file = uri.split("#")[0];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(file, { headers: { ...headers, Range: "bytes=0-1023" }, signal: controller.signal });
    if (res.status === 403 || res.status === 404 || res.status === 410) return false;
    if (res.ok && /^text\/html/i.test(res.headers.get("content-type") ?? "")) return false;
    return true;
  } catch {
    return true;
  } finally {
    clearTimeout(timer);
  }
}

export interface ReadableChapter {
  data: MangaReaderData;
  /** The copy that is actually served — image Referers must follow it. */
  copy: ChapterCopy;
}

export interface ReadableDeps {
  fetchChapter: (copy: ChapterCopy, force: boolean) => Promise<MangaReaderData>;
  probe: (uri: string, headers: Record<string, string>) => Promise<boolean>;
}

const defaultDeps: ReadableDeps = {
  fetchChapter: (copy, force) => fetchMangaChapter(copy.source, copy.mangaId, copy.id, { force }),
  probe: (uri, headers) => probePageAlive(uri, headers),
};

const copyKey = (copy: ChapterCopy) => `${copy.source}|${copy.mangaId}|${copy.id}`;

// Primary copy → the copy that worked, so a reopen or a prefetched next
// chapter skips the dead source without probing again.
const resolved = new Map<string, ChapterCopy>();

// Works (source + manga id) seen serving dead images. Deletions hit whole runs
// of a work (Naruto 590–700), so its next chapters try the alternates first
// instead of paying a fetch + probe on the dead source every time.
const deadWorks = new Set<string>();
const workKey = (copy: ChapterCopy) => `${copy.source}|${copy.mangaId}`;

async function pagesAlive(data: MangaReaderData, copy: ChapterCopy, deps: ReadableDeps): Promise<boolean> {
  const headers = { Referer: chapterImageReferer(copy) };
  const { pages } = data;
  const sample = pages.length > 1 ? [pages[0], pages[pages.length - 1]] : [pages[0]];
  const verdicts = await Promise.all(sample.map((uri) => deps.probe(uri, headers)));
  return verdicts.every(Boolean);
}

/**
 * Pages for `primary`, or for the first alternate copy whose images load.
 * `alternates` is only awaited when the primary copy fails, so the common path
 * costs one small probe. When every copy looks dead the first copy that had a
 * page list is still returned — the reader then shows its per-page state
 * instead of a hard error.
 */
export async function fetchReadableChapter(
  primary: ChapterCopy,
  alternates: () => Promise<ChapterCopy[]>,
  options: { force?: boolean } = {},
  deps: ReadableDeps = defaultDeps,
): Promise<ReadableChapter> {
  const force = !!options.force;
  const primaryKey = copyKey(primary);
  const remembered = force ? undefined : resolved.get(primaryKey);
  const tried = new Set<string>();
  const state: { lastResort: ReadableChapter | null; lastError: unknown } = { lastResort: null, lastError: null };

  const attempt = async (copy: ChapterCopy): Promise<ReadableChapter | null> => {
    const key = copyKey(copy);
    if (tried.has(key)) return null;
    tried.add(key);
    try {
      const data = await deps.fetchChapter(copy, force);
      if (!data.pages.length) return null;
      const result = { data, copy };
      state.lastResort ??= result;
      if (await pagesAlive(data, copy, deps)) return result;
      deadWorks.add(workKey(copy));
      return null;
    } catch (error) {
      state.lastError = error;
      return null;
    }
  };

  const loadAlternates = async (): Promise<ChapterCopy[]> => {
    try {
      return await alternates();
    } catch {
      return [];
    }
  };

  const primaryDead = !force && deadWorks.has(workKey(primary));
  const tryInOrder = async (copies: ChapterCopy[]): Promise<ReadableChapter | null> => {
    for (const copy of copies) {
      const result = await attempt(copy);
      if (result) {
        resolved.set(primaryKey, result.copy);
        return result;
      }
    }
    return null;
  };

  if (remembered) {
    const result = await tryInOrder([remembered]);
    if (result) return result;
  }
  if (primaryDead) {
    // Known-dead work: live copies first, the primary only as the last try.
    const others = await loadAlternates();
    const ordered = [...others.filter((copy) => !deadWorks.has(workKey(copy))), ...others.filter((copy) => deadWorks.has(workKey(copy))), primary];
    const result = await tryInOrder(ordered);
    if (result) return result;
  } else {
    const result = (await tryInOrder([primary])) ?? (await tryInOrder(await loadAlternates()));
    if (result) return result;
  }

  if (state.lastResort) return state.lastResort;
  throw state.lastError instanceof Error ? state.lastError : new Error("manga: no readable copy");
}

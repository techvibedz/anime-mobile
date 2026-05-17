import { enqueue } from "./bus";
import { EXTRACT_HOME_WIT, HOOK_VIDEO_BEFORE, COLLECT_VIDEO_AFTER } from "./scripts";

export type ScrapedHome = {
  featured: { title: string; href: string; image: string | null; description: string | null; genres: string[] }[];
  animes: { title: string; href: string; image: string | null; type: string | null; status: string | null; description: string | null; isNew: boolean; rating: string | null; sources: string[]; sourceHrefs: Record<string, string> }[];
  episodes: { title: string; href: string; image: string | null; animeTitle: string; animeHref: string; isNew: boolean }[];
};

export async function scrapeWitanimeHome(): Promise<ScrapedHome> {
  return enqueue({
    url: "https://witanime.you/",
    injectAfter: EXTRACT_HOME_WIT,
    timeoutMs: 35000,
  });
}

export async function extractVideoUrl(embedUrl: string): Promise<{ url: string }> {
  return enqueue({
    url: embedUrl,
    injectBefore: HOOK_VIDEO_BEFORE,
    injectAfter: COLLECT_VIDEO_AFTER,
    timeoutMs: 40000,
  });
}

export { ScraperHost } from "./ScraperHost";

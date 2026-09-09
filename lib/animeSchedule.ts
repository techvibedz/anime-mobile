// AnimeSchedule.net's public timetable is the fallback while AniList's API is
// disabled. Keep the parser here (with no React Native imports) so the brittle
// boundary has one small, runnable regression check.

export interface TimetableAiring {
  id: number;
  title: string;
  image: string | null;
  episode: number;
  airingAt: number;
  format: string | null;
}

const BASE_URL = "https://animeschedule.net";

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ",
  };
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&([a-z]+);/gi, (entity, name) => named[name.toLowerCase()] ?? entity);
}

function attr(tag: string, name: string): string {
  return decodeHtml(new RegExp(`\\b${name}="([^"]*)"`, "i").exec(tag)?.[1] || "");
}

function stableId(route: string): number {
  let hash = 2166136261;
  for (let i = 0; i < route.length; i++) hash = Math.imul(hash ^ route.charCodeAt(i), 16777619);
  return hash >>> 0;
}

export function parseAnimeScheduleHtml(html: string): TimetableAiring[] {
  const starts = [...html.matchAll(/<div\s+showID="[^"]+"[^>]*class="[^"]*\btimetable-column-show\b[^"]*"[^>]*>/gi)];
  const out: TimetableAiring[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < starts.length; i++) {
    const opening = starts[i][0];
    if (/\bchinese="true"/i.test(opening)) continue;
    const block = html.slice(starts[i].index!, starts[i + 1]?.index ?? html.length);
    if (attr(block.match(/<span[^>]*\bairType="[^"]+"[^>]*>/i)?.[0] || "", "airType") !== "raw") continue;

    const route = attr(opening, "route");
    const titleHtml = /<h2[^>]*class="[^"]*\bshow-title-bar\b[^"]*"[^>]*>([\s\S]*?)<\/h2>/i.exec(block)?.[1] || "";
    const title = decodeHtml(titleHtml.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    const timeTag = block.match(/<time[^>]*class="[^"]*\bshow-air-time\b[^"]*"[^>]*>/i)?.[0]
      || block.match(/<time[^>]*\bdatetime="[^"]+"[^>]*>/i)?.[0]
      || "";
    const airingMs = Date.parse(attr(timeTag, "datetime"));
    const episodeText = /<span[^>]*class="[^"]*\bshow-episode\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(block)?.[1] || "";
    const episode = Number(attr(opening, "airedEpisode") || episodeText.match(/\d+/)?.[0]);
    if (!route || !title || !Number.isFinite(airingMs) || !Number.isFinite(episode)) continue;

    const key = `${route}#${airingMs}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const imageTag = block.match(/<img[^>]*\bdata-src="[^"]+"[^>]*>/i)?.[0]
      || block.match(/<img[^>]*\bsrc="https:[^"]+"[^>]*>/i)?.[0]
      || "";
    const image = attr(imageTag, imageTag.includes("data-src=") ? "data-src" : "src") || null;
    const mediaType = attr(opening, "mediaType");
    out.push({
      id: stableId(route),
      title,
      image,
      episode,
      airingAt: Math.floor(airingMs / 1000),
      format: mediaType ? mediaType.toUpperCase() : null,
    });
  }
  return out;
}

async function getHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: "text/html" } });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchAnimeScheduleTimetable(): Promise<TimetableAiring[]> {
  const current = await getHtml(`${BASE_URL}/`);
  if (!current) return [];
  const nextHref = decodeHtml(/href="([^"]+)"[^>]*id="next-week-link"/i.exec(current)?.[1] || "");
  const next = nextHref ? await getHtml(`${BASE_URL}/${nextHref.replace(/^\//, "")}`) : null;
  return parseAnimeScheduleHtml(current + (next || ""));
}

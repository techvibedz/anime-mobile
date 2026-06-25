// Anime News feed — aggregated from Jikan (the unofficial MyAnimeList API).
//
// There is no global anime-news JSON endpoint, so we build the feed ourselves:
//   1) pull the current season's airing titles (sfw=true at the QUERY level),
//   2) drop anything adult by genre/rating before we ever touch its news,
//   3) fetch every remaining title's MAL news posts, merge, and sort the WHOLE
//      feed newest-first — pages are then just slices of that one sorted list,
//      so item #1 is always the most recent article across all titles.
//
// Brand safety is enforced twice, on purpose:
//   • QUERY level   — `sfw=true` on the season request (Jikan strips adult media).
//   • FRONTEND level — isSafeNews() re-checks every assembled item against the
//     parent anime's genres/rating AND a keyword guard on the headline/excerpt,
//     so no Hentai / Ecchi / 18+ article can reach the screen even if MAL
//     mis-tags it. See app/news.tsx.
//
// The article DETAIL (app/news/[id].tsx) wants the full body + inline images,
// which Jikan doesn't expose — fetchNewsArticle() scrapes the MAL news page and
// translates every text block to Arabic.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { translateToArabic } from "./translate";
import { fetchHtml } from "./scraper/direct";

const JIKAN = "https://api.jikan.moe/v4";
const SEASON_CACHE_KEY = "@anime_news_season_v1";
const SEASON_TTL = 6 * 60 * 60 * 1000; // 6h
const SEASON_LIMIT = 20;               // airing titles to draw news from
const PAGE_SIZE = 12;                  // items revealed per feed page (infinite scroll)

export interface NewsItem {
  /** MAL news post id — stable list key + de-dupe. */
  id: number;
  /** Headline, translated to Arabic (the NSFW guard runs on the English original first). */
  title: string;
  url: string;
  /** ISO timestamp of publication. */
  date: string;
  image: string | null;
  /** Snippet, translated to Arabic. */
  excerpt: string;
  /** Parent anime title — shown as the card's source chip (kept as scraped). */
  animeTitle: string;
  comments: number;
}

interface AnimeRef {
  id: number;
  title: string;
  /** All adult-relevant tag names flattened, for the second-pass guard. */
  tags: string[];
}

/* ── NSFW guard (frontend safeguard) ─────────────────────────────
 * Adult genres per MAL's taxonomy + a keyword net over the headline/excerpt.
 * Note: R / R+ ratings (violence, mild nudity) are NORMAL anime (Re:Zero is R) —
 * dropping them would gut the feed — so only the explicit Hentai (Rx) rating and
 * the Ecchi/Hentai/Erotica genres are rejected. */
const ADULT_GENRES = new Set(["Hentai", "Ecchi", "Erotica"]);
const NSFW_RE = /(\bhentai\b|\becchi\b|\bnsfw\b|18\s*\+|\br-?18\b|\beroge\b|\bporn\b|\bdoujinshi?\b)/i;

function animeIsAdult(a: any): boolean {
  if (typeof a?.rating === "string" && /Rx|Hentai/i.test(a.rating)) return true;
  return collectTags(a).some((g) => ADULT_GENRES.has(g));
}

function collectTags(a: any): string[] {
  return [
    ...(a?.genres || []),
    ...(a?.explicit_genres || []),
    ...(a?.themes || []),
    ...(a?.demographics || []),
  ]
    .map((g: any) => g?.name)
    .filter((n: any): n is string => typeof n === "string");
}

/** Second-pass brand-safety check. Exported + self-tested (see bottom). */
export function isSafeNews(item: NewsItem, animeTags: string[]): boolean {
  if (animeTags.some((g) => ADULT_GENRES.has(g))) return false;
  if (NSFW_RE.test(item.title) || NSFW_RE.test(item.excerpt)) return false;
  return true;
}

/* ── Season anime set ────────────────────────────── */

let seasonMem: AnimeRef[] | null = null;
let seasonInflight: Promise<AnimeRef[]> | null = null;

async function ensureSeason(): Promise<AnimeRef[]> {
  if (seasonMem) return seasonMem;
  if (seasonInflight) return seasonInflight;

  seasonInflight = (async () => {
    try {
      const raw = await AsyncStorage.getItem(SEASON_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { ts: number; data: AnimeRef[] };
        if (Date.now() - parsed.ts < SEASON_TTL && parsed.data?.length) {
          seasonMem = parsed.data;
          return parsed.data;
        }
      }
    } catch {}

    const res = await fetch(`${JIKAN}/seasons/now?sfw=true&limit=${SEASON_LIMIT}&page=1`).catch(() => null);
    const json = res && res.ok ? await res.json().catch(() => null) : null;
    const list: AnimeRef[] = (json?.data || [])
      .filter((a: any) => a?.mal_id && a?.title && !animeIsAdult(a)) // query says sfw; re-check anyway
      .map((a: any) => ({ id: a.mal_id, title: a.title, tags: collectTags(a) }));

    if (list.length) {
      seasonMem = list;
      try { await AsyncStorage.setItem(SEASON_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: list })); } catch {}
    }
    return list;
  })().finally(() => { seasonInflight = null; });

  return seasonInflight;
}

/* ── News aggregation ─────────────────────────────
 * The whole feed is fetched once (English), merged across every airing title and
 * sorted newest-first into `sortedRaw`. Pages are slices of that list, so the
 * first card is always the most-recent article. Only a page's visible items are
 * translated to Arabic (lazy) so the first paint isn't gated on translating the
 * entire feed. */

// Flat id→item registry so the detail screen can render an item the list already
// fetched, without re-hitting Jikan or passing the whole object through params.
const registry = new Map<number, NewsItem>();

let sortedRaw: NewsItem[] | null = null;          // globally date-sorted (English)
let rawInflight: Promise<NewsItem[]> | null = null;

/** Concurrency-capped map — keeps fetch/translation bursts polite. */
async function mapLimit<T>(arr: T[], limit: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0;
  const worker = async () => { while (i < arr.length) await fn(arr[i++]); };
  await Promise.all(Array.from({ length: Math.min(limit, arr.length) }, worker));
}

export function getNewsItem(id: number): NewsItem | undefined {
  return registry.get(id);
}

// One title's MAL news, built + NSFW-filtered on the ENGLISH text (the keyword
// guard is English). Not translated here — that happens per visible page.
async function loadAnimeNewsRaw(a: AnimeRef): Promise<NewsItem[]> {
  const res = await fetch(`${JIKAN}/anime/${a.id}/news?page=1`).catch(() => null);
  const json = res && res.ok ? await res.json().catch(() => null) : null;
  return (json?.data || [])
    .map((n: any): NewsItem => ({
      id: n.mal_id,
      title: (n.title || "").trim(),
      url: n.url || "",
      date: n.date || "",
      image: n.images?.jpg?.image_url || null,
      excerpt: (n.excerpt || "").replace(/\s+/g, " ").trim(),
      animeTitle: a.title,
      comments: typeof n.comments === "number" ? n.comments : 0,
    }))
    .filter((n: NewsItem) => n.id && n.title && n.url && isSafeNews(n, a.tags));
}

async function ensureAllNews(): Promise<NewsItem[]> {
  if (sortedRaw) return sortedRaw;
  if (rawInflight) return rawInflight;

  rawInflight = (async () => {
    const anime = await ensureSeason();
    const all: NewsItem[] = [];
    const seen = new Set<number>();
    // Concurrency 3 ≈ Jikan's ~3 req/s budget without an explicit throttle.
    await mapLimit(anime, 3, async (a) => {
      try {
        for (const n of await loadAnimeNewsRaw(a)) {
          if (!seen.has(n.id)) { seen.add(n.id); all.push(n); }
        }
      } catch {}
    });
    all.sort((x, y) => new Date(y.date).getTime() - new Date(x.date).getTime());
    sortedRaw = all;
    return all;
  })().finally(() => { rawInflight = null; });

  return rawInflight;
}

// Translate a visible item to Arabic in place + register it for the detail page.
// Idempotent: translateToArabic returns already-Arabic text untouched.
async function translateItem(n: NewsItem): Promise<void> {
  const [title, excerpt] = await Promise.all([
    translateToArabic(n.title),
    n.excerpt ? translateToArabic(n.excerpt) : Promise.resolve(""),
  ]);
  n.title = title;
  n.excerpt = excerpt;
  registry.set(n.id, n);
}

/**
 * One feed page = the next PAGE_SIZE items from the globally newest-first list,
 * translated to Arabic. The screen calls this on mount and on scroll-end.
 */
export async function fetchNewsPage(page: number): Promise<{ items: NewsItem[]; hasMore: boolean }> {
  const all = await ensureAllNews();
  const slice = all.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  await mapLimit(slice, 6, translateItem);
  return { items: slice, hasMore: (page + 1) * PAGE_SIZE < all.length };
}

/* ── Article detail (full body + images) ──────────
 * Jikan only gives a headline + snippet, so the detail screen scrapes the MAL
 * news page, which serves the article statically inside `<div class="content
 * clearfix">` (inline <img> + <br>-separated text). We split it into ordered
 * text/image blocks and translate every text block to Arabic. */

export interface ArticleBlock {
  type: "text" | "image";
  /** Arabic paragraph (text) or absolute image URL (image). */
  value: string;
}

const articleCache = new Map<number, ArticleBlock[]>();
const MAX_BLOCKS = 80; // bound translation cost on pathological list-style posts

const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#039;": "'",
  "&#39;": "'", "&apos;": "'", "&nbsp;": " ", "&mdash;": "—", "&ndash;": "–", "&hellip;": "…",
};
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? e);
}
function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}

// Inner HTML of `<div class="content clearfix">` via balanced-div matching (the
// article can contain nested divs, so a naïve cut-to-next-marker would truncate).
function extractContentDiv(html: string): string | null {
  const marker = '<div class="content clearfix">';
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const from = start + marker.length;
  const re = /<\/?div\b[^>]*>/gi;
  re.lastIndex = from;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[0].startsWith("</")) { if (--depth === 0) return html.slice(from, m.index); }
    else depth++;
  }
  return html.slice(from); // unbalanced fallback
}

function parseArticle(inner: string): ArticleBlock[] {
  const normalized = inner
    .replace(/\r/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<p\b[^>]*>/gi, "");

  const blocks: ArticleBlock[] = [];
  const pushText = (raw: string) => {
    const text = decodeEntities(stripTags(raw)).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    for (const para of text.split(/\n{2,}/)) {
      const p = para.trim();
      if (p) blocks.push({ type: "text", value: p });
    }
  };

  const imgRe = /<img[^>]*\bsrc="([^"]+)"[^>]*>/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(normalized))) {
    pushText(normalized.slice(last, m.index));
    const src = m[1];
    if (/^https?:\/\//.test(src) && !/sprite|icon|blank\.gif/i.test(src)) {
      blocks.push({ type: "image", value: src });
    }
    last = imgRe.lastIndex;
  }
  pushText(normalized.slice(last));
  return blocks.slice(0, MAX_BLOCKS);
}

/**
 * Full article for the detail screen — ordered Arabic text + image blocks, or
 * null if the page couldn't be fetched/parsed (the screen falls back to the
 * translated excerpt). Cached per id for the session.
 */
export async function fetchNewsArticle(id: number): Promise<ArticleBlock[] | null> {
  const cached = articleCache.get(id);
  if (cached) return cached;

  const item = registry.get(id);
  const url = item?.url || `https://myanimelist.net/news/${id}`;
  const html = await fetchHtml(url, "https://myanimelist.net/").catch(() => null);
  if (!html) return null;

  const inner = extractContentDiv(html);
  if (!inner) return null;

  const blocks = parseArticle(inner);
  if (!blocks.length) return null;

  // Translate text blocks to Arabic (images pass through untouched).
  await mapLimit(blocks.filter((b) => b.type === "text"), 4, async (b) => {
    b.value = await translateToArabic(b.value);
  });

  articleCache.set(id, blocks);
  return blocks;
}

/** Drop the session caches so a pull-to-refresh re-fetches everything. */
export function resetNews(): void {
  seasonMem = null;
  sortedRaw = null;
  registry.clear();
  articleCache.clear();
}

// ── self-check (security path) ────────────────────────────────────
// The NSFW guard is the brand-safety contract; assert it can't silently break.
if (__DEV__) {
  const t = (title: string, tags: string[] = []) =>
    isSafeNews({ id: 1, title, url: "x", date: "", image: null, excerpt: "", animeTitle: "", comments: 0 }, tags);
  console.assert(t("New season announced") === true, "news: safe item rejected");
  console.assert(t("Uncensored Hentai OVA listed") === false, "news: hentai not filtered");
  console.assert(t("Spring Ecchi roundup") === false, "news: ecchi keyword not filtered");
  console.assert(t("Casual slice of life", ["Ecchi"]) === false, "news: ecchi-tagged anime not filtered");
  console.assert(t("Top 10 of 2026", ["Action"]) === true, "news: clean tag wrongly rejected");
}

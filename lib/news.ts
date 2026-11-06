// Anime News feed — scraped straight from MyAnimeList's global news index
// (https://myanimelist.net/news), which lists the LATEST articles across every
// anime, newest-first, ~20 per page (?p=N). This replaces the old Jikan
// per-season aggregation, which could only ever surface news about a handful
// of airing titles and routinely showed weeks-old items as "latest".
//
// Brand safety: two layers drop adult (+18) articles before they are translated
// or displayed — a keyword guard on the English headline (isSafeNews), and a
// subject check (filterAdultNews): each article's breadcrumb names the anime /
// manga it is about, and AniList tells us whether that entry is adult / Hentai /
// Ecchi. Headlines use Japanese titles ("Killing Bites", "Yumene Connect"), so
// the keyword guard alone let most of these through.
//
// Everything user-facing is Arabic: headlines, tag chips and article bodies are
// translated lazily (only the visible page / the opened article) via
// translateToArabic, which caches results on disk.
//
// The article DETAIL (app/news/[id].tsx) wants the full body + inline images +
// trailer embeds. MAL serves the article statically inside
// `<div class="… news-content-body">` — fetchNewsArticle() scrapes it into
// ordered text/image/video blocks and translates every text block, so the whole
// post (trailers included) reads in-app, in Arabic.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { translateToArabic } from "./translate";
import { fetchHtml } from "./scraper/direct";

const MAL = "https://myanimelist.net";
const PAGE_SIZE = 20; // == MAL index page size, so one app page == one GET

export interface NewsItem {
  /** MAL news post id — stable list key + de-dupe. */
  id: number;
  /** Headline, translated to Arabic (the NSFW guard runs on the English original first). */
  title: string;
  url: string;
  /** ISO timestamp of publication. */
  date: string;
  image: string | null;
  /** MAL tag chips ("Preview · Fall 2026"), translated to Arabic. */
  tags: string;
  comments: number;
}

/* ── NSFW guard ─────────────────────────────────────────────────
 * Keyword net over the English headline — MAL's editorial news feed rarely
 * covers adult titles, but when it does (eroge/18+ announcements) the post
 * never reaches the screen. Exported + self-tested (see bottom). */
const NSFW_RE = /(\bhentai\b|\becchi\b|\bnsfw\b|18\s*\+|\br-?18\b|\beroge\b|\bporn\b|\bdoujinshi?\b|\badult (?:game|visual novel)\b)/i;

export function isSafeNews(title: string): boolean {
  return !NSFW_RE.test(title);
}

/* ── Adult-subject filter ───────────────────────
 * The MAL article page's breadcrumb ("Top > Manga > Killing Bites > …") links
 * the entry the post is about. We collect those MAL ids for a whole index page,
 * resolve them on AniList in ONE batched query, and drop any article whose
 * subject is isAdult or carries the Hentai/Ecchi genre. Verdicts are permanent
 * per post, so they're cached on disk and each article is checked only once.
 * Fails OPEN on network errors (not cached) so an AniList outage can't empty
 * the feed — the headline keyword guard still applies. */

const BLOCKED_GENRES = ["Hentai", "Ecchi"];
const VERDICT_KEY = "news-adult-verdicts-v1";
const VERDICT_MAX = 600;
let verdicts: Record<string, 0 | 1> | null = null;

async function loadVerdicts(): Promise<Record<string, 0 | 1>> {
  if (verdicts) return verdicts;
  try { verdicts = JSON.parse((await AsyncStorage.getItem(VERDICT_KEY)) || "{}") || {}; }
  catch { verdicts = {}; }
  return verdicts!;
}
function saveVerdicts(): void {
  if (!verdicts) return;
  const keys = Object.keys(verdicts);
  if (keys.length > VERDICT_MAX) {
    // Keep the newest posts (MAL ids grow over time).
    const keep = keys.sort((a, b) => Number(b) - Number(a)).slice(0, VERDICT_MAX);
    verdicts = Object.fromEntries(keep.map((k) => [k, verdicts![k]]));
  }
  AsyncStorage.setItem(VERDICT_KEY, JSON.stringify(verdicts)).catch(() => {});
}

type Ref = { kind: "anime" | "manga"; id: number };

/**
 * Exported for the self-check: the MAL entries an article page is about — the
 * breadcrumb entry, plus any linked entry sharing its title slug (an adaptation
 * post's breadcrumb is the brand-new anime, which AniList may not have rated
 * yet; its source manga, linked in the body under the same slug, usually is).
 * Other titles a roundup merely mentions are deliberately NOT included.
 */
export function parseBreadcrumbRefs(html: string): Ref[] {
  const out: Ref[] = [];
  const seen = new Set<string>();
  const add = (kind: string, id: string) => {
    if (seen.has(kind + id)) return;
    seen.add(kind + id);
    out.push({ kind: kind as Ref["kind"], id: Number(id) });
  };
  const slugs = new Set<string>();
  const re = /href="https:\/\/myanimelist\.net\/(anime|manga)\/(\d+)\/?([^"/]*)"\s+itemprop="item"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    add(m[1], m[2]);
    if (m[3]) slugs.add(m[3]);
  }
  if (slugs.size) {
    const any = /href="https:\/\/myanimelist\.net\/(anime|manga)\/(\d+)\/([^"/?#]+)"/g;
    while ((m = any.exec(html))) if (slugs.has(m[3])) add(m[1], m[2]);
  }
  return out;
}

async function anilistAdultIds(anime: number[], manga: number[]): Promise<Set<string> | null> {
  if (!anime.length && !manga.length) return new Set();
  const query = `query($a:[Int],$m:[Int]){
    a:Page(perPage:50){media(idMal_in:$a,type:ANIME){idMal isAdult genres}}
    m:Page(perPage:50){media(idMal_in:$m,type:MANGA){idMal isAdult genres}}}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables: { a: anime.slice(0, 50), m: manga.slice(0, 50) } }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const j = await res.json();
    const bad = new Set<string>();
    const scan = (kind: string, list: any[] | undefined) => {
      for (const x of list || []) {
        if (x?.isAdult || (x?.genres || []).some((g: string) => BLOCKED_GENRES.includes(g))) bad.add(kind + x.idMal);
      }
    };
    scan("anime", j?.data?.a?.media);
    scan("manga", j?.data?.m?.media);
    return bad;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Drop articles whose subject anime/manga is adult content. */
async function filterAdultNews(items: NewsItem[]): Promise<NewsItem[]> {
  const v = await loadVerdicts();
  const pending = items.filter((n) => v[n.id] === undefined);
  if (pending.length) {
    const refs = new Map<number, Ref[]>();
    await mapLimit(pending, 6, async (n) => {
      const html = await fetchHtml(n.url, `${MAL}/news`).catch(() => null);
      if (html) refs.set(n.id, parseBreadcrumbRefs(html));
    });
    const all = [...refs.values()].flat();
    const uniq = (k: Ref["kind"]) => [...new Set(all.filter((r) => r.kind === k).map((r) => r.id))];
    const bad = await anilistAdultIds(uniq("anime"), uniq("manga"));
    if (bad) {
      for (const [id, rs] of refs) v[id] = rs.some((r) => bad.has(r.kind + r.id)) ? 1 : 0;
      saveVerdicts();
    }
  }
  return items.filter((n) => v[n.id] !== 1);
}

/* ── HTML helpers ─────────────────────────────── */

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

// MAL thumbnails are served resized (cdn…/r/130x130/….jpeg?s=sig) — strip the
// resize prefix + signature so the card shows the full-resolution image.
function malFullImg(u: string): string {
  return u.replace(/\/r\/\d+x\d+/, "").replace(/\?s=.*$/, "");
}

// MAL index dates look like "Jul 15, 2:48 AM" (no year for the current year).
// ponytail: parsed in DEVICE time while MAL shows US-Pacific — a few hours of
// skew on "time ago" labels; sorting is unaffected since the skew is uniform.
const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};
function parseMalDate(s: string): string {
  const m = s.trim().match(/^([A-Za-z]{3})\.?\s+(\d{1,2}),?\s+(?:(\d{4}),?\s+)?(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return "";
  const year = m[3] ? Number(m[3]) : new Date().getFullYear();
  const hour = (Number(m[4]) % 12) + (m[6].toUpperCase() === "PM" ? 12 : 0);
  const d = new Date(year, MONTHS[m[1].slice(0, 3).toLowerCase()] ?? 0, Number(m[2]), hour, Number(m[5]));
  // At the year boundary a December post parsed in January lands in the
  // future — roll it back a year.
  if (!m[3] && d.getTime() - Date.now() > 24 * 3600 * 1000) d.setFullYear(d.getFullYear() - 1);
  return d.toISOString();
}

/* ── News index (the feed) ──────────────────────
 * The whole feed is the MAL index itself: globally newest-first. Index pages
 * are fetched on demand as the user scrolls; only the visible slice is
 * translated so first paint isn't gated on translating everything. */

// Flat id→item registry so the detail screen can render an item the list
// already fetched, without re-scraping the index or passing objects via params.
const registry = new Map<number, NewsItem>();

/** Concurrency-capped map — keeps fetch/translation bursts polite. */
async function mapLimit<T>(arr: T[], limit: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0;
  const worker = async () => { while (i < arr.length) await fn(arr[i++]); };
  await Promise.all(Array.from({ length: Math.min(limit, arr.length) }, worker));
}

export function getNewsItem(id: number): NewsItem | undefined {
  return registry.get(id);
}

// Parse one MAL news index page. Scoped to the main list (everything before
// the pagination bar) — the "New Anime" rail below it is DB additions, not news.
function parseNewsIndex(html: string): NewsItem[] {
  const cut = html.indexOf('class="pagination');
  const scope = cut > 0 ? html.slice(0, cut) : html;
  const out: NewsItem[] = [];
  const blocks = scope.split('<div class="box-unit3">');
  for (let i = 1; i < blocks.length; i++) {
    const b = blocks[i];
    const hm = b.match(/href="https:\/\/myanimelist\.net\/news\/(\d+)"/);
    const tm = b.match(/<li class="title">([\s\S]*?)<\/li>/);
    if (!hm || !tm) continue;
    const title = decodeEntities(stripTags(tm[1])).replace(/\s+/g, " ").trim();
    if (!title || !isSafeNews(title)) continue;
    const im = b.match(/<img[^>]*\bdata-src="([^"]+)"/);
    const dm = b.match(/<span class="di-ib pr4">([^<]+)<\/span>/);
    const cm = b.match(/<span class="di-b comment">(\d+)/);
    const tags: string[] = [];
    const gre = /<span class="tag tag-color\d+">([\s\S]*?)<\/span>/g;
    let g: RegExpExecArray | null;
    while ((g = gre.exec(b))) {
      const tag = decodeEntities(stripTags(g[1])).trim();
      if (tag) tags.push(tag);
    }
    out.push({
      id: Number(hm[1]),
      title,
      url: `${MAL}/news/${hm[1]}`,
      date: dm ? parseMalDate(dm[1]) : "",
      image: im ? malFullImg(im[1]) : null,
      tags: tags.join(" · "),
      comments: cm ? Number(cm[1]) : 0,
    });
  }
  return out;
}

let feed: NewsItem[] = [];        // accumulated, globally newest-first
let malPage = 0;                  // index pages fetched so far
let exhausted = false;            // an index page came back empty
let feedInflight: Promise<void> | null = null;

async function fetchNextIndexPage(): Promise<void> {
  if (exhausted) return;
  const p = malPage + 1;
  const html = await fetchHtml(`${MAL}/news${p > 1 ? `?p=${p}` : ""}`, `${MAL}/`).catch(() => null);
  if (!html) return; // transient failure — state untouched so a retry can succeed
  const batch = parseNewsIndex(html);
  if (!batch.length) { exhausted = true; return; }
  malPage = p;
  const seen = new Set(feed.map((n) => n.id));
  for (const n of await filterAdultNews(batch)) if (!seen.has(n.id)) feed.push(n);
}

// Translate a visible item to Arabic in place + register it for the detail page.
// Idempotent: translateToArabic returns already-Arabic text untouched.
async function translateItem(n: NewsItem): Promise<void> {
  const [title, tags] = await Promise.all([
    translateToArabic(n.title),
    n.tags ? translateToArabic(n.tags) : Promise.resolve(""),
  ]);
  n.title = title;
  n.tags = tags;
  registry.set(n.id, n);
}

/**
 * One feed page = the next PAGE_SIZE items from the globally newest-first list,
 * translated to Arabic. The screen calls this on mount and on scroll-end.
 */
export async function fetchNewsPage(page: number): Promise<{ items: NewsItem[]; hasMore: boolean }> {
  const need = (page + 1) * PAGE_SIZE;
  while (feed.length < need && !exhausted) {
    const before = feed.length;
    feedInflight ??= fetchNextIndexPage().finally(() => { feedInflight = null; });
    await feedInflight;
    if (feed.length === before) break; // fetch failed — don't spin
  }
  const slice = feed.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  await mapLimit(slice, 6, translateItem);
  return { items: slice, hasMore: !exhausted || feed.length > (page + 1) * PAGE_SIZE };
}

/* ── Article detail (full body + images + trailers) ──────────
 * The MAL news page serves the whole article statically inside
 * `<div class="… news-content-body">` (inline <img>, <br>-separated text and
 * YouTube <iframe> embeds). We split it into ordered text/image/video blocks
 * and translate every text block to Arabic. If the container markup drifts,
 * fall back to the page's og:description so the screen never shows just a link. */

export interface ArticleBlock {
  type: "text" | "image" | "video";
  /** Arabic paragraph (text), absolute image URL (image), embed URL (video). */
  value: string;
}

const articleCache = new Map<number, ArticleBlock[]>();
const MAX_BLOCKS = 120; // bound translation cost on pathological list-style posts

// Inner HTML of the article container via balanced-div matching (the article
// can contain nested divs, so a naïve cut-to-next-marker would truncate).
function extractArticleDiv(html: string): string | null {
  const m = /<div[^>]*class="[^"]*news-content-body[^"]*"[^>]*>/i.exec(html);
  if (!m) return null;
  const from = m.index + m[0].length;
  const re = /<\/?div\b[^>]*>/gi;
  re.lastIndex = from;
  let depth = 1;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(html))) {
    if (mm[0].startsWith("</")) { if (--depth === 0) return html.slice(from, mm.index); }
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

  // Single pass over <img> and <iframe> tokens keeps blocks in article order.
  const tokRe = /<img[^>]*?\bsrc="([^"]+)"[^>]*>|<iframe[^>]*?\bsrc="([^"]+)"[^>]*>[\s\S]*?<\/iframe>/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tokRe.exec(normalized))) {
    pushText(normalized.slice(last, m.index));
    if (m[1]) {
      // MAL bodies occasionally carry cleartext http:// (or protocol-relative
      // //) image URLs — Android blocks cleartext, so those images silently
      // never render. Upgrade everything to https (the CDN serves it fine).
      let src = m[1];
      if (src.startsWith("//")) src = `https:${src}`;
      else if (src.startsWith("http://")) src = `https://${src.slice(7)}`;
      if (/^https:\/\//.test(src) && !/sprite|icon|blank\.gif/i.test(src)) {
        blocks.push({ type: "image", value: src });
      }
    } else if (m[2]) {
      // Trailers embed as youtube-nocookie iframes — normalize to a clean embed.
      const vid = m[2].match(/(?:youtube(?:-nocookie)?\.com\/embed\/|youtu\.be\/)([\w-]{6,})/i);
      if (vid) blocks.push({ type: "video", value: `https://www.youtube-nocookie.com/embed/${vid[1]}?rel=0` });
    }
    last = tokRe.lastIndex;
  }
  pushText(normalized.slice(last));
  return blocks.slice(0, MAX_BLOCKS);
}

/**
 * Full article for the detail screen — ordered Arabic text + image + trailer
 * blocks, or null if the page couldn't be fetched at all. Cached per id for
 * the session.
 */
export async function fetchNewsArticle(id: number): Promise<ArticleBlock[] | null> {
  const cached = articleCache.get(id);
  if (cached) return cached;

  // Safety net for deep links / stale screens: never render a blocked post.
  if ((await loadVerdicts())[id] === 1) return null;
  const item = registry.get(id);
  const url = item?.url || `${MAL}/news/${id}`;
  const html = await fetchHtml(url, `${MAL}/`).catch(() => null);
  if (!html) return null;

  const inner = extractArticleDiv(html);
  let blocks = inner ? parseArticle(inner) : [];
  if (!blocks.length) {
    // Markup drift fallback: og:description always ships with the page, so the
    // screen still shows the story's gist in-app instead of just a link.
    const og = html.match(/<meta property="og:description" content="([^"]+)"/i);
    if (!og) return null;
    blocks = [{ type: "text", value: decodeEntities(og[1]) }];
  }

  // Translate text blocks to Arabic (images/videos pass through untouched).
  await mapLimit(blocks.filter((b) => b.type === "text"), 4, async (b) => {
    b.value = await translateToArabic(b.value);
  });

  articleCache.set(id, blocks);
  return blocks;
}

/** Drop the session caches so a pull-to-refresh re-fetches everything. */
export function resetNews(): void {
  feed = [];
  malPage = 0;
  exhausted = false;
  registry.clear();
  articleCache.clear();
}

// ── self-check (security path) ────────────────────────────────────
// The NSFW guard is the brand-safety contract; assert it can't silently break.
if (__DEV__) {
  console.assert(isSafeNews("New season announced") === true, "news: safe item rejected");
  console.assert(isSafeNews("Uncensored Hentai OVA listed") === false, "news: hentai not filtered");
  console.assert(isSafeNews("Spring Ecchi roundup") === false, "news: ecchi keyword not filtered");
  console.assert(isSafeNews("Top 10 of 2026") === true, "news: clean item wrongly rejected");
  const crumbs = parseBreadcrumbRefs('<a href="https://myanimelist.net/anime.php" itemprop="item"></a><a href="https://myanimelist.net/anime/65326/Hagure_Idol" itemprop="item"></a> <a href="https://myanimelist.net/manga/83835/Hagure_Idol">src</a> <a href="https://myanimelist.net/anime/34964/Other">x</a>');
  console.assert(crumbs.map((r) => r.kind + r.id).join() === "anime65326,manga83835", "news: breadcrumb parse broke");
  // Date parser: a yearless date must land in the recent past, not the future.
  const iso = parseMalDate("Jul 15, 2:48 AM");
  console.assert(!!iso && new Date(iso).getTime() <= Date.now(), "news: yearless date in future");
}

// Real-data grounding for the anime companion.
//
// Models do NOT reliably know per-episode beats, and their general knowledge
// of a show includes everything that happens AFTER the user's episode. So the
// companion is fed what actually happened in episodes 1..N of the exact entry
// being watched — never anything later — plus the premise and main cast:
//
//   AniList   → identifies the exact entry (season/cour): air window, MAL id,
//               English/romaji titles, premise, main characters.
//   TVmaze    → per-episode titles + summaries (great for long runners).
//   Wikipedia → "Episode list" tables (resolves {{:Season page}} transclusions).
//   Jikan     → MAL synopsis of the current episode when the others have none.
//
// Episode sources are matched to the entry by name similarity AND by the
// entry's air window, never by "first search hit" (which used to ground One
// Piece on the live-action show and Frieren on a 10-episode special).
//
// Everything is best-effort with short timeouts and caches; no Deno APIs so
// it can be exercised from Node too.

export type EpisodeInfo = { n: number; title: string | null; summary: string | null };

export type Grounding = {
  /** "الحالة: مكتمل — عدد الحلقات: 28 — صدر من … إلى …" */
  status: string | null;
  enTitle: string | null;
  romaji: string | null;
  /** Series/season premise (AniList description, English). */
  premise: string | null;
  mainCast: string[];
  totalEpisodes: number | null;
  /** The episode being watched. */
  current: EpisodeInfo | null;
  /** Episodes 1..N-1 of this entry, ascending (may be sparse). */
  timeline: EpisodeInfo[];
};

const TTL_MS = 6 * 60 * 60 * 1000;
// Failed lookups are cached briefly: a provider outage must not block
// grounding long after it recovers.
const NULL_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 4_000;
// Air-date slack when matching a source's episodes to the AniList window
// (time zones, simulcast vs. broadcast day).
const WINDOW_SLACK_DAYS = 4;

type Cached<T> = { value: T; at: number };

function cached<T>(map: Map<string, Cached<T>>, key: string): T | undefined {
  const hit = map.get(key);
  if (!hit) return undefined;
  const ttl = hit.value ? TTL_MS : NULL_TTL_MS;
  if (Date.now() - hit.at > ttl) {
    map.delete(key);
    return undefined;
  }
  return hit.value;
}

function remember<T>(map: Map<string, Cached<T>>, key: string, value: T): T {
  if (map.size > 300) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, { value, at: Date.now() });
  return value;
}

async function getJson(url: string, init?: RequestInit, ms = FETCH_TIMEOUT_MS): Promise<any> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export function cleanText(raw: string): string {
  return String(raw || "")
    .replace(/\{\{[^{}]*\}\}/g, " ")
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/<ref[^>]*\/>/gi, " ")
    .replace(/<ref[\s\S]*?<\/ref>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/'{2,}/g, "")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cut at a sentence end near `max` instead of mid-word. */
function clip(text: string | null | undefined, max: number): string | null {
  const t = (text || "").trim();
  if (!t) return null;
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return (end > max * 0.5 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "") + "…").trim();
}

/* ── Titles & seasons ──────────────────────────────────────────────────── */

const ROMAN: Record<string, number> = { II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };

/** Season/part number carried by a title ("Season 2", "2nd Season", "III",
 *  "الموسم 2"); 0 when none. Unicode roman numerals and Arabic digits folded. */
export function seasonOf(raw: string): number {
  const folded = String(raw || "").replace(/[Ⅰ-Ⅹ]/g, (ch) =>
    ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][ch.charCodeAt(0) - 0x2160]
  );
  const lower = folded.toLowerCase().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  const m =
    lower.match(/\b(?:season|part|cour|s)\s*(\d+)\b/) ||
    lower.match(/\b(\d+)(?:st|nd|rd|th)\s+(?:season|part|cour)\b/) ||
    lower.match(/(?:الموسم|الجزء)\s*(\d+)/);
  if (m) return parseInt(m[1], 10);
  const multi = folded.match(/\b(VIII|VII|VI|IV|IX|III|II)\b/i);
  if (multi) return ROMAN[multi[1].toUpperCase()] ?? 0;
  return 0; // single V/X collide with words/title letters — never a season here
}

function tokens(s: string): string[] {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9؀-ۿ]+/g, " ")
    .split(" ")
    .filter((w) => w.length > 1 && !STOP.has(w));
}
const STOP = new Set(["the", "no", "of", "to", "wa", "ga", "season", "part", "cour", "tv", "anime", "and", "a", "an", "episodes", "list"]);

/** Share of the query's words found in the candidate name (0..1). */
function similarity(query: string, name: string): number {
  const q = tokens(query);
  if (!q.length) return 0;
  const n = new Set(tokens(name));
  return q.filter((w) => n.has(w)).length / q.length;
}

/** Title without season/part markers or subtitle — what TVmaze/Wikipedia name the show. */
function baseTitle(title: string): string {
  return title
    .replace(/\b(?:season|part|cour)\s*\d+\b/gi, " ")
    .replace(/\b\d+(?:st|nd|rd|th)\s+(?:season|part|cour)\b/gi, " ")
    .replace(/\b(viii|vii|vi|iv|ix|iii|ii)\b/gi, " ")
    .replace(/\b(?:the\s+)?final\s+season\b/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/[\s:：\-–]+$/, "")
    .trim();
}

/* ── AniList: the exact entry ──────────────────────────────────────────── */

type AniEntry = {
  idMal: number | null;
  status: string | null;
  episodes: number | null;
  start: string | null;
  end: string | null;
  romaji: string | null;
  english: string | null;
  premise: string | null;
  mainCast: string[];
};

const ANILIST_STATUS_AR: Record<string, string> = {
  FINISHED: "مكتمل",
  RELEASING: "يُعرض حاليًا",
  NOT_YET_RELEASED: "لم يبدأ عرضه بعد",
  CANCELLED: "ملغى",
  HIATUS: "متوقف مؤقتًا",
};

type AniDate = { year?: number | null; month?: number | null; day?: number | null } | null | undefined;

function aniDate(d: AniDate): string | null {
  if (!d?.year) return null;
  return `${d.year}-${String(d.month ?? 1).padStart(2, "0")}-${String(d.day ?? 1).padStart(2, "0")}`;
}

const aniCache = new Map<string, Cached<AniEntry | null>>();

const ANILIST_QUERY = `query ($search: String) {
  Page(perPage: 8) {
    media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
      idMal status episodes format
      startDate { year month day } endDate { year month day }
      title { romaji english }
      description(asHtml: false)
      characters(role: MAIN, perPage: 8, sort: [ROLE, RELEVANCE, ID]) { nodes { name { full } } }
    }
  }
}`;

const SERIES_FORMATS = new Set(["TV", "TV_SHORT", "ONA"]);

async function fetchAniList(searchTitle: string, season: number): Promise<AniEntry | null> {
  const key = `${searchTitle.toLowerCase().trim()}#s${season}`;
  const hit = cached(aniCache, key);
  if (hit !== undefined) return hit;

  const json = await getJson("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query: ANILIST_QUERY, variables: { search: searchTitle } }),
  });
  const media: any[] = Array.isArray(json?.data?.Page?.media) ? json.data.Page.media : [];
  // The user is watching this right now, so it cannot be unreleased.
  const released = media.filter((m) => m?.status && m.status !== "NOT_YET_RELEASED");
  const titleOf = (m: any) => `${m?.title?.romaji || ""} ${m?.title?.english || ""}`;
  // A requested season must match; without one, prefer an entry that is not
  // itself a numbered later season (that's the base show).
  const seasonOk = season > 0
    ? released.filter((m) => seasonOf(titleOf(m)) === season)
    : released.filter((m) => seasonOf(titleOf(m)) <= 1);
  const pool = seasonOk.length ? seasonOk : season > 0 ? [] : released;
  const pick = pool.find((m) => SERIES_FORMATS.has(m?.format)) ?? pool[0];

  let entry: AniEntry | null = null;
  if (pick) {
    const premise = clip(
      cleanText(String(pick.description || "").replace(/<br\s*\/?>/gi, " "))
        .replace(/\(\s*Source:[^)]*\)/gi, "")
        .replace(/\s*Note:.*$/i, "")
        .trim(),
      650,
    );
    entry = {
      idMal: typeof pick.idMal === "number" ? pick.idMal : null,
      status: pick.status ?? null,
      episodes: typeof pick.episodes === "number" ? pick.episodes : null,
      start: aniDate(pick.startDate),
      end: aniDate(pick.endDate),
      romaji: pick.title?.romaji?.trim() || null,
      english: pick.title?.english?.trim() || null,
      premise,
      mainCast: (pick.characters?.nodes ?? [])
        .map((c: any) => String(c?.name?.full || "").trim())
        .filter(Boolean)
        .slice(0, 8),
    };
  }
  return remember(aniCache, key, entry);
}

function statusLine(a: AniEntry): string | null {
  const bits: string[] = [];
  if (a.status) bits.push(`الحالة: ${ANILIST_STATUS_AR[a.status] ?? a.status}`);
  if (a.episodes) bits.push(`عدد حلقات هذا الجزء: ${a.episodes}`);
  if (a.start) bits.push(a.end ? `صدر من ${a.start} إلى ${a.end}` : `بدأ عرضه في ${a.start}`);
  return bits.length ? bits.join(" — ") : null;
}

/* ── Episode sources ───────────────────────────────────────────────────── */

/** One episode as a source lists it. `season`/`number` = season-local,
 *  `overall` = running number across the whole show when the source has it. */
type SourceEp = {
  title: string | null;
  summary: string | null;
  airdate: string | null;
  season: number | null;
  number: number | null;
};

const tvSearchCache = new Map<string, Cached<number | null>>();
const tvEpisodesCache = new Map<string, Cached<SourceEp[] | null>>();

async function tvmazeEpisodes(query: string): Promise<SourceEp[] | null> {
  const q = baseTitle(query);
  if (!q) return null;
  let showId = cached(tvSearchCache, q.toLowerCase());
  if (showId === undefined) {
    const list = await getJson(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(q)}`);
    let best: { id: number; score: number } | null = null;
    for (const item of Array.isArray(list) ? list : []) {
      const show = item?.show;
      if (typeof show?.id !== "number") continue;
      // Anime only: "One Piece" search returns the live-action show first.
      if (show.type !== "Animation" && show.language !== "Japanese") continue;
      const score = Math.max(similarity(q, show.name), similarity(show.name, q) * 0.9);
      if (score >= 0.6 && (!best || score > best.score)) best = { id: show.id, score };
    }
    showId = remember(tvSearchCache, q.toLowerCase(), best?.id ?? null);
  }
  if (!showId) return null;

  const key = String(showId);
  const hit = cached(tvEpisodesCache, key);
  if (hit !== undefined) return hit;
  const eps = await getJson(`https://api.tvmaze.com/shows/${showId}/episodes`);
  const out: SourceEp[] | null = Array.isArray(eps)
    ? eps
      .filter((e: any) => e && (e.type === "regular" || !e.type))
      .map((e: any) => ({
        title: typeof e.name === "string" && !/^episode \d+$/i.test(e.name) ? e.name.slice(0, 160) : null,
        summary: typeof e.summary === "string" ? clip(cleanText(e.summary), 900) : null,
        airdate: typeof e.airdate === "string" && e.airdate ? e.airdate : null,
        season: typeof e.season === "number" ? e.season : null,
        number: typeof e.number === "number" ? e.number : null,
      }))
    : null;
  return remember(tvEpisodesCache, key, out && out.length ? out : null);
}

const wikiCache = new Map<string, Cached<SourceEp[] | null>>();

async function wikiText(page: string): Promise<string> {
  const data = await getJson(
    `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&redirects=1&format=json&formatversion=2`,
  );
  return typeof data?.parse?.wikitext === "string" ? data.parse.wikitext : "";
}

function parseEpisodeBlocks(wikitext: string, pageSeason: number): SourceEp[] {
  const out: SourceEp[] = [];
  for (const block of wikitext.split(/\{\{\s*Episode list/i).slice(1)) {
    const field = (name: string) =>
      block.match(new RegExp(`\\|\\s*${name}\\s*=\\s*([\\s\\S]*?)(?=\\n\\s*\\||\\n?\\}\\}\\s*$|$)`, "i"))?.[1];
    const overall = parseInt(field("EpisodeNumber") ?? "", 10);
    const local = parseInt(field("EpisodeNumber2") ?? "", 10);
    const date = (field("OriginalAirDate") ?? "").match(/(\d{4})\|(\d{1,2})\|(\d{1,2})/);
    const rawTitle = field("Title")?.split("\n")[0];
    const rawSummary = field("ShortSummary");
    out.push({
      title: rawTitle ? cleanText(rawTitle).replace(/^"|"$/g, "").slice(0, 160) || null : null,
      summary: rawSummary ? clip(cleanText(rawSummary), 900) : null,
      airdate: date ? `${date[1]}-${date[2].padStart(2, "0")}-${date[3].padStart(2, "0")}` : null,
      season: pageSeason || null,
      // Season pages number locally in EpisodeNumber2; flat lists only have
      // the running EpisodeNumber.
      number: Number.isFinite(local) ? local : Number.isFinite(overall) ? overall : null,
    });
  }
  return out;
}

async function wikipediaEpisodes(query: string, season: number): Promise<SourceEp[] | null> {
  const base = baseTitle(query);
  if (!base) return null;
  const key = `${base.toLowerCase()}#s${season}`;
  const hit = cached(wikiCache, key);
  if (hit !== undefined) return hit;

  const searchQ = season > 0 ? `${base} season ${season} episodes` : `List of ${base} episodes`;
  const sdata = await getJson(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(searchQ)}&srlimit=6&format=json`,
  );
  const titles: string[] = Array.isArray(sdata?.query?.search)
    ? sdata.query.search.map((r: any) => String(r?.title || ""))
    : [];
  // Must be about THIS show and be an episode page.
  const relevant = titles.filter((t) => similarity(base, t) >= 0.6 && /episodes|season|part/i.test(t));
  const page = (season > 0 ? relevant.find((t) => seasonOf(t) === season) : null) ??
    relevant.find((t) => /^List of .* episodes/i.test(t)) ??
    relevant[0];

  let eps: SourceEp[] | null = null;
  if (page) {
    const wt = await wikiText(page);
    let blocks = parseEpisodeBlocks(wt, seasonOf(page));
    if (!blocks.length) {
      // Long lists transclude one article per season: {{:Naruto season 5}}.
      const subs = [...wt.matchAll(/\{\{:([^}|]+)\}\}/g)].map((m) => m[1].trim()).slice(0, 14);
      const texts = await Promise.all(subs.map((p) => wikiText(p).then((t) => ({ p, t }))));
      blocks = texts.flatMap(({ p, t }) => parseEpisodeBlocks(t, seasonOf(p)));
    }
    eps = blocks.length ? blocks : null;
  }
  return remember(wikiCache, key, eps);
}

const jikanCache = new Map<string, Cached<EpisodeInfo | null>>();

async function jikanEpisode(idMal: number, ep: number): Promise<EpisodeInfo | null> {
  const key = `${idMal}#${ep}`;
  const hit = cached(jikanCache, key);
  if (hit !== undefined) return hit;
  const data = await getJson(`https://api.jikan.moe/v4/anime/${idMal}/episodes/${ep}`);
  const d = data?.data;
  const info: EpisodeInfo | null = d
    ? {
      n: ep,
      title: typeof d.title === "string" && d.title.trim() ? d.title.trim().slice(0, 160) : null,
      summary: typeof d.synopsis === "string" && d.synopsis.trim()
        ? clip(cleanText(d.synopsis.replace(/\(Source:[^)]*\)/gi, "")), 900)
        : null,
    }
    : null;
  return remember(jikanCache, key, info && (info.title || info.summary) ? info : null);
}

/* ── Alignment: source episodes → this entry's episodes 1..N ───────────── */

function dayDiff(a: string, b: string): number {
  return (Date.parse(a) - Date.parse(b)) / 86_400_000;
}

/**
 * The first `epNum` episodes of the entry being watched, in order, or null
 * when the source can't be matched with confidence (wrong grounding is worse
 * than none). Preference: the AniList air window (exact cour) → explicit
 * season number → whole-show running order (long runners).
 */
function align(eps: SourceEp[] | null, epNum: number, season: number, ani: AniEntry | null): EpisodeInfo[] | null {
  if (!eps?.length) return null;
  const toInfo = (list: SourceEp[]) =>
    list.slice(0, epNum).map((e, i) => ({ n: i + 1, title: e.title, summary: e.summary }));

  if (ani?.start) {
    const start = ani.start;
    const end = ani.end;
    const inWindow = (e: SourceEp) =>
      !!e.airdate &&
      dayDiff(e.airdate, start) >= -WINDOW_SLACK_DAYS &&
      (!end || dayDiff(e.airdate, end) <= WINDOW_SLACK_DAYS);
    const window = eps.filter(inWindow);
    if (window.length >= epNum) return toInfo(window);
    // The source's dates may be off (e.g. a streaming release date) — accept a
    // positional match only if it still lands inside the window.
    const bySeason = season > 0 ? eps.filter((e) => e.season === season) : eps;
    const cand = bySeason[epNum - 1];
    if (cand?.airdate && inWindow(cand)) return toInfo(bySeason);
    if (cand?.airdate) return null;
  }
  if (season > 0) {
    const s = eps.filter((e) => e.season === season);
    if (s.length >= epNum) return toInfo(s);
    return null;
  }
  return eps.length >= epNum ? toInfo(eps) : null;
}

/** Fill the gaps of `primary` from `secondary` (same alignment), per episode. */
function merge(primary: EpisodeInfo[] | null, secondary: EpisodeInfo[] | null): EpisodeInfo[] | null {
  if (!primary) return secondary;
  if (!secondary) return primary;
  return primary.map((p, i) => {
    const s = secondary[i];
    if (!s) return p;
    const summary = (s.summary?.length ?? 0) > (p.summary?.length ?? 0) * 1.3 ? s.summary : p.summary ?? s.summary;
    return { n: p.n, title: p.title ?? s.title, summary };
  });
}

/* ── Entry point ───────────────────────────────────────────────────────── */

const groundCache = new Map<string, Cached<Grounding | null>>();

/**
 * Grounding for episode `epNum` of the anime. `out` is filled progressively
 * (AniList facts first, episodes after), so a caller that stops waiting
 * still gets whatever arrived.
 */
export async function fetchGrounding(
  titles: string[],
  epNum: number,
  season: number,
  out: Partial<Grounding> = {},
): Promise<Partial<Grounding>> {
  const queries = titles.map((t) => t.trim()).filter((t, i, a) => t && a.indexOf(t) === i);
  if (!queries.length) return out;
  const key = `${queries[0].toLowerCase()}#s${season}#${epNum}`;
  const hit = cached(groundCache, key);
  if (hit) return Object.assign(out, hit);

  // Latin titles identify the show on AniList; an Arabic site title rarely does.
  let ani: AniEntry | null = null;
  for (const q of queries) {
    ani = await fetchAniList(q, season);
    if (ani) break;
  }
  if (ani) {
    out.status = statusLine(ani);
    out.enTitle = ani.english;
    out.romaji = ani.romaji;
    out.premise = ani.premise;
    out.mainCast = ani.mainCast;
    out.totalEpisodes = ani.episodes;
  }

  // Each title plus its pre-subtitle form: sources name the show
  // "Demon Slayer", not "Demon Slayer: … Entertainment District Arc".
  const names = [ani?.english, ani?.romaji, ...queries]
    .filter((t): t is string => !!t && /[a-z]/i.test(t))
    .flatMap((t) => [t, t.split(/[:：]/)[0]])
    .filter((t, i, a) => a.findIndex((x) => baseTitle(x).toLowerCase() === baseTitle(t).toLowerCase()) === i)
    .slice(0, 5);

  const firstAligned = async (fetcher: (n: string) => Promise<SourceEp[] | null>) => {
    for (const n of names) {
      const aligned = align(await fetcher(n), epNum, season, ani);
      if (aligned) return aligned;
    }
    return null;
  };
  const [tv, wiki, jikan] = await Promise.all([
    firstAligned(tvmazeEpisodes),
    firstAligned((n) => wikipediaEpisodes(n, season)),
    ani?.idMal ? jikanEpisode(ani.idMal, epNum) : Promise.resolve(null),
  ]);

  // The source with more summaries leads; the other fills its gaps.
  const count = (l: EpisodeInfo[] | null) => l?.filter((e) => e.summary).length ?? 0;
  const merged = count(wiki) > count(tv) ? merge(wiki, tv) : merge(tv, wiki);
  let current = merged?.[epNum - 1] ?? null;
  if (jikan && (!current?.summary || !current.title)) {
    current = {
      n: epNum,
      title: current?.title ?? jikan.title,
      summary: current?.summary ?? jikan.summary,
    };
  }
  out.current = current;
  out.timeline = merged ? merged.slice(0, epNum - 1) : [];

  const done = out as Grounding;
  const empty = !ani && !current && !out.timeline.length;
  remember(groundCache, key, empty ? null : { ...done });
  return out;
}

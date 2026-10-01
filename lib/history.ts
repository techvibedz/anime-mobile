import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase, isSupabaseConfigured, getSessionUser } from "./supabase";
import { groupContinueWatching } from "./continueWatching";
import { mergeHistory } from "./historyMerge";
import { pruneCacheStorage } from "./storageMaintenance";

const KEY = "watch_history";
const MAX_ITEMS = 200;

const historyListeners = new Set<() => void>();
export function subscribeHistory(cb: () => void): () => void {
  historyListeners.add(cb);
  return () => { historyListeners.delete(cb); };
}

// In-memory read-through cache. Every reader used to AsyncStorage.getItem +
// JSON.parse the full (up to 200-entry) list — the watch screen's 5s save loop,
// getProgress, getCompletedSets, etc. all paid that repeatedly. All writes go
// through saveHistory, so the cache is always current within this module.
let historyCache: WatchEntry[] | null = null;

let localWriteFailureLogged = false;
async function saveHistory(list: WatchEntry[]) {
  historyCache = list;
  const payload = JSON.stringify(list);
  try {
    await AsyncStorage.setItem(KEY, payload);
  } catch (first) {
    // The Android AsyncStorage DB is capped (6 MB by default) and this app
    // caches heavily; when it fills EVERY write fails and history silently
    // stops persisting. Drop the re-fetchable caches and retry once — losing
    // metadata caches is recoverable, losing watch progress is not.
    const pruned = await pruneCacheStorage();
    try {
      await AsyncStorage.setItem(KEY, payload);
      console.info(`[history] write recovered after pruning ${pruned} cache keys`);
    } catch (second) {
      if (!localWriteFailureLogged) {
        localWriteFailureLogged = true;
        console.warn("[history] local write failed:", second);
        void import("./remoteLog").then(({ remoteLog }) =>
          remoteLog("error", "app", "history local write failed", { pruned, error: String(second) }),
        ).catch(() => {});
      }
    }
  }
  for (const cb of historyListeners) cb();
}

export interface WatchEntry {
  episodeHref: string;
  episodeTitle: string;
  animeTitle: string;
  animeHref: string;
  image: string;
  positionMs: number;
  durationMs: number;
  updatedAt: number;
  url4up?: string;
  completed?: boolean;
  /** Episode number, when known — lets watched-state bridge across sources
   *  (the same episode has a different URL on witanime / anime4up / anime3rb). */
  epNum?: number;
  /** Hidden from the "Continue Watching" row but progress is preserved. */
  dismissed?: boolean;
}

/**
 * Treat playback as "watched" once past 80% of duration. Anime outros/endings
 * routinely run the last ~10-15%, and most viewers stop there — so 80% is the
 * point at which an episode is effectively finished.
 */
function autoCompleted(e: WatchEntry): boolean {
  return e.durationMs > 0 && e.positionMs / e.durationMs >= 0.8;
}

/** Push a single history entry to Supabase (fire-and-forget; logs on failure). */
let cloudPushFailureLogged = false;
async function pushToCloud(entry: WatchEntry) {
  if (!isSupabaseConfigured) return;
  const user = await getSessionUser();
  if (!user) return;
  const { error } = await supabase.from("watch_history").upsert({
    user_id: user.id,
    episode_href: entry.episodeHref,
    episode_title: entry.episodeTitle,
    anime_title: entry.animeTitle,
    anime_href: entry.animeHref,
    image: entry.image,
    position_ms: entry.positionMs,
    duration_ms: entry.durationMs,
    updated_at: new Date(entry.updatedAt).toISOString(),
    url4up: entry.url4up ?? null,
    completed: entry.completed ?? autoCompleted(entry),
    dismissed: entry.dismissed ?? false,
  }, { onConflict: "user_id,episode_href" });
  if (error) {
    console.warn("[history] cloud sync failed:", error.message);
    // One log per session — this fires on every 5s progress save otherwise.
    if (!cloudPushFailureLogged) {
      cloudPushFailureLogged = true;
      void import("./remoteLog").then(({ remoteLog }) =>
        remoteLog("warn", "app", "watch_history upsert failed", { message: error.message }),
      ).catch(() => {});
    }
  }
}

async function deleteFromCloud(episodeHref: string) {
  if (!isSupabaseConfigured) return;
  const user = await getSessionUser();
  if (!user) return;
  await supabase.from("watch_history").delete()
    .eq("user_id", user.id)
    .eq("episode_href", episodeHref);
}

/**
 * Hydrate local cache from Supabase (called after sign-in).
 *
 * MERGE, never replace: this used to overwrite local storage with whatever the
 * cloud had. A single failed push (offline save, expired session, a row the
 * server rejected) meant the next cold start wiped the user's progress and
 * Continue Watching row — "it doesn't save what I watched". Local entries the
 * cloud doesn't know about are kept; for shared hrefs the newer updatedAt wins.
 */
export async function pullHistoryFromCloud() {
  if (!isSupabaseConfigured) return;
  const user = await getSessionUser();
  if (!user) return;
  const { data, error } = await supabase.from("watch_history")
    .select("*")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(MAX_ITEMS);
  if (error) { console.warn("[history] pull failed:", error.message); return; }
  if (!data) return;
  const remote: WatchEntry[] = data.map((row: any) => ({
    episodeHref: row.episode_href,
    episodeTitle: row.episode_title,
    animeTitle: row.anime_title,
    animeHref: row.anime_href,
    image: row.image || "",
    positionMs: row.position_ms,
    durationMs: row.duration_ms,
    updatedAt: new Date(row.updated_at).getTime(),
    url4up: row.url4up || undefined,
    completed: !!row.completed,
    dismissed: !!row.dismissed,
  }));
  const local = await getHistory();
  await saveHistory(mergeHistory(local, remote, MAX_ITEMS));
}

export async function getHistory(): Promise<WatchEntry[]> {
  if (historyCache) return historyCache.slice();
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) { historyCache = []; return []; }
  try {
    historyCache = JSON.parse(raw) as WatchEntry[];
    return historyCache.slice();
  } catch {
    // ponytail: a partial write (crash mid-setItem / an older incompatible
    // build) leaves garbage here for ONE user and throws on every read —
    // poisoning getContinueWatching/saveProgress too. Reset to empty; the
    // cloud pull on sign-in rehydrates it.
    void AsyncStorage.removeItem(KEY).catch(() => {});
    historyCache = [];
    return [];
  }
}

// Cloud pushes are coalesced: the watch screen saves every 5s, and each push
// used to be a network upsert + session read. Pushing the latest state per
// episode at most every 30s (trailing flush) keeps the cloud current without
// waking the radio on every tick.
const CLOUD_PUSH_MIN_GAP_MS = 30_000;
let lastCloudPushAt = 0;
let cloudPushTimer: ReturnType<typeof setTimeout> | null = null;
const pendingCloud = new Map<string, WatchEntry>();

function flushCloudPushes() {
  if (cloudPushTimer) { clearTimeout(cloudPushTimer); cloudPushTimer = null; }
  if (pendingCloud.size === 0) return;
  lastCloudPushAt = Date.now();
  const batch = [...pendingCloud.values()];
  pendingCloud.clear();
  for (const entry of batch) void pushToCloud(entry).catch(() => {});
}

function scheduleCloudPush(entry: WatchEntry) {
  pendingCloud.set(entry.episodeHref, entry);
  const wait = CLOUD_PUSH_MIN_GAP_MS - (Date.now() - lastCloudPushAt);
  if (wait <= 0) { flushCloudPushes(); return; }
  if (!cloudPushTimer) cloudPushTimer = setTimeout(flushCloudPushes, wait);
}

export async function saveProgress(entry: Omit<WatchEntry, "updatedAt">) {
  const list = await getHistory();
  const idx = list.findIndex((e) => e.episodeHref === entry.episodeHref);
  const merged: WatchEntry = {
    ...entry,
    updatedAt: Date.now(),
    // Auto-mark completed when crossing 80% — preserve a manual unmark.
    completed: entry.completed ?? (idx >= 0 ? list[idx].completed : false),
    // Actively watching again — bring it back into Continue Watching.
    dismissed: false,
  };
  if (merged.completed !== true && autoCompleted(merged)) merged.completed = true;
  // No-op guard: a paused/backgrounded player re-sends the identical position
  // every 5s. Skip the storage write + cloud push when nothing changed.
  const prev = idx >= 0 ? list[idx] : null;
  if (
    prev &&
    prev.positionMs === merged.positionMs &&
    prev.durationMs === merged.durationMs &&
    prev.completed === merged.completed &&
    prev.dismissed === merged.dismissed &&
    prev.episodeTitle === merged.episodeTitle &&
    prev.animeTitle === merged.animeTitle
  ) {
    return;
  }
  if (idx >= 0) {
    list[idx] = merged;
  } else {
    list.unshift(merged);
    if (list.length > MAX_ITEMS) list.length = MAX_ITEMS;
  }
  list.sort((a, b) => b.updatedAt - a.updatedAt);
  await saveHistory(list);
  scheduleCloudPush(merged);
}

/**
 * One entry per anime for the "Continue Watching" row — the most recently
 * watched episode of each series, so the user resumes where they stopped
 * instead of seeing every episode they've watched.
 */
export async function getContinueWatching(): Promise<WatchEntry[]> {
  return groupContinueWatching(await getHistory());
}

export async function getProgress(episodeHref: string): Promise<WatchEntry | null> {
  const list = await getHistory();
  return list.find((e) => e.episodeHref === episodeHref) ?? null;
}

export async function removeFromHistory(episodeHref: string) {
  const list = await getHistory();
  pendingCloud.delete(episodeHref);
  await saveHistory(list.filter((e) => e.episodeHref !== episodeHref));
  deleteFromCloud(episodeHref).catch(() => {});
}

/**
 * Hide an episode from the "Continue Watching" row WITHOUT discarding its
 * progress. The entry stays in history (and in the cloud), so reopening the
 * episode later still resumes exactly where the user stopped — the saved
 * position lives on with the account, forever, until they watch past it.
 */
export async function dismissFromContinue(episodeHref: string) {
  const list = await getHistory();
  const idx = list.findIndex((e) => e.episodeHref === episodeHref);
  if (idx < 0) return;
  // Dismiss EVERY entry of this anime — the row groups by anime, so hiding a
  // single episode would just reveal the previous one (see groupContinueWatching).
  // Match by href-key AND by normalized title: the same anime can be stored
  // under different animeHref values (episode URL vs anime URL) and would
  // otherwise leave a second card behind.
  const target = list[idx];
  const key = target.animeHref || target.animeTitle;
  const titleKey = animeTitleKey(target.animeTitle);
  const touched: WatchEntry[] = [];
  for (const entry of list) {
    const sameAnime = (entry.animeHref || entry.animeTitle) === key ||
      (!!titleKey && animeTitleKey(entry.animeTitle) === titleKey);
    if (!sameAnime) continue;
    entry.dismissed = true;
    // Bump the timestamp so the dismissal beats any older cloud row on the
    // next merge-pull (and stays the newest entry, keeping the anime hidden).
    entry.updatedAt = Date.now();
    touched.push(entry);
  }
  await saveHistory(list);
  void Promise.all(touched.map((entry) => pushToCloud(entry).catch(() => {})));
}

export function formatProgress(entry: WatchEntry): string {
  const pct = entry.durationMs > 0 ? Math.round((entry.positionMs / entry.durationMs) * 100) : 0;
  return `${pct}%`;
}

export function progressPercent(entry: WatchEntry): number {
  return entry.durationMs > 0 ? Math.min(entry.positionMs / entry.durationMs, 1) : 0;
}

/* ── Watched-episode flag (per user) ─────────────────── */

export function isCompleted(entry: WatchEntry | null | undefined): boolean {
  if (!entry) return false;
  if (typeof entry.completed === "boolean") return entry.completed;
  return autoCompleted(entry);
}

/** Normalize an episode URL so encoding / trailing-slash / case differences
 *  between sources don't defeat equality checks. */
export function normHref(u: string | null | undefined): string {
  if (!u) return "";
  try { return decodeURIComponent(u).replace(/\/+$/, "").toLowerCase(); }
  catch { return u.replace(/\/+$/, "").toLowerCase(); }
}

// Stabilize a per-anime key across witanime's rotating TLD (.life/.you/...).
// Collapses the host to its second-level label (drop the TLD) + path, so the
// SAME anime keyed while the app resolved a different TLD folds to one identity.
// Used by notifications (dedup) AND completion badges (lookup) — a record stored
// under witanime.life must still match a lookup resolved under witanime.you.
// MUST stay byte-identical to normAnimeKey() in supabase/functions/episode-notifier.
export function normAnimeKey(k: string): string {
  if (!k) return "";
  try {
    const u = new URL(k);
    const host = u.hostname.replace(/^www\./, "");
    const labels = host.split(".");
    const sld = labels.length >= 2 ? labels[labels.length - 2] : host;
    return (sld + u.pathname).replace(/\/+$/, "").toLowerCase();
  } catch {
    return k.trim().toLowerCase();
  }
}

/**
 * Normalize an anime title into a cross-source key. The same anime carries an
 * identical romaji name on witanime / anime4up / anime3rb (e.g. "Tensei shitara
 * Slime Datta Ken 4th Season"), so a normalized title + episode number lets a
 * "watched" flag set in one source light up in the others — the episode URLs
 * themselves differ per source and can't be compared. Keeps Latin alphanumerics
 * and Arabic letters; folds case, diacritics, punctuation and spacing.
 */
// Source/SEO decoration words dropped from a title key so a decorated title
// (anime3rb stores "أنمي … مترجم") keys identically to the clean name another
// source stores. Matched as whole tokens before any Unicode folding (NFKD would
// decompose the Arabic hamza and defeat a literal compare).
const TITLE_DECORATION = new Set([
  "أنمي", "انمي", "انيمي", "مترجم", "مترجمة", "مدبلج", "مدبلجة", "مشاهدة",
  "تحميل", "اون", "أون", "أونلاين", "لاين", "بجودة", "عالية", "حلقات",
  "الحلقات", "جميع", "عرب", "anime3rb", "anime4up", "witanime",
]);

// Memo cache — animeTitleKey runs NFKD + regex tokenization, which is wasteful
// when called repeatedly for the SAME titles (the episode grid asks for the
// anime's key once per card, and getCompletedSets once per history row). Titles
// are few and bounded, so a plain Map keyed by the raw input is enough.
const titleKeyCache = new Map<string, string>();

export function animeTitleKey(s: string | null | undefined): string {
  const raw = s || "";
  const cached = titleKeyCache.get(raw);
  if (cached !== undefined) return cached;
  // Fold BEFORE tokenizing so combining marks survive to the fold step: the
  // old order replaced "é" with a space first, turning "Café Étoile" into
  // "caftoile" while "Cafe Etoile" became "cafeetoile" — the two spellings of
  // one title never matched. Same for Arabic orthography variants (hamza
  // forms, taa marbuta, alef maqsura, tashkeel, tatweel, Arabic-Indic digits)
  // that different sources' scrapes produce for the SAME anime.
  // Decoration tokens are still filtered on the folded tokens; the set carries
  // both hamza spellings of each word.
  const key = raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u064B-\u0655\u0640\u0670]/g, "")
    .toLowerCase()
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[^a-z0-9؀-ۿ]+/g, " ")
    .trim()
    .split(" ")
    .filter((tok) => tok && !TITLE_DECORATION.has(tok))
    .join("");
  if (titleKeyCache.size > 2000) titleKeyCache.clear();
  titleKeyCache.set(raw, key);
  return key;
}

/** Pull an episode number out of a history entry — the stored epNum when
 *  present, else parsed from the episode URL (…الحلقة-N / /episode/slug/N) or
 *  the episode title. Returns null when none can be found. */
function deriveEpNum(e: WatchEntry): number | null {
  if (typeof e.epNum === "number" && e.epNum > 0) return e.epNum;
  const fromStr = (s?: string): number | null => {
    if (!s) return null;
    let d = s;
    try { d = decodeURIComponent(s); } catch {}
    let m =
      d.match(/الحلقة[\s\-_]*(\d+)/) ||
      d.match(/\/(?:episode|watch)\/[^/]+\/(\d+)(?:\/|$)/i) ||
      d.match(/\bepisode\s*(\d+)/i);
    return m ? parseInt(m[1], 10) : null;
  };
  return fromStr(e.episodeHref) ?? fromStr(e.episodeTitle);
}

/**
 * Set of normalized hrefs for EVERY episode the user has completed (across all
 * anime). The anime detail page matches each episode's source hrefs (witanime /
 * anime4up / anime3rb) against this set, so an episode counts as watched no
 * matter which source URL was actually played — and without depending on the
 * stored animeHref matching the page's animeHref (it frequently doesn't, since
 * the player records a scraped href while the page uses the navigation id).
 */
export async function getCompletedEpisodeHrefs(): Promise<Set<string>> {
  const list = await getHistory();
  const set = new Set<string>();
  for (const e of list) if (isCompleted(e)) set.add(normHref(e.episodeHref));
  return set;
}

/** True if any of the given source hrefs has been completed. */
export function isEpisodeCompleted(
  completed: Set<string>,
  hrefs: (string | null | undefined)[],
): boolean {
  return hrefs.some((h) => h && completed.has(normHref(h)));
}

/**
 * Completed-episode index for the detail page. Carries BOTH:
 *   • hrefs — normalized URLs of every completed episode (same-source match), and
 *   • numbersByTitle — per-anime (normalized title) set of completed episode
 *     numbers, which bridges sources: watching episode 5 of "Naruto" on witanime
 *     marks episode 5 watched when the same anime is opened from anime4up/anime3rb
 *     (whose episode URLs are different and would never match by href).
 */
export interface CompletedSets {
  hrefs: Set<string>;
  numbersByTitle: Map<string, Set<number>>;
  /** Title keys that appear in history AT ALL (completed or not). Lets callers
   *  tell "explicitly unwatched" apart from "no tracked history under this
   *  title" (title drift between sources) — see reconcileCompletionFromEpisodes. */
  knownTitles: Set<string>;
}

export async function getCompletedSets(): Promise<CompletedSets> {
  const list = await getHistory();
  const hrefs = new Set<string>();
  const numbersByTitle = new Map<string, Set<number>>();
  const knownTitles = new Set<string>();
  for (const e of list) {
    const tkAll = animeTitleKey(e.animeTitle);
    if (tkAll) knownTitles.add(tkAll);
    if (!isCompleted(e)) continue;
    hrefs.add(normHref(e.episodeHref));
    const n = deriveEpNum(e);
    const tk = animeTitleKey(e.animeTitle);
    if (n != null && tk) {
      let set = numbersByTitle.get(tk);
      if (!set) { set = new Set<number>(); numbersByTitle.set(tk, set); }
      set.add(n);
    }
  }
  return { hrefs, numbersByTitle, knownTitles };
}

/** True if an episode is watched by EITHER a same-source href match OR a
 *  cross-source (anime title + episode number) match. */
export function isEpisodeWatched(
  sets: CompletedSets,
  opts: { hrefs: (string | null | undefined)[]; epNum?: number | null; animeTitle?: string | null },
): boolean {
  if (opts.hrefs.some((h) => h && sets.hrefs.has(normHref(h)))) return true;
  if (opts.epNum != null && opts.animeTitle) {
    const set = sets.numbersByTitle.get(animeTitleKey(opts.animeTitle));
    if (set && set.has(opts.epNum)) return true;
  }
  return false;
}

/**
 * Toggle the watched flag on a specific episode. Adds a stub history entry
 * if there isn't one yet (so the marker survives across launches).
 */
export async function toggleWatched(
  episodeHref: string,
  meta: { episodeTitle: string; animeTitle: string; animeHref: string; image?: string; url4up?: string; epNum?: number | null; hrefs?: (string | null | undefined)[] },
): Promise<boolean> {
  const list = await getHistory();
  const hrefs = new Set([episodeHref, ...(meta.hrefs ?? [])].filter(Boolean).map(normHref));
  const titleKey = animeTitleKey(meta.animeTitle);
  const matches = list.filter((e) => hrefs.has(normHref(e.episodeHref)) ||
    (meta.epNum != null && !!titleKey && animeTitleKey(e.animeTitle) === titleKey && deriveEpNum(e) === meta.epNum));
  if (matches.length) {
    const completed = !matches.some(isCompleted);
    for (const entry of matches) {
      entry.completed = completed;
      entry.epNum ??= meta.epNum ?? undefined;
      entry.updatedAt = Date.now();
    }
    await saveHistory(list);
    void Promise.all(matches.map((entry) => pushToCloud(entry).catch(() => {})));
    return completed;
  }
  // No existing entry — create one marked as watched.
  const newEntry: WatchEntry = {
    episodeHref,
    episodeTitle: meta.episodeTitle,
    animeTitle: meta.animeTitle,
    animeHref: meta.animeHref,
    image: meta.image || "",
    positionMs: 0,
    durationMs: 0,
    url4up: meta.url4up,
    epNum: meta.epNum ?? undefined,
    completed: true,
    updatedAt: Date.now(),
  };
  list.unshift(newEntry);
  if (list.length > MAX_ITEMS) list.length = MAX_ITEMS;
  await saveHistory(list);
  pushToCloud(newEntry).catch(() => {});
  return true;
}

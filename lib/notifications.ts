// New-episode notifications (in-app center only).
//
// Every time the home feed loads we diff the "recently updated" episodes feed
// against either ALL anime or just the user's saved list (controlled by the
// notification-scope setting) and record a notification whenever a new episode
// drops. The bell on the home screen surfaces an unread badge and the
// /notifications screen lists them.
//
// We intentionally do NOT fire a local OS notification here anymore: a local
// notification (expo-notifications scheduleNotificationAsync) can't show the
// anime cover image on Android, and it only fires while the app is open. The
// real OS notification — closed-app, WITH the cover image — is delivered by the
// server (supabase/functions/episode-notifier → Expo Push richContent.image).
// Keeping both meant the user got a redundant image-less banner; this file is
// now purely the in-app center.
//
// Flood guard: the seen-episode set is seeded silently on the first sync and
// whenever the scope changes, so switching to "all" (or first launch) never
// dumps the entire current backlog on the user — only episodes that appear
// AFTER that point notify.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetchRecent } from "./api";
import { getFavorites, toAnimeUrl, type FavoriteAnime } from "./favorites";
import { getNotificationScope, type NotificationScope } from "./settings";
import { supabase, isSupabaseConfigured } from "./supabase";

const LIST_KEY = "@notifications_v1";
const SEEN_KEYS_KEY = "@notif_seen_keys_v2"; // { scope, keys: string[] } — dedup of notified episodes
const QUEUE_SEEN_KEY = "@queue_seen_v1"; // scope-independent keys already reported to the server
const MAX_STORED = 60;
const MAX_SEEN_KEYS = 1000; // cap the dedup set (recent feed ages old keys out anyway)

// Detection now runs on every app-foreground (see app/_layout.tsx), not just on
// the home tab mount, so a user flicking in/out of the app would otherwise fire
// redundant feed scrapes. Throttle to one report per device per window — the
// feed is shared/global and the cron is the backstop, so this is plenty.
const REPORT_THROTTLE_MS = 10 * 60 * 1000; // 10 min
let lastReportAt = 0;

export interface AppNotification {
  /** Stable id: `${animeHref}#${episodeNumber}` so the same episode never duplicates. */
  id: string;
  animeTitle: string;
  animeHref: string;
  episodeTitle: string;
  episodeHref: string;
  episodeNumber: number | null;
  image: string;
  createdAt: number;
  read: boolean;
}

/* ── Episode number parsing (Arabic + Western numerals) ── */

function extractEpisodeNumber(title: string): number | null {
  if (!title) return null;
  // Arabic-indic numerals after الحلقة
  const arMatch = title.match(/الحلقة[\s\-_]*([٠-٩]+)/);
  if (arMatch) {
    let num = "";
    for (const ch of arMatch[1]) num += String(ch.codePointAt(0)! - 0x0660);
    return parseInt(num, 10) || null;
  }
  const enMatch =
    title.match(/(?:الحلقة|حلقة)\s*(\d+)/) ||
    title.match(/(?:Episode|E(?:p(?:isode)?)?[.\s]*)\s*(\d+)/i);
  if (enMatch) return parseInt(enMatch[1], 10) || null;
  return null;
}

/* ── Title normalization for fuzzy favorite ↔ episode matching ── */

function norm(s: string): string {
  return (s || "")
    .toLowerCase()
    // keep latin letters/digits and Arabic block, drop everything else
    .replace(/[^a-z0-9؀-ۿ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ── Storage helpers ── */

async function readList(): Promise<AppNotification[]> {
  try {
    const raw = await AsyncStorage.getItem(LIST_KEY);
    return raw ? (JSON.parse(raw) as AppNotification[]) : [];
  } catch {
    return [];
  }
}

async function writeList(list: AppNotification[]) {
  try {
    await AsyncStorage.setItem(LIST_KEY, JSON.stringify(list.slice(0, MAX_STORED)));
  } catch {}
}

interface SeenState {
  scope: NotificationScope | null; // which scope the set was last seeded under
  keys: Set<string>;
}

async function readSeenKeys(): Promise<SeenState> {
  try {
    const raw = await AsyncStorage.getItem(SEEN_KEYS_KEY);
    if (!raw) return { scope: null, keys: new Set() };
    const parsed = JSON.parse(raw) as { scope: NotificationScope | null; keys: string[] };
    return { scope: parsed.scope ?? null, keys: new Set(parsed.keys || []) };
  } catch {
    return { scope: null, keys: new Set() };
  }
}

async function writeSeenKeys(scope: NotificationScope, keys: Set<string>) {
  try {
    // Keep only the most-recently-added keys (Set preserves insertion order).
    const arr = [...keys];
    const trimmed = arr.length > MAX_SEEN_KEYS ? arr.slice(arr.length - MAX_SEEN_KEYS) : arr;
    await AsyncStorage.setItem(SEEN_KEYS_KEY, JSON.stringify({ scope, keys: trimmed }));
  } catch {}
}

/* ── Public API ── */

export async function getNotifications(): Promise<AppNotification[]> {
  const list = await readList();
  return list.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getUnreadCount(): Promise<number> {
  const list = await readList();
  return list.filter((n) => !n.read).length;
}

export async function markAllRead() {
  const list = await readList();
  if (list.every((n) => n.read)) return;
  await writeList(list.map((n) => ({ ...n, read: true })));
}

export async function markRead(id: string) {
  const list = await readList();
  const next = list.map((n) => (n.id === id ? { ...n, read: true } : n));
  await writeList(next);
}

export async function clearNotifications() {
  await writeList([]);
}

type RawEpisode = { title: string; href: string; image: string; animeTitle: string; animeHref: string };

/** Resolve a stable per-anime key for an episode (anime URL, else normalized title). */
function animeKeyFor(ep: RawEpisode): string {
  const url = ep.animeHref?.includes("/anime/") ? ep.animeHref : toAnimeUrl(ep.animeHref || ep.href);
  return url || norm(ep.animeTitle) || ep.href;
}

/** Resolve the /anime/ URL for an episode (best effort). */
function animeUrlFor(ep: RawEpisode): string {
  return ep.animeHref?.includes("/anime/")
    ? ep.animeHref
    : (toAnimeUrl(ep.animeHref || ep.href) || ep.animeHref || "");
}

/** Pull the first couple of pages of the "recently updated" feed (newest first). */
async function fetchRecentFeed(): Promise<RawEpisode[]> {
  const episodes: RawEpisode[] = [];
  for (const page of [1, 2]) {
    try {
      const r = await fetchRecent(page);
      if (r.success) episodes.push(...r.data.episodes);
      if (!r.success || !r.data.hasNext) break;
    } catch {
      break;
    }
  }
  return episodes;
}

/**
 * Diff the latest "recently updated" episodes against either all anime or the
 * user's saved list (per the notification-scope setting) and append a
 * notification for each genuinely new episode.
 *
 * The seen-episode set is seeded silently on first run and on any scope change,
 * so the current backlog never floods the user — only episodes appearing after
 * that point notify.
 *
 * Returns the number of NEW notifications created (0 on any failure).
 */
export async function syncEpisodeNotifications(): Promise<number> {
  try {
    const scope = await getNotificationScope();

    // When scoped to the user's list, build favorite indexes up front; bail if
    // the list is empty (nothing to match against).
    let byTitle: Map<string, FavoriteAnime> | null = null;
    let byHref: Map<string, FavoriteAnime> | null = null;
    if (scope === "mylist") {
      const favorites = await getFavorites();
      if (favorites.length === 0) return 0;
      byTitle = new Map();
      byHref = new Map();
      for (const f of favorites) {
        const nt = norm(f.title);
        if (nt) byTitle.set(nt, f);
        byHref.set(f.href, f);
      }
    }

    // Pull a couple of pages of recent episodes (newest first).
    const episodes = await fetchRecentFeed();
    if (episodes.length === 0) return 0;

    // Build the candidate set for this scope, deduped by `${animeKey}#${epNum}`.
    const candidates = new Map<string, AppNotification>();
    for (const ep of episodes) {
      const epNum = extractEpisodeNumber(ep.title);
      if (epNum == null) continue;

      let animeTitle = ep.animeTitle;
      let animeHref = ep.animeHref?.includes("/anime/") ? ep.animeHref : (toAnimeUrl(ep.animeHref || ep.href) || ep.animeHref || "");
      let image = ep.image || "";

      if (scope === "mylist") {
        const epAnimeUrl = ep.animeHref?.includes("/anime/") ? ep.animeHref : toAnimeUrl(ep.animeHref || ep.href);
        const fav = (epAnimeUrl && byHref!.get(epAnimeUrl)) || byTitle!.get(norm(ep.animeTitle));
        if (!fav) continue; // not in the user's list → skip
        animeTitle = fav.title;
        animeHref = fav.href;
        image = ep.image || fav.image || "";
      }

      const key = `${animeKeyFor(ep)}#${epNum}`;
      if (candidates.has(key)) continue;
      candidates.set(key, {
        id: key,
        animeTitle,
        animeHref,
        episodeTitle: ep.title,
        episodeHref: ep.href,
        episodeNumber: epNum,
        image,
        createdAt: Date.now(),
        read: false,
      });
    }
    if (candidates.size === 0) return 0;

    const state = await readSeenKeys();

    // First run, or the scope changed since last sync → seed silently.
    if (state.scope !== scope) {
      const merged = new Set(state.keys);
      for (const k of candidates.keys()) merged.add(k);
      await writeSeenKeys(scope, merged);
      return 0;
    }

    const list = await readList();
    const existingIds = new Set(list.map((n) => n.id));
    const seenSet = state.keys;
    const created: AppNotification[] = [];

    for (const [key, notif] of candidates) {
      if (seenSet.has(key)) continue;
      seenSet.add(key);
      if (existingIds.has(key)) continue;
      existingIds.add(key);
      created.push(notif);
    }

    await writeSeenKeys(scope, seenSet);

    if (created.length > 0) {
      // Newest first in the stored list.
      created.sort((a, b) => (b.episodeNumber ?? 0) - (a.episodeNumber ?? 0));
      await writeList([...created, ...list]);
      // No local OS notification: the closed-app, with-image OS notification is
      // delivered by the server (episode-notifier Edge Function). The in-app
      // list above keeps every item regardless.
    }
    return created.length;
  } catch {
    return 0;
  }
}

/* ── Server report: newly-available episodes → closed-app push ──────────── */

async function readQueueSeen(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_SEEN_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as { keys: string[] };
    return new Set(parsed.keys || []);
  } catch {
    return new Set();
  }
}

async function writeQueueSeen(keys: Set<string>) {
  try {
    const arr = [...keys];
    const trimmed = arr.length > MAX_SEEN_KEYS ? arr.slice(arr.length - MAX_SEEN_KEYS) : arr;
    await AsyncStorage.setItem(QUEUE_SEEN_KEY, JSON.stringify({ keys: trimmed }));
  } catch {}
}

interface QueueRow {
  episode_key: string;
  anime_key: string;
  anime_title: string;
  anime_href: string;
  episode_title: string;
  episode_href: string;
  episode_number: number;
  image: string;
}

/**
 * Report newly-available episodes (witanime's "recently updated" feed) to the
 * server so the episode-notifier Edge Function can fan them out as closed-app
 * push notifications WITH the episode image — but only for episodes that are
 * ACTUALLY available in the app. The server can't scrape witanime (Cloudflare),
 * so the app is the only thing that knows real availability; an external airing
 * schedule would fire before the Arabic sub is published.
 *
 * Scope-independent: it always reports ALL anime; the server decides per user
 * whether to push everything ("all") or only saved anime ("mylist"). The feed
 * is shared, so any one signed-in user opening the app keeps it fresh for
 * everyone. Seeded silently on first run so the current backlog isn't announced.
 *
 * Returns the number of NEW episodes uploaded (0 on any failure / no-op).
 */
export async function reportRecentEpisodes(opts?: { force?: boolean }): Promise<number> {
  try {
    if (!isSupabaseConfigured) return 0;
    if (!opts?.force && Date.now() - lastReportAt < REPORT_THROTTLE_MS) return 0;
    // Mark immediately (optimistic) so two near-simultaneous triggers — e.g. the
    // home mount and a cold-start app-foreground event — don't both scrape.
    lastReportAt = Date.now();
    // Only signed-in users can write the shared feed (RLS); skip otherwise.
    const { data: auth } = await supabase.auth.getSession();
    // Signed out → don't burn the throttle; let the next attempt try again.
    if (!auth?.session?.user?.id) { lastReportAt = 0; return 0; }

    const episodes = await fetchRecentFeed();
    if (episodes.length === 0) return 0;

    // All candidates (no scope filter), deduped by `${animeKey}#${epNum}`.
    const candidates = new Map<string, QueueRow>();
    for (const ep of episodes) {
      const epNum = extractEpisodeNumber(ep.title);
      if (epNum == null) continue;
      const animeKey = animeKeyFor(ep);
      const key = `${animeKey}#${epNum}`;
      if (candidates.has(key)) continue;
      candidates.set(key, {
        episode_key: key,
        anime_key: animeKey,
        anime_title: ep.animeTitle || "",
        anime_href: animeUrlFor(ep),
        episode_title: ep.title || "",
        episode_href: ep.href || "",
        episode_number: epNum,
        image: ep.image || "",
      });
    }
    if (candidates.size === 0) return 0;

    const seen = await readQueueSeen();
    const firstRun = seen.size === 0;

    // Collect genuinely-new episodes (not yet seen on THIS device). On the very
    // first run we still record the whole backlog into `seen` so we never flood
    // — but, unlike before, we no longer bail out early: the newest episode is
    // always uploaded below so the shared queue actually gets populated.
    const fresh: QueueRow[] = [];
    for (const [key, row] of candidates) {
      if (seen.has(key)) continue;
      seen.add(key);
      if (!firstRun) fresh.push(row);
    }

    // Eager population: always include the single newest episode, even on a
    // freshly-seeded device or when it's already been seen here. The queue PK
    // (episode_key) and the server's per-user `notified_episodes` table BOTH
    // dedup, so this is idempotent and never double-notifies — it just keeps the
    // shared feed warm so closed-app push can actually fire. (`candidates` is
    // built newest-first, so the first entry is the latest episode.)
    const newest = candidates.values().next().value as QueueRow | undefined;
    if (newest && !fresh.some((r) => r.episode_key === newest.episode_key)) {
      fresh.unshift(newest);
    }

    if (fresh.length === 0) return 0;

    // Idempotent upload (ON CONFLICT DO NOTHING keeps the first-seen row/time).
    const { error } = await supabase
      .from("episode_queue")
      .upsert(fresh, { onConflict: "episode_key", ignoreDuplicates: true });
    // On failure, don't persist the seen-set so we retry these next time.
    if (error) return 0;

    await writeQueueSeen(seen);

    // Nudge the notifier for near-instant delivery (the cron is the backstop).
    // Must go through supabase.functions.invoke — a bare fetch omits the `apikey`
    // header the Supabase gateway requires, so it 401s and the push only fires on
    // the next cron tick (delayed). invoke attaches the anon key + session JWT.
    try {
      await supabase.functions.invoke("episode-notifier", { body: {} });
    } catch {}
    return fresh.length;
  } catch {
    return 0;
  }
}

// New-episode notifications (in-app center + native push fan-out).
//
// Every time the home feed loads we diff the "recently updated" episodes feed
// against either ALL anime or just the user's saved list (controlled by the
// notification-scope setting) and record a notification whenever a new episode
// drops. The bell on the home screen surfaces an unread badge, the
// /notifications screen lists them, and lib/push fires a real OS notification.
//
// Flood guard: the seen-episode set is seeded silently on the first sync and
// whenever the scope changes, so switching to "all" (or first launch) never
// dumps the entire current backlog on the user — only episodes that appear
// AFTER that point notify.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetchRecent } from "./api";
import { getFavorites, toAnimeUrl, type FavoriteAnime } from "./favorites";
import { presentNewEpisodeNotification } from "./push";
import { getNotificationScope, type NotificationScope } from "./settings";
import { t } from "./i18n";

const LIST_KEY = "@notifications_v1";
const SEEN_KEYS_KEY = "@notif_seen_keys_v2"; // { scope, keys: string[] } — dedup of notified episodes
const MAX_STORED = 60;
const MAX_SEEN_KEYS = 1000; // cap the dedup set (recent feed ages old keys out anyway)
const MAX_PUSH_PER_SYNC = 10; // OS-notification storm guard (in-app list still keeps all)

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
      // Fire OS notifications (capped to avoid a storm in "all" scope); the
      // in-app list above keeps every item regardless. No-op on older builds
      // without the native module, or when disabled/denied.
      for (const n of created.slice(0, MAX_PUSH_PER_SYNC)) {
        void presentNewEpisodeNotification({
          title: t.notifNewEpisodeTitle,
          body:
            n.episodeNumber != null
              ? t.notifNewEpisode(n.animeTitle, n.episodeNumber)
              : t.notifNewEpisodeNoNum(n.animeTitle),
          episodeHref: n.episodeHref,
          animeHref: n.animeHref,
          image: n.image,
        });
      }
    }
    return created.length;
  } catch {
    return 0;
  }
}

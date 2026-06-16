// In-app new-episode notifications.
//
// The app is backend-free and ships updates over-the-air (JS only), so we can't
// use a native push module (expo-notifications) — that would require a fresh
// APK build. Instead this is an in-app notification center: every time the home
// feed loads we diff the "recently updated" episodes against the user's saved
// anime (favorites) and record a notification whenever a followed show drops a
// new episode. The bell on the home screen surfaces an unread badge, and the
// /notifications screen lists them. 100% JS → OTA-safe.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetchRecent } from "./api";
import { getFavorites, toAnimeUrl } from "./favorites";
import { presentNewEpisodeNotification } from "./push";
import { t } from "./i18n";

const LIST_KEY = "@notifications_v1";
const SEEN_KEY = "@notif_seen_v1"; // { [animeHref]: highestEpisodeNumberSeen }
const MAX_STORED = 60;

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

async function readSeen(): Promise<Record<string, number>> {
  try {
    const raw = await AsyncStorage.getItem(SEEN_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

async function writeSeen(seen: Record<string, number>) {
  try {
    await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(seen));
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

/**
 * Diff the latest "recently updated" episodes against the user's saved anime
 * and append a notification for every followed show that has a newer episode
 * than we last recorded.
 *
 * First contact with a given anime only seeds a baseline (silently) so we never
 * flood the user with a backlog the moment they add a favorite — only episodes
 * that land *after* they're following the show produce notifications.
 *
 * Returns the number of NEW notifications created (0 on any failure).
 */
export async function syncEpisodeNotifications(): Promise<number> {
  try {
    const favorites = await getFavorites();
    if (favorites.length === 0) return 0;

    // Index favorites by both normalized title and anime URL for robust matching
    // (sources spell hrefs differently, so title is the reliable bridge).
    const byTitle = new Map<string, (typeof favorites)[number]>();
    const byHref = new Map<string, (typeof favorites)[number]>();
    for (const f of favorites) {
      const nt = norm(f.title);
      if (nt) byTitle.set(nt, f);
      byHref.set(f.href, f);
    }

    // Pull a couple of pages of recent episodes (newest first).
    const episodes: Array<{ title: string; href: string; image: string; animeTitle: string; animeHref: string }> = [];
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

    const seen = await readSeen();
    const list = await readList();
    const existingIds = new Set(list.map((n) => n.id));
    const created: AppNotification[] = [];

    // Track the best (highest) episode number we see per favorite this run, so
    // a favorite that has many recent episodes only advances the baseline once.
    const runMax = new Map<string, number>();

    for (const ep of episodes) {
      // Resolve which favorite (if any) this episode belongs to.
      const epAnimeUrl = ep.animeHref?.includes("/anime/")
        ? ep.animeHref
        : toAnimeUrl(ep.animeHref || ep.href);
      let fav = (epAnimeUrl && byHref.get(epAnimeUrl)) || byTitle.get(norm(ep.animeTitle));
      if (!fav) continue;

      const epNum = extractEpisodeNumber(ep.title);
      if (epNum == null) continue;

      const baseline = seen[fav.href];

      if (baseline === undefined) {
        // First time we encounter this favorite in the recent feed — seed
        // silently with the highest number observed this run.
        runMax.set(fav.href, Math.max(runMax.get(fav.href) ?? 0, epNum));
        continue;
      }

      if (epNum > baseline) {
        const id = `${fav.href}#${epNum}`;
        if (!existingIds.has(id)) {
          existingIds.add(id);
          created.push({
            id,
            animeTitle: fav.title,
            animeHref: fav.href,
            episodeTitle: ep.title,
            episodeHref: ep.href,
            episodeNumber: epNum,
            image: ep.image || fav.image || "",
            createdAt: Date.now(),
            read: false,
          });
        }
        runMax.set(fav.href, Math.max(runMax.get(fav.href) ?? baseline, epNum));
      }
    }

    // Advance baselines (seed first-seen favorites, bump notified ones).
    let seenChanged = false;
    for (const [href, max] of runMax) {
      if (seen[href] === undefined || max > seen[href]) {
        seen[href] = max;
        seenChanged = true;
      }
    }
    if (seenChanged) await writeSeen(seen);

    if (created.length > 0) {
      await writeList([...created, ...list]);
      // Fire a real OS notification for each new episode (no-op on older
      // builds without the native module, or when disabled/denied).
      for (const n of created) {
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

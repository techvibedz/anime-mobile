// Pure grouping for the "Continue Watching" row. Lives in its own module so it
// can be unit-tested without pulling react-native/supabase in (history.ts does).

export type ContinueEntry = {
  animeHref?: string;
  animeTitle?: string;
  dismissed?: boolean;
  updatedAt?: number;
};

/**
 * One entry per anime, newest first (the input list is already sorted).
 *
 * A dismissed card must hide the WHOLE anime, not just its newest episode — the
 * previous episode of the same series would otherwise immediately take its
 * place and the X button would look broken. Conversely, a re-watched episode
 * must bring the card straight back even when its timestamp ties with the
 * dismissal (dismissals stamp every entry with the same Date.now(), and a
 * re-watch can land in that same millisecond), so a VISIBLE entry always wins
 * over a dismissed one; the anime is hidden only when every entry is dismissed.
 */
export function groupContinueWatching<T extends ContinueEntry>(list: readonly T[]): T[] {
  const bestPerAnime = new Map<string, T>();
  for (const entry of list) {
    const key = entry.animeHref || entry.animeTitle || "";
    if (entry.dismissed) {
      if (!bestPerAnime.has(key)) bestPerAnime.set(key, entry);
      continue;
    }
    const current = bestPerAnime.get(key);
    if (!current || current.dismissed || (entry.updatedAt ?? 0) > (current.updatedAt ?? 0)) {
      bestPerAnime.set(key, entry);
    }
  }
  const out: T[] = [];
  for (const entry of bestPerAnime.values()) {
    if (entry.dismissed) continue;
    out.push(entry);
  }
  return out;
}

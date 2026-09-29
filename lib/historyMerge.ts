// Merge helper for cloud hydration. Kept dependency-free so it can be unit
// tested without react-native/supabase (history.ts imports both).

export type MergeEntry = {
  episodeHref: string;
  updatedAt: number;
  epNum?: number;
};

/**
 * Merge the cloud copy of watch history into the local one. Local entries the
 * cloud doesn't know about are KEPT (a failed push must not lose progress);
 * for a shared episode the newer `updatedAt` wins; local-only fields the cloud
 * doesn't store (epNum) survive when the remote row lacks them.
 */
export function mergeHistory<T extends MergeEntry>(local: readonly T[], remote: readonly T[], max = 200): T[] {
  const byHref = new Map<string, T>();
  for (const entry of local) byHref.set(entry.episodeHref, entry);
  for (const row of remote) {
    const existing = byHref.get(row.episodeHref);
    if (!existing) {
      byHref.set(row.episodeHref, row);
    } else if (row.updatedAt > existing.updatedAt) {
      byHref.set(row.episodeHref, { ...existing, ...row, epNum: row.epNum ?? existing.epNum });
    }
  }
  return [...byHref.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, max);
}

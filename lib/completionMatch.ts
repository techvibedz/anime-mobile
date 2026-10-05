// Dependency-free record matching for the completion store. Kept out of
// completion.tsx (which imports React/AsyncStorage/supabase) so it can be unit
// tested, same as historyMerge.ts.

export interface CompletionLike {
  hrefs: string[];
  titles: string[];
}

/**
 * Every record matching ANY of the given normalized href/title keys.
 *
 * Completion records are keyed per source URL, so one anime can legitimately
 * end up with several records (witanime vs anime4up vs a title fallback). All
 * writers must update EVERY match, not just the first: a card resolving to a
 * stale copy otherwise shows no badge even though the finale was watched.
 *
 * Keys must already be normalized by the caller (normAnimeKey / animeTitleKey).
 */
export function matchingRecords<T extends CompletionLike>(
  records: readonly T[],
  hrefKeys: ReadonlySet<string>,
  titleKeys: ReadonlySet<string>,
): T[] {
  const out: T[] = [];
  for (const rec of records) {
    const hrefHit = hrefKeys.size > 0 && rec.hrefs.some((h) => hrefKeys.has(h));
    const titleHit = titleKeys.size > 0 && rec.titles.some((t) => titleKeys.has(t));
    if (hrefHit || titleHit) out.push(rec);
  }
  return out;
}

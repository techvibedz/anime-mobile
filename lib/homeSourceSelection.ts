import { normFuzzy } from "./fuzzy";

export async function loadWitanimeHome<T>(
  direct: () => Promise<T | null>,
  webView: () => Promise<T | null>,
): Promise<T | null> {
  return await direct().catch(() => null) || await webView().catch(() => null);
}

type RecentEpisodeLike = { href?: string | null; animeHref?: string | null; animeTitle?: string | null };

// One episode card per anime (the primary source's newest), in source order.
// Anime4up's recent archive is often dominated by a batch upload (a whole
// season dumped at once), so its own per-anime de-dupe can collapse page 1 to
// a couple of cards. Merging the witanime home feed backfills the rail.
// The same anime carries a different animeHref per source, so de-dupe on the
// normalized title too ("Liar Game" from anime4up vs "LIAR GAME" from witanime).
export function mergeRecentEpisodes<T extends RecentEpisodeLike>(
  primary: readonly T[],
  fallback: readonly T[],
): T[] {
  const seenHref = new Set<string>();
  const seenTitle = new Set<string>();
  const out: T[] = [];
  for (const ep of [...primary, ...fallback]) {
    const hrefKey = (ep.animeHref || ep.href || "").toLowerCase().replace(/\/+$/, "").trim();
    const titleKey = normFuzzy(ep.animeTitle || "");
    if ((hrefKey && seenHref.has(hrefKey)) || (titleKey && seenTitle.has(titleKey))) continue;
    if (hrefKey) seenHref.add(hrefKey);
    if (titleKey) seenTitle.add(titleKey);
    out.push(ep);
  }
  return out;
}

type EpisodeLike = {
  href?: string | null;
  title?: string | null;
  animeHref?: string | null;
  animeTitle?: string | null;
};

// Keys identifying the parent anime: the per-source href AND the normalized
// title. One anime arrives from witanime and anime4up with different hrefs, so
// href alone lets cross-source duplicates through — and the same source can
// spell the title differently ("World Is Dancing" vs "World is dancing").
export function episodeAnimeKeys(ep: EpisodeLike): string[] {
  const keys: string[] = [];
  const href = String(ep.animeHref || "").toLowerCase().replace(/\/+$/, "").trim();
  if (href) keys.push("h:" + href);
  const title = normFuzzy(ep.animeTitle || "");
  if (title) keys.push("t:" + title);
  if (!keys.length) keys.push("x:" + String(ep.href || ep.title || ""));
  return keys;
}

/** Keep only the newest episode for each anime across every loaded page. */
export function dedupeRecentEpisodes<T extends EpisodeLike>(
  eps: readonly T[],
  seen: Set<string>,
): T[] {
  const out: T[] = [];
  for (const ep of eps) {
    const keys = episodeAnimeKeys(ep);
    if (keys.some((key) => seen.has(key))) continue;
    for (const key of keys) seen.add(key);
    out.push(ep);
  }
  return out;
}

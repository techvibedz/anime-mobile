/** Pure favorite-URL helpers kept separate from AsyncStorage/Supabase so the
 * identity rules can be regression-tested in Node. Source domains rotate, but
 * a favorite must keep matching the same anime path. */

export function toAnimeUrl(href: string): string | null {
  if (!href) return null;
  if (isAnimeDetailUrl(href)) return href;
  if (!href.includes("/episode/")) return href;
  try {
    const decoded = decodeURIComponent(href);
    const stripped = decoded.replace(/-?الحلقة[-\s]*\d+[^/]*/, "");
    const converted = stripped.replace("/episode/", "/anime/");
    if (converted !== decoded && converted.includes("/anime/")) {
      const url = new URL(converted);
      return url.origin + url.pathname.split("/").map((segment, index) =>
        index === 0 ? segment : encodeURIComponent(decodeURIComponent(segment)),
      ).join("/");
    }
  } catch {}
  return null;
}

/** Anime3rb uses /titles/... while Witanime/Anime4up use /anime/.... */
export function isAnimeDetailUrl(href: string): boolean {
  if (!href || /\/episode\//i.test(href)) return false;
  try {
    const url = new URL(href);
    return /\/anime\//i.test(url.pathname) ||
      (/anime3rb\.com$/i.test(url.hostname) && /\/titles\//i.test(url.pathname));
  } catch {
    return /\/anime\//i.test(href) || /\/titles\//i.test(href);
  }
}

/** Stable favorite identity across encoding, trailing slashes, query strings,
 * www aliases, and rotating source TLD/subdomains. */
export function favoriteKey(href: string | null | undefined): string {
  if (!href) return "";
  const animeHref = isAnimeDetailUrl(href) ? href : toAnimeUrl(href);
  if (!animeHref) return "";
  try {
    const url = new URL(animeHref);
    const labels = url.hostname.toLowerCase().replace(/^www\./, "").split(".");
    const source = labels.length >= 2 ? labels[labels.length - 2] : labels[0];
    let path = url.pathname;
    try { path = decodeURIComponent(path); } catch {}
    return `${source}${path}`.replace(/\/+$/, "").toLowerCase();
  } catch {
    try { return decodeURIComponent(animeHref).split(/[?#]/)[0].replace(/\/+$/, "").toLowerCase(); }
    catch { return animeHref.split(/[?#]/)[0].replace(/\/+$/, "").toLowerCase(); }
  }
}

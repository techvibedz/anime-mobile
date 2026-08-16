export function shouldShowSynopsis(_animeHref: string, synopsis: string | null | undefined): boolean {
  return !!synopsis;
}

const APPENDED_DETAIL_MARKER =
  /(?:أسماء\s+أخرى|أنميات?\s+مشابهة|أعمال\s+مشابهة|المواسم\s+المرتبطة|العروض\s+التشويقية|المصادر\s*:|التقييم\s*[:：]?\s*\d|\d+\s*حلقات(?:\s|$))/i;

/**
 * Older Anime4up/Anime3rb cache entries can contain the real story followed by
 * a second copy or by text scraped from the source page's details/related
 * section. Keep the first story and discard only that appended lower tail.
 */
export function synopsisForDisplay(synopsis: string | null | undefined): string {
  const value = (synopsis || "").replace(/\r\n?/g, "\n").trim();
  if (!value) return "";

  const marker = APPENDED_DETAIL_MARKER.exec(value);
  let clean = marker && marker.index >= 25 ? value.slice(0, marker.index).trim() : value;

  // Exact duplicate appended without a heading ("story … story …"). A short
  // lead is long enough to avoid matching ordinary repeated words.
  const flat = clean.replace(/\s+/g, " ").trim();
  const lead = flat.slice(0, 48);
  if (lead.length === 48) {
    const repeatedAt = flat.indexOf(lead, lead.length);
    if (repeatedAt >= 25) clean = flat.slice(0, repeatedAt).trim();
  }

  return clean;
}

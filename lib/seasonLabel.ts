// Season position + description for a detail page whose source gives neither.
// Witanime/anime4up leave sequels without a synopsis (or a bare "الموسم الثاني
// من X" tag that cleanSynopsis drops), and many sequel names carry no number
// ("Tokyo Revengers: Tenjiku-hen"), so users couldn't tell which season a page
// was. Pure logic here; lib/animeInfo resolves the AniList entry it runs on.

export interface SeasonNode {
  format: string | null;
  episodes: number | null;
  title: { romaji?: string | null; english?: string | null };
}

const MAIN_FORMATS = new Set(["TV", "TV_SHORT", "ONA"]);
const ORDINAL_WORDS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6 };

/** Season written in words: "Season 2", "2nd Season", "Second Season",
 * "الموسم 2". Deliberately ignores Part/Cour (a split cour is not a season). */
export function explicitSeason(title: string | null | undefined): number | null {
  const s = (title || "").toLowerCase();
  const m = s.match(/\bseason\s*(\d{1,2})\b/) || s.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+season\b/) || s.match(/الموسم\s*([٠-٩\d]{1,2})/);
  if (m) {
    const v = parseInt(m[1].replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)), 10);
    return v > 0 ? v : null;
  }
  const w = s.match(/\b(first|second|third|fourth|fifth|sixth)\s+season\b/);
  return w ? ORDINAL_WORDS[w[1]] : null;
}

/** Roman season numeral in a title ("Mushoku Tensei Ⅲ", "Youjo Senki II").
 * Only trusted when the AniList chain agrees it's a sequel — "Final Fantasy
 * VII" must never read as season 7. */
export function romanSeason(title: string | null | undefined): number | null {
  const s = (title || "").replace(/[Ⅰ-Ⅻ]/g, (ch) => ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"][ch.charCodeAt(0) - 0x2160]);
  const m = s.match(/(?:^|[\s:])(II|III|IV|VI|VII|VIII|IX)(?=$|[\s:])/);
  return m ? ({ II: 2, III: 3, IV: 4, VI: 6, VII: 7, VIII: 8, IX: 9 } as Record<string, number>)[m[1]] : null;
}

/** Split-cour marker: "Part 2", "Cour 2", "2nd Part", "Part II". */
export function explicitPart(title: string | null | undefined): number | null {
  const s = (title || "").toLowerCase();
  const m = s.match(/\b(?:part|cour)\s*(\d{1,2}|ii|iii)\b/) || s.match(/\b(\d)(?:st|nd|rd|th)\s+(?:part|cour)\b/);
  if (!m) return null;
  const v = m[1] === "ii" ? 2 : m[1] === "iii" ? 3 : parseInt(m[1], 10);
  return v > 0 ? v : null;
}

function names(n: SeasonNode): string {
  return `${n.title.romaji || ""} ${n.title.english || ""}`;
}

/** Does this entry open a new season? Main TV formats only; a "Part 2" entry
 * continues its season and a short TV special (<8 eps, e.g. Kimetsu's 7-ep
 * Mugen Ressha-hen recut) is not one. */
export function startsSeason(n: SeasonNode): boolean {
  if (!n.format || !MAIN_FORMATS.has(n.format)) return false;
  const part = explicitPart(names(n));
  if (part != null && part >= 2) return false;
  return !(n.episodes != null && n.episodes > 0 && n.episodes < 8);
}

export function isMainFormat(format: string | null | undefined): boolean {
  return !!format && MAIN_FORMATS.has(format);
}

/** Season number from the entry plus its PREQUEL chain (nearest first). */
export function seasonFromChain(entry: SeasonNode, prequels: SeasonNode[]): number {
  let n = startsSeason(entry) ? 1 : 0;
  for (const p of prequels) if (startsSeason(p)) n++;
  return Math.max(1, n);
}

/** Final season/part for a page. Source title words win, then AniList's
 * official naming, then the counted chain (a source Roman numeral is used only
 * when the chain confirms a sequel). Null season = not a TV series. */
export function resolveSeason(
  sourceTitle: string,
  entry: SeasonNode | null,
  prequels: SeasonNode[],
): { season: number | null; part: number | null } {
  const part = explicitPart(sourceTitle) ?? (entry ? explicitPart(entry.title.english) ?? explicitPart(entry.title.romaji) : null);
  const words = explicitSeason(sourceTitle);
  if (words) return { season: words, part };
  if (!entry || !isMainFormat(entry.format)) return { season: null, part };
  const official = explicitSeason(entry.title.english) ?? explicitSeason(entry.title.romaji);
  if (official) return { season: official, part };
  const chain = seasonFromChain(entry, prequels);
  const roman = romanSeason(sourceTitle) ?? romanSeason(entry.title.romaji);
  return { season: roman && chain >= 2 ? roman : chain, part };
}

const AR_ORDINALS = ["", "الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع", "العاشر"];

/** "الموسم الثالث" / "الموسم الثاني · الجزء الثاني"; null when not worth a
 * label (season 1 with no part, or unknown). */
export function seasonLabelAr(season: number | null, part: number | null): string | null {
  const ord = (n: number) => AR_ORDINALS[n] ?? String(n);
  const partLabel = part && part >= 2 ? `الجزء ${ord(part)}` : null;
  if (season && season >= 2) return partLabel ? `الموسم ${ord(season)} · ${partLabel}` : `الموسم ${ord(season)}`;
  if (partLabel) return season === 1 ? `الموسم ${ord(1)} · ${partLabel}` : partLabel;
  return null;
}

/** AniList descriptions carry HTML, source credits and notes — keep the story.
 * New sequels often only have a stub ("The second season of X.") that would
 * just repeat the season pill, so a stub returns "" and the block stays hidden. */
export function cleanAniListDescription(raw: string | null | undefined): string {
  const text = (raw || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, "\"").replace(/&#039;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/&mdash;/g, "—").replace(/&nbsp;/g, " ")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !/^\(?\s*(source|written by|note)\s*:/i.test(line) && !/^\[.*(written|source).*\]$/i.test(line))
    .join(" ")
    .replace(/\s*\((?:source|written by)\s*:[^)]*\)\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const stub = text.length < 140 && /\b(?:season|part|cour|sequel|continuation)\b/i.test(text) && (text.match(/[.!?](?:\s|$)/g) || []).length <= 1;
  return stub ? "" : text;
}

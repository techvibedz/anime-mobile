import { fuzzyScore, normFuzzy, sourceSearchQueries } from "./fuzzy";

type Card = { title: string; href: string };

// Latin/Arabic letter runs, used to split a mixed-script title apart. Source
// titles are frequently "vernacular + original" ("ون بيس One Piece",
// "قاتل الشياطين Kimetsu no Yaiba") while the site indexes only ONE of the two
// spellings. Scoring the whole mixed string against the indexed title caps the
// similarity far below the accept threshold ("ون بيس One Piece" vs "One Piece"
// scores 0.615), so those episodes never discovered the Witanime copy. Scoring
// each language half on its own lets the half the site uses match at 1.0.
const ARABIC_RUN = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]+/g;
const LATIN_RUN = /[A-Za-z]+/g;

/** Every spelling worth scoring for a title: the title itself, its parenthesised
 * alternative names, and the Arabic-only / Latin-only halves of mixed titles. */
export function witTitleVariants(names: readonly string[]): string[] {
  const out: string[] = [];
  const add = (value: string) => {
    const trimmed = String(value || "").replace(/\s+/g, " ").trim();
    if (trimmed && !out.some((item) => item.toLowerCase() === trimmed.toLowerCase())) out.push(trimmed);
  };
  for (const name of names) {
    if (!name) continue;
    add(name);
    for (const match of String(name).matchAll(/[([]([^)\]]+)[)\]]/g)) add(match[1]);
    const arabic = (name.match(ARABIC_RUN) || []).join(" ").trim();
    const latin = (name.match(LATIN_RUN) || []).join(" ").trim();
    if (arabic && latin) {
      add(arabic);
      add(latin);
    }
  }
  return out;
}

/** Season numbers any of the known spellings asks for. Scoring a card requires
 * its season to be one of these, so a season-2 page can never answer a season-1
 * lookup (episode numbering restarts) while an alias spelling the season
 * differently still resolves. */
function witWantedSeasons(names: readonly string[], season: (title: string) => number): Set<number> {
  const wanted = new Set<number>();
  for (const name of names) if (name) wanted.add(season(name));
  if (wanted.size === 0) wanted.add(1);
  return wanted;
}

// Fold the season spellings and dub/type decorations the sites sprinkle over
// titles so "Mushoku Tensei II", "Mushoku Tensei 2nd Season" and "Mushoku
// Tensei الموسم 2" all collapse to the same base string.
export function witCleanTitle(name: string): string {
  return normFuzzy(name
    // NFKD first: Unicode romans ("Ⅱ") decompose to ASCII ("II") so the strip
    // below sees them. normFuzzy normalizes too late for that.
    .normalize("NFKD")
    .replace(/\b\d+(?:st|nd|rd|th)\s+(?:season|part|cour)\b/gi, " ")
    .replace(/\b(?:season|part|cour)\s*\d+\b/gi, " ")
    .replace(/\b(?:VIII|VII|VI|IV|IX|III|II)\b/gi, " ")
    .replace(/(?:الموسم|الجزء)\s*[٠-٩\d]+/g, " ")
    // `\b` never matches around Arabic letters (they aren't \w), so the
    // dub/type qualifiers need explicit space/edge boundaries.
    .replace(/(^|\s)(?:مترجم|مدبلج|انمي|أنمي)(?=\s|$)/g, " "));
}

/** Every spelling of a title worth searching and scoring, derived from the
 * title plus any extra sources (the source page slug, aliases): the strings
 * themselves, parenthesised alternative names, the bare title with "(...)"
 * decorations removed, and the same with a year dropped. Decorations are the
 * most common reason a search returns the right card while the score caps
 * below the accept threshold ("Bleach (2022)" vs "Bleach" scores 0.600). */
export function witSearchNames(...sources: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  const add = (value: string | null | undefined) => {
    const trimmed = String(value || "").replace(/\s+/g, " ").trim();
    if (trimmed && !out.some((item) => item.toLowerCase() === trimmed.toLowerCase())) out.push(trimmed);
  };
  for (const source of sources) {
    if (!source) continue;
    add(source);
    for (const match of String(source).matchAll(/[([]([^)\]]+)[)\]]/g)) add(match[1]);
    const plain = String(source).replace(/[([]([^)\]]*)[)\]]/g, " ").replace(/\s+/g, " ").trim();
    add(plain);
    add(plain.replace(/\b(?:19|20)\d{2}\b/g, " ").replace(/\s+/g, " ").trim());
  }
  return out;
}

/** Best symmetric score for any cleaned spelling in `names` against a card or
 * page title, 0..1. Cleans BOTH sides exactly like matchWitanimeTitle, so the
 * identity check on a search-resolved page accepts whatever the matcher
 * accepted (season formats, decorations, aliases) while still rejecting a
 * different anime: the symmetric min keeps "Naruto" from matching "Boruto
 * Naruto Next Generations", and the variant list is what lets a mixed-script
 * or decorated title match. */
export function witTitleScore(names: readonly string[], cardTitle: string): number {
  const variants = witTitleVariants(names.map((name) => witCleanTitle(name)));
  if (variants.length === 0) return 0;
  const b = witCleanTitle(cardTitle);
  return Math.max(...variants.map((name) => Math.min(fuzzyScore(name, b), fuzzyScore(b, name))));
}

/** Keep only cards that share the anime's base title. The site's "ذات صلة"
 * rail pads itself with genre-similar suggestions when an anime has no real
 * relations (a brand-new show's rail is other popular shounen), and those must
 * not surface as related. Match is whole-word prefix containment in EITHER
 * direction — a franchise sequel/cour card extends the base ("Bleach" →
 * "BLEACH: Sennen Kessen-hen…", "Mushoku Tensei" → "Mushoku Tensei Ⅱ: …")
 * while an unrelated title never does. When everything is filtered out the
 * caller falls back to the AniList relation graph, which is empty when the
 * anime genuinely has no relations. */
export function witRelatedCards<T extends { title: string }>(
  baseNames: readonly string[],
  cards: readonly T[],
): T[] {
  const bases = [...new Set(baseNames.map((name) => witCleanTitle(name)).filter((base) => base.length >= 4))];
  if (!bases.length) return [];
  const isPrefix = (long: string, short: string) => long === short || long.startsWith(short + " ");
  return cards.filter((card) => {
    const t = witCleanTitle(card.title);
    if (t.length < 4) return false;
    return bases.some((base) => isPrefix(t, base) || isPrefix(base, t));
  });
}

/** AniList-style relation mark for a Witanime related-rail card. The site
 * labels no relation types on its "ذات صلة" cards, so the mark is derived from
 * the source's own data: the format badge (or a /movie/ href) decides movies /
 * specials / OVAs first, explicit season markers in the two titles decide
 * next/previous season, and a card whose cleaned title extends the anime's base
 * title reads as a continuation (reversed: a prequel). Empty string when no
 * known base matches; callers render nothing for it. */
export function witRelationMark(
  baseNames: readonly string[],
  card: { title: string; type?: string | null; href?: string | null },
  season: (title: string) => number,
): string {
  const cleaned = witCleanTitle(card.title);
  const current = baseNames
    .map((name) => ({ raw: name, base: witCleanTitle(name) }))
    .filter((b) => b.base.length >= 4)
    .filter((b) => b.base === cleaned || cleaned.startsWith(b.base + " ") || b.base.startsWith(cleaned + " "))
    // An exact spelling is the same work — prefer it over a longer page title
    // that merely extends the card's title.
    .sort((a, b) => Number(b.base === cleaned) - Number(a.base === cleaned) || b.base.length - a.base.length)[0];
  if (!current) return "";
  // Format first: a movie title can carry a Roman numeral ("Heaven's Feel II")
  // that the season parser would otherwise read as a later season.
  const type = String(card.type || "").trim();
  if (type === "فيلم" || /\/movie\//i.test(card.href || "")) return "فيلم";
  if (/^special$/i.test(type)) return "حلقة خاصة";
  if (/^(?:ova|ona)$/i.test(type)) return type.toUpperCase();
  const cardSeason = season(card.title);
  const currentSeason = season(current.raw);
  if (cardSeason > currentSeason) return "الموسم القادم";
  if (cardSeason < currentSeason) return "الموسم السابق";
  if (cleaned.startsWith(current.base + " ")) return "تكملة";
  if (current.base.startsWith(cleaned + " ")) return "ما قبلها";
  return "ذات صلة";
}

// Score complete names, never the shortened query sent to the site's search.
export function matchWitanimeTitle(
  names: string[], cards: Card[], season: (title: string) => number,
  opts?: { allowLoose?: boolean },
): string | null {
  const variants = witTitleVariants(names.map((name) => witCleanTitle(name)));
  if (variants.length === 0) return null;
  const wantedSeasons = witWantedSeasons(names, season);
  const scored = [...new Map(cards.map((card) => [card.href, card])).values()]
    .filter((card) => wantedSeasons.has(season(card.title)))
    .map((card) => {
      const b = witCleanTitle(card.title);
      let sym = 0;
      let loose = 0;
      for (const name of variants) {
        const a = fuzzyScore(name, b);
        const s = Math.min(a, fuzzyScore(b, name));
        if (s > sym) sym = s;
        // Subtitle-style long form: the card BEGINS with the name ("Mushoku
        // Tensei Ⅱ: Isekai Ittara Honki Dasu" for "Mushoku Tensei II"), so the
        // extra words continue the title instead of contradicting it.
        if (name.length >= 4 && b.startsWith(name) && a > loose) loose = a;
      }
      return { ...card, sym, loose: Math.max(sym, loose) };
    })
    .sort((a, b) => b.sym - a.sym);
  if (scored[0] && scored[0].sym >= 0.8 && !(scored[1] && scored[0].sym - scored[1].sym < 0.06)) return scored[0].href;

  // Strict pass found nothing. The loose pass only RESCUES entries the strict
  // score rejected (sym < 0.8), so it can never displace a strict match. It's
  // rails-only: for episode resolution a tie can mean a sibling season with
  // restarted numbering, which must stay unresolved rather than guess.
  if (!opts?.allowLoose) return null;
  const rescued = scored
    .filter((card) => card.sym < 0.8 && card.loose >= 0.8)
    .sort((a, b) => b.loose - a.loose);
  if (!rescued.length) return null;
  const group = rescued.filter((card) => rescued[0].loose - card.loose < 0.06);
  // A rescue is only safe when every top candidate is the SAME cleaned title
  // (main entry + "2nd Cour" variants); prefer the shortest raw title = the
  // main entry. Different long forms at the top = too ambiguous, stay null.
  if (new Set(group.map((card) => witCleanTitle(card.title))).size > 1) return null;
  return group.sort((a, b) => a.title.length - b.title.length)[0].href;
}

export function witEpisodeLink(html: string, animeUrl: string, number: number): string | null {
  const base = new URL(animeUrl);
  const slug = base.pathname.split("/").filter(Boolean).pop();
  for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
    try {
      const url = new URL(match[1].replace(/&amp;/g, "&"), base);
      if (url.origin !== base.origin) continue;
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] !== "watch") continue;
      if (parts[1] === slug && Number(parts[2]) === number) return url.toString();
      if (number === 1 && base.pathname.startsWith("/movie/") && parts[1] === "movie" && parts[2] === slug) return url.toString();
    } catch {}
  }
  return null;
}

export async function resolveWitanimeEpisode(
  title: string, number: number, animeHref: string | null | undefined,
  search: (query: string) => Promise<Card[] | null>,
  aliases: (title: string) => Promise<string[]>,
  season: (title: string) => number,
  read: (url: string) => Promise<string | null>,
  // Fired only when the anime page came from a search (not from a known/cached
  // URL), so callers can remember the result and skip /search next time.
  onResolved?: (animeHref: string) => void,
): Promise<string | null> {
  if (!Number.isFinite(number) || number < 1) return null;
  const given = animeHref && /^https?:\/\/(?:[^/]+\.)?witanime\.[^/]+\/(?:anime|movie)\//i.test(animeHref)
    ? animeHref : null;

  const readEpisode = async (animeUrl: string | null) => {
    if (!animeUrl) return null;
    const html = await read(animeUrl).catch(() => null);
    return html ? witEpisodeLink(html, animeUrl, number) : null;
  };

  const searchForAnime = async (): Promise<string | null> => {
    if (!title) return null;
    const names = [title, ...[...title.matchAll(/[([]([^)\]]+)[)\]]/g)].map((m) => m[1])];
    const tried = new Set<string>();
    const cards: Card[] = [];
    // The site rate-limits /search hard: a parallel burst of four queries comes
    // back HTTP 429 and the whole lookup used to die there (no Witanime servers
    // for that episode). Query one at a time and stop as soon as a confident
    // match lands — usually the very first query, so this is also fewer GETs.
    const find = async (queries: string[]) => {
      for (const query of [...new Set(queries)]) {
        if (!query || tried.has(query)) continue;
        tried.add(query);
        const results = await search(query).catch(() => null);
        if (results?.length) cards.push(...results);
        const match = matchWitanimeTitle(names, cards, season);
        if (match) return match;
      }
      return null;
    };
    let found = await find(sourceSearchQueries(title, 4));
    if (!found) {
      const alt = await aliases(title).catch(() => []);
      names.push(...alt.filter((name) => !names.includes(name)).slice(0, 4));
      found = await find(names.slice(1).flatMap((name) => sourceSearchQueries(name, 2)));
    }
    if (found) onResolved?.(found);
    return found;
  };

  // The known/cached anime page is tried first (no rate-limited search). When it
  // can't produce THIS episode's link — the anime page was renamed, or the
  // episode sits beyond what that page lists — the title search still runs
  // instead of reporting "no Witanime copy".
  const viaKnown = await readEpisode(given);
  if (viaKnown) return viaKnown;
  const discovered = await searchForAnime();
  if (!discovered) return null;
  return discovered === given ? null : readEpisode(discovered);
}

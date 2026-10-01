export function shouldShowSynopsis(_animeHref: string, synopsis: string | null | undefined): boolean {
  return !!synopsis;
}

// Source pages bake SEO boilerplate into their "story" field: a chain of alt
// names plus site promotion ("مشاهدة وتحميل … - <alt names> - اون لاين بجودة
// عالية - Anime3rb أنمي عرب"). A real Arabic synopsis is kept intact; junk is
// stripped segment by segment, and when only short name fragments survive the
// whole text is dropped so the detail page hides the block instead of showing
// a name wall.
const SYNOPSIS_JUNK =
  /تحميل\s*و?\s*مشاهدة|مشاهدة\s*و?\s*تحميل|اون\s*لاين|أون\s*لاين|أونلاين|بجودة\s*عالية|جميع\s*(?:ال)?حلقات|anime3rb|anime4up|witanime|أنمي\s*عرب|انمي\s*عرب|حصريا?ً?\s*على|موقع\s*انمي|تابعنا|شاهد\s*الآن|بدون\s*إعلانات/i;

export function cleanSynopsis(raw: string | null | undefined): string {
  let s = (raw || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  // Drop a leading "قصة الأنمي:" / "قصة انمي" / "القصة:" / "Story:" label.
  s = s.replace(/^\s*(?:قصة\s*(?:الأنمي|الانمي|انمي)?|القصة|story|synopsis)\s*[:：\-–]?\s*/i, "").trim();
  if (SYNOPSIS_JUNK.test(s)) {
    // Remove only the segments carrying the boilerplate markers; keep any real
    // story sentences that may sit alongside them. anime3rb's SEO blurb has no
    // sentence punctuation (it chains alt-titles with " - "/"|"/"،"), so split
    // on those separators too — otherwise the whole run survived as one segment.
    const segments = s
      .split(/[.!؟\n|،]+|\s[-–—]\s/)
      .map((p) => p.trim())
      .filter(Boolean);
    const kept = segments.filter((p) => !SYNOPSIS_JUNK.test(p));
    s = kept.join(". ").trim();
    // If boilerplate markers still survive after segmenting, the text is SEO
    // junk through-and-through — drop it entirely rather than show a fragment.
    if (SYNOPSIS_JUNK.test(s)) return "";
    // The alt-name chain residue ("One Piece. ONE PIECE. OP. عمك. وان بيس…")
    // is all SHORT fragments; real prose keeps at least one sentence-length
    // piece. All-fragments means the text was never a story — drop it.
    if (kept.length > 0 && kept.every((p) => p.length < 28)) return "";
  }
  // anime4up/a3rb fill the story slot with tag text that names the season
  // instead of describing it: "الموسم الثالث من X.", "القسم الثالث من الموسم
  // الثاني.", "قصة انمي بليتش Bleach: … الجزء الرابع والأخير من X." or the
  // same name wall in Arabic. A tag is short and carries little Arabic prose;
  // a real story keeps whole sentences of it. Tag-only text drops entirely; a
  // tag sentence PREPENDED to a real story is cut so only the story stays.
  const metaTag = /تتمة\s+لاحداث|ال(?:موسم|جزء|قسم|فيلم|أوفا)|أوفا\s+تابعة|حلقة\s+خاصة/;
  const arabicRuns = (s.match(/[\u0600-\u06FF]+/g) || []).length;
  if (s.length < 220 && arabicRuns < 15 && metaTag.test(s)) return "";
  const isTagSeg = (seg: string): boolean => {
    const runs = (seg.match(/[\u0600-\u06FF]+/g) || []).length;
    const latin = (seg.match(/[A-Za-z]/g) || []).length;
    const arabic = (seg.match(/[\u0600-\u06FF]/g) || []).length;
    if (latin >= 8 && latin > arabic) return true;
    return runs < 8 && seg.length < 200 && metaTag.test(seg);
  };
  const sentences = s.match(/[^.!؟…]+[.!؟…]*/g) || [s];
  if (sentences.length > 1) {
    let cut = 0;
    while (cut < sentences.length - 1 && isTagSeg(sentences[cut].trim())) cut++;
    if (cut > 0) s = sentences.slice(cut).join(" ").replace(/\s+/g, " ").trim();
  }
  // A sentence that restarts the description with a season/part opener
  // ("…انهارت العوالم. الموسم الثالث من X تدور أحداثه…") is the source page's
  // per-season re-description leaking in after the real story — cut from the
  // restart on. Mid-sentence mentions ("في الجزء الأخير من القصة") survive
  // because the opener must begin its own sentence.
  const restart = /(?:الموسم|الجزء|القسم)\s+[^.،؟!«»\n]{1,26}\sمن\s/;
  const rm = restart.exec(s);
  if (rm && rm.index >= 60 && /[.!؟…]\s*$/.test(s.slice(0, rm.index))) {
    s = s.slice(0, rm.index).trim();
  }
  const finalRuns = (s.match(/[\u0600-\u06FF]+/g) || []).length;
  const finalLatin = (s.match(/[A-Za-z]/g) || []).length;
  const finalArabic = (s.match(/[\u0600-\u06FF]/g) || []).length;
  if (finalLatin > 0 && finalRuns < 6) return "";
  if (finalLatin > finalArabic) return "";
  // Anything shorter than a clause is almost certainly a leftover fragment.
  // Finally apply the appended-tail cut (card metas, "أسماء أخرى", "N حلقات")
  // here too, so every read path — fresh scrape, local cache, cloud cache —
  // stores and serves the same trimmed text the screen would show.
  const out = synopsisForDisplay(s);
  return out.length < 25 ? "" : out;
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
  let clean = value;
  if (marker && marker.index >= 25) {
    clean = value.slice(0, marker.index).trim();
    // The material before the marker usually ends mid-clause: "…انتهت. كوميدي
    // ربيع 2016" — the card's opening words before its rating label. Drop a
    // dangling fragment shorter than a sentence that follows the last sentence
    // end, so the cut leaves clean prose.
    const lastEnd = Math.max(clean.lastIndexOf("."), clean.lastIndexOf("؟"), clean.lastIndexOf("!"));
    if (lastEnd >= 25 && clean.length - lastEnd - 1 < 40) clean = clean.slice(0, lastEnd + 1).trim();
  }

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

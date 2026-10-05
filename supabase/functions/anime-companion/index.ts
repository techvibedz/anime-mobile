// Pantoufa — anime-companion Edge Function
//
// Spoiler-safe Arabic AI companion for the watch screen. Two modes:
//   • "recap" → 4-6 bullet Arabic recap of what happened UP TO the episode.
//   • "chat"  → answers a free-form question about this anime without ever
//     revealing anything past the episode the user is watching.
//
// Provider-agnostic: any OpenAI-compatible POST /chat/completions works
// (OpenAI, Groq, OpenRouter, a local proxy...). When the three AI_* env vars
// are absent we return 200 { ok:false, error:"not_configured" } so the client
// can hide the feature instead of surfacing an error.
//
// Deploy: supabase functions deploy anime-companion   (JWT verification ON)
// Env:  AI_BASE_URL (e.g. https://api.openai.com/v1), AI_API_KEY, AI_MODEL
//       plus the auto-provided SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const JSON_HEADERS = { "Content-Type": "application/json" };

// Per attempt. Worst case is 2 attempts (primary + fallback, or primary + its
// truncation retry) = 36s here, plus ≤4s grounding, inside the 45s client
// deadline. 18s (not 10-15) because the providers get slow under load.
const AI_TIMEOUT_MS = 18_000;
// Whole-chain wall clock (grounding + up to 3 attempts) stays under the
// client's 45s deadline with margin for the grounding calls before it.
const AI_BUDGET_MS = 32_000;
// Slightly low: directness and factual density over creative rambling.
const AI_TEMPERATURE = 0.35;
// The visible Arabic answer shares this budget with provider-side thinking
// tokens. The smart Flash tier spends ~1.2-1.5k on thinking before writing, so
// 1100 truncated it; 2600 fits thinking + a detailed 6-9 bullet recap. A
// truncated PRIMARY answer gets one retry at AI_RETRY_MAX_TOKENS.
const AI_MAX_TOKENS = 2600;
const AI_RETRY_MAX_TOKENS = 3500;

// Soft per-user rate limit: 12 requests / 10 minutes. Module-level so it
// survives between requests on a warm isolate; a cold start resets it, which
// is fine for an anti-abuse guard (not a billing guarantee).
const RATE_LIMIT_MAX = 12;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const rateHits = new Map<string, number[]>();

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const recent = (rateHits.get(userId) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) {
    rateHits.set(userId, recent);
    return true;
  }
  recent.push(now);
  rateHits.set(userId, recent);
  return false;
}

function json(status: number, payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

function err(status: number, error: string): Response {
  return json(status, { ok: false, error });
}

// The hard spoiler rule lives here (not only in the context block) so every
// mode inherits it. Voice: a direct Arabic anime encyclopedia — answer first,
// dense specifics, zero small talk (no greetings, filler, emojis or trailing
// "want more?" questions), so it never reads like a chatty toy.
const SYSTEM_PROMPT = [
  "أنت «رفيق بانتوفة»: مساعد أنمي عربي دقيق ومباشر.",
  "قواعد صارمة لا تُخرَق:",
  "1) لا تكشف أبدًا أي أحداث أو شخصيات أو مفاجآت أو وفيات تحدث بعد الحلقة الحالية (حد الحرق)، مهما حدث.",
  "2) إذا سُئلت عن أحداث لاحقة، اذكر بإيجاز أن السؤال يتجاوز حد الحرق، ثم توقف.",
  "3) ابقَ في موضوع هذا الأنمي والحديث العام عن الأنمي فقط.",
  "4) ارفض بإيجاز أي محتوى غير لائق أو غير قانوني.",
  "5) أجب بالعربية فقط.",
  "6) التزم بالموسم والاسم البديل المذكورين في السياق حرفيًا؛ لا تخلط أحداث هذا الجزء مع السلسلة الأصلية أو أي موسم آخر، وإن لم تتأكد من أحداث هذا الموسم تحديدًا فاذكر ذلك بصراحة بدل التخمين.",
  "7) قدّم تفاصيل الحلقة بثقة اعتمادًا على معرفتك بالأنمي. إذا لم يتوفر عنوان الحلقة في السياق فلا تذكر ذلك إطلاقًا ولا تقل إن معلوماتك ناقصة أو إن المصدر لا يحتوي تفاصيل — أجب بأفضل ما تعرفه. لا ترفض السؤال ولا تعتذر، ولا تخترع أحداثًا لا تعرفها؛ وإذا شككت في تفصيلة دقيقة فاذكرها بصيغة غير جازمة.",
  "8) المستخدم يشاهد هذا العمل الآن، فهو صادر ومتاح بالتأكيد. لا تقل أبدًا إن العمل أو هذا الموسم «لم يصدر بعد» أو «لم يُعرض بعد»، واعتمد على حالة العمل وتاريخ اليوم المذكورين في السياق بدلًا من معرفتك القديمة.",
  "9) إذا وُجد ملخص الحلقة في السياق فاعتمد أحداثه حرفيًا وابنِ عليه ولا تناقضه أبدًا؛ أضف من معرفتك فقط ما لا يتعارض معه.",
  "أسلوب الإجابة:",
  "- ابدأ بالجواب مباشرة من أول جملة. ممنوع: الترحيب، «بالطبع»، «سؤال رائع»، المقدمات، الأسئلة الختامية، الإيموجي.",
  "- ممنوع الحديث عن «السياق» أو «المصدر» أو «قاعدة البيانات» أو حدود معرفتك أو عدم توفر معلومات؛ المستخدم يريد الجواب مباشرة.",
  "- اذكر تفاصيل محددة: أسماء الشخصيات والأماكن والقدرات والأحداث وأسبابها ونتائجها. لا عموميات ولا حشو.",
  "- اشرح كل ما حدث حتى الحلقة الحالية بالتفصيل الذي يطلبه السؤال، مع الالتزام بحد الحرق.",
  "- في المحادثة: 2 إلى 5 جمل أو نقاط قصيرة مركّزة.",
  "- اعتمد على الرسائل السابقة، ولا تُعد شرح ما سبق إلا إذا طُلب منك.",
].join("\n");

const RECAP_INSTRUCTION =
  "اكتب تلخيصًا بالعربية بلا أي مقدمة: 6 إلى 9 نقاط قصيرة، كل نقطة حدث محدد بالأسماء ونتائجه، لما حدث حتى هذه الحلقة، دون أي حرق بعد حد الحرق المذكور.";

function buildContextMessage(
  animeTitle: string,
  epNum: number,
  episodeTitle: string,
  seasonNumber: number | undefined,
  altTitle: string,
  groundingTitle: string | null,
  episodeSummary: string | null,
  anilistGrounding: string | null,
  today: string,
  totalEpisodes: number | undefined,
  spoilerBound: number,
): string {
  const lines = [`الأنمي: ${animeTitle}`];
  if (altTitle) {
    lines.push(`الاسم البديل (رومي/إنجليزي): ${altTitle} — قد يكون الاسم الأشهر لهذا الجزء تحديدًا.`);
  }
  if (seasonNumber) {
    lines.push(`الموسم المحدد: ${seasonNumber} — أجب عن أحداث هذا الموسم فقط ولا تخلطها مع أي موسم آخر.`);
  }
  if (anilistGrounding) {
    lines.push(
      `حالة العمل حسب AniList: ${anilistGrounding} — لا تنفِ صدور هذا العمل، فالمستخدم يشاهده الآن.`,
    );
  }
  if (groundingTitle) {
    lines.push(
      `عنوان الحلقة: «${groundingTitle}» — استخدمه لتحديد أحداث هذه الحلقة بدقة وعدم الخلط مع حلقات أخرى.`,
    );
  }
  if (episodeSummary) {
    lines.push(
      `ملخص الحلقة (اعتمد عليه كأساس للأحداث، ولا تناقضه، ويمكنك إثراؤه بتفاصيل تعرفها): ${episodeSummary}`,
    );
  }
  lines.push(
    episodeTitle
      ? `الحلقة الحالية: ${epNum} — بعنوان: ${episodeTitle}`
      : `الحلقة التي يشاهدها المستخدم الآن: ${epNum}`,
  );
  if (totalEpisodes !== undefined) lines.push(`عدد الحلقات الكلي: ${totalEpisodes}`);
  lines.push(`تاريخ اليوم: ${today}.`);
  lines.push(`حد الحرق: لا تكشف أي شيء بعد الحلقة ${spoilerBound} مهما حدث.`);
  return lines.join("\n");
}

/**
 * One provider call. Never throws: network/abort/non-2xx/empty/invalid all
 * come back as { ok: false }, so the caller can try the fallback model.
 */
async function callAI(
  base: string,
  key: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
  timeoutMs: number = AI_TIMEOUT_MS,
): Promise<{ ok: true; content: string; truncated: boolean } | { ok: false; status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const upstream = await fetch(`${base.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: AI_TEMPERATURE,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });
    if (!upstream.ok) {
      // Log the provider status/body for debugging but never leak it to the client.
      const detail = await upstream.text().catch(() => "");
      console.error("AI upstream error", model, upstream.status, detail.slice(0, 500));
      return { ok: false, status: upstream.status };
    }
    let data: any = null;
    try {
      data = await upstream.json();
    } catch (e) {
      console.error("AI response not JSON", model, e);
    }
    const choice = data?.choices?.[0];
    const content = choice?.message?.content;
    // Gemini gates report "length"; some OpenAI-compatible gateways report
    // "MAX_TOKENS" — accept both, case-insensitively.
    const finish = typeof choice?.finish_reason === "string" ? choice.finish_reason.toLowerCase() : "";
    const truncated = finish === "length" || finish === "max_tokens";
    if (typeof content !== "string" || !content.trim()) {
      // Thinking tokens can eat the ENTIRE budget, leaving empty content with
      // finish_reason=length. Surface that as a retryable truncation instead of
      // a hard failure so the caller retries with the bigger budget.
      if (truncated) return { ok: true, content: "", truncated: true };
      console.error("AI response bad shape", model, JSON.stringify(data)?.slice(0, 500));
      return { ok: false, status: 502 };
    }
    return { ok: true, content: content.trim(), truncated };
  } catch (e) {
    console.error("AI fetch failed", model, e);
    return { ok: false, status: 502 };
  } finally {
    clearTimeout(timer);
  }
}

/* ── Episode grounding (MAL titles via Jikan) ───────────────────────────
   Models guess wrong beats for long-running anime. When Jikan is reachable we
   look up the real MAL episode title and put it in the context; when it is
   down (frequent 5xx) we skip silently and fast — grounding is an upgrade,
   never a dependency. Cached per title#episode so lookups stay rare. */
const malCache = new Map<string, { title: string | null; at: number }>();
const MAL_TTL_MS = 6 * 60 * 60 * 1000;
// Failed lookups are cached briefly, not for hours: a provider outage must not
// block grounding long after it recovers.
const MAL_NULL_TTL_MS = 10 * 60 * 1000;
const MAL_TIMEOUT_MS = 4_000;

// Seasons have identical base titles ("Mushoku Tensei …" S1/S2/S3), so a
// naive first-result Jikan search can ground the companion on the WRONG
// season. Detect the season from a MAL title (romans anywhere, Unicode
// folded) and prefer the candidate that matches the requested season.
const MAL_ROMAN: Record<string, number> = {
  II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10,
};

function malSeasonOf(raw: string): number {
  const folded = String(raw || "").replace(/[\u2160-\u217f]/g, (ch) => {
    const map: Record<string, string> = {
      "\u2160": "I", "\u2161": "II", "\u2162": "III", "\u2163": "IV", "\u2164": "V",
      "\u2165": "VI", "\u2166": "VII", "\u2167": "VIII", "\u2168": "IX", "\u2169": "X",
    };
    return map[ch] ?? ch;
  });
  const lower = folded.toLowerCase().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  const m =
    lower.match(/\b(?:season|part|cour|s)\s*(\d+)\b/) ||
    lower.match(/\b(\d+)(?:st|nd|rd|th)\s+(?:season|part|cour)\b/) ||
    lower.match(/(?:الموسم|الجزء)\s*(\d+)/);
  if (m) return parseInt(m[1], 10);
  const multi = folded.match(/\b(VIII|VII|VI|IV|IX|III|II)\b/i);
  if (multi) return MAL_ROMAN[multi[1].toUpperCase()] ?? 0;
  return 0; // single V/X collide with words/title letters — never a season here
}

/* ── AniList grounding: real status + air dates ────────────────────────
   Model knowledge goes stale ("season 3 isn't out yet" for a show that
   finished months ago). AniList is reliable and carries status / episode
   count / air dates, so we inject those as facts the model must use. */
const anilistCache = new Map<
  string,
  { text: string | null; enTitle: string | null; at: number }
>();

/** AniList result: a status/date line for the prompt + the entry's English
 *  title, which later providers (TVmaze/Wikipedia/Jikan) search far better
 *  than a raw source title. */
type AniListGrounding = { text: string | null; enTitle: string | null };

const ANILIST_STATUS_AR: Record<string, string> = {
  FINISHED: "مكتمل",
  RELEASING: "يُعرض حاليًا",
  NOT_YET_RELEASED: "لم يبدأ عرضه بعد",
  CANCELLED: "ملغى",
  HIATUS: "متوقف مؤقتًا",
};

function fmtAniDate(d?: { year?: number | null; month?: number | null; day?: number | null }): string {
  if (!d?.year) return "";
  const mm = String(d.month ?? 1).padStart(2, "0");
  const dd = String(d.day ?? 1).padStart(2, "0");
  return `${d.year}-${mm}-${dd}`;
}

async function fetchAniListGrounding(
  searchTitle: string,
  seasonNumber?: number,
): Promise<AniListGrounding | null> {
  const key = `${searchTitle.toLowerCase().trim()}#s${seasonNumber ?? 0}`;
  const hit = anilistCache.get(key);
  if (hit && Date.now() - hit.at < (hit.text ? MAL_TTL_MS : MAL_NULL_TTL_MS)) {
    return { text: hit.text, enTitle: hit.enTitle };
  }

  let text: string | null = null;
  let enTitle: string | null = null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MAL_TIMEOUT_MS);
  try {
    const query =
      "query ($search: String) { Page(perPage: 5) { media(search: $search, type: ANIME) { id status episodes format startDate { year month day } endDate { year month day } title { romaji english } } } }";
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { search: searchTitle } }),
      signal: controller.signal,
    });
    if (res.ok) {
      const json = await res.json().catch(() => null);
      const media: Array<{
        status?: string;
        episodes?: number | null;
        startDate?: { year?: number | null; month?: number | null; day?: number | null };
        endDate?: { year?: number | null; month?: number | null; day?: number | null };
        title?: { romaji?: string | null; english?: string | null };
      }> = Array.isArray(json?.data?.Page?.media) ? json.data.Page.media : [];
      const wanted = seasonNumber && seasonNumber > 0 ? seasonNumber : 0;
      const seasonMatches = wanted
        ? media.filter((m) => malSeasonOf(String(m?.title?.romaji || m?.title?.english || "")) === wanted)
        : media;
      // The user is watching this right now, so the entry cannot be an
      // unreleased sequel ("... Part 2", 2027) that shares the season number.
      const released = seasonMatches.filter((m) => m?.status && m.status !== "NOT_YET_RELEASED");
      const pick = released[0] ?? (wanted ? null : seasonMatches[0]);
      if (pick) {
        const status = ANILIST_STATUS_AR[pick.status ?? ""] ?? pick.status ?? "";
        const from = fmtAniDate(pick.startDate);
        const to = fmtAniDate(pick.endDate);
        const bits = [`الحالة: ${status}`];
        if (pick.episodes) bits.push(`عدد الحلقات: ${pick.episodes}`);
        if (from) bits.push(to ? `صدر من ${from} إلى ${to}` : `بدأ عرضه في ${from}`);
        text = bits.join(" — ");
        enTitle = pick.title?.english?.trim() || pick.title?.romaji?.trim() || null;
      }
    }
  } catch {
    // AniList unreachable — grounding skipped (never fatal).
  } finally {
    clearTimeout(timer);
  }
  anilistCache.set(key, { text, enTitle, at: Date.now() });
  return { text, enTitle };
}

async function fetchMalEpisodeTitle(
  searchTitle: string,
  epNum: number,
  seasonNumber?: number,
): Promise<string | null> {
  const key = `${searchTitle.toLowerCase().trim()}#${epNum}#s${seasonNumber ?? 0}`;
  const hit = malCache.get(key);
  if (hit && Date.now() - hit.at < (hit.title ? MAL_TTL_MS : MAL_NULL_TTL_MS)) return hit.title;

  let title: string | null = null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MAL_TIMEOUT_MS);
  try {
    const search = await fetch(
      `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(searchTitle)}&limit=5&sfw`,
      { signal: controller.signal },
    );
    if (search.ok) {
      const sdata = await search.json().catch(() => null);
      const arr: Array<{ mal_id?: number; title?: string }> = Array.isArray(sdata?.data)
        ? sdata.data
        : [];
      const wanted = seasonNumber && seasonNumber > 0 ? seasonNumber : 0;
      // When a season is requested but no top-5 result carries it, skip
      // grounding entirely — grounding on Season 1 would anchor the answer to
      // the wrong season, which is worse than no grounding at all.
      const picked = wanted
        ? arr.find((a) => malSeasonOf(String(a?.title || "")) === wanted) ?? null
        : arr[0];
      const malId = picked?.mal_id;
      if (typeof malId === "number" && malId > 0) {
        const page = Math.floor((epNum - 1) / 100) + 1;
        const eps = await fetch(
          `https://api.jikan.moe/v4/anime/${malId}/episodes?page=${page}`,
          { signal: controller.signal },
        );
        if (eps.ok) {
          const edata = await eps.json().catch(() => null);
          const entry = Array.isArray(edata?.data)
            ? edata.data.find((e: { mal_id?: number }) => e?.mal_id === epNum)
            : null;
          if (entry && typeof entry.title === "string" && entry.title.trim()) {
            title = entry.title.trim().slice(0, 160);
          }
        }
      }
    }
  } catch {
    // Jikan flaky/down or timed out — grounding skipped.
  } finally {
    clearTimeout(timer);
  }
  malCache.set(key, { title, at: Date.now() });
  return title;
}

/* ── Episode title + summary grounding (TVmaze → Wikipedia) ────────────
   Models do NOT reliably know per-episode beats; real episode data is the
   only cure. TVmaze carries name+summary for most anime (server-friendly
   JSON); Wikipedia's episode tables are the quality fallback. Both run with
   short timeouts and are cached like the others. */
type EpisodeGround = { title: string | null; summary: string | null };

const epGroundCache = new Map<string, { data: EpisodeGround | null; at: number }>();

function cleanText(raw: string): string {
  return String(raw || "")
    .replace(/\{\{[^{}]*\}\}/g, " ")
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function withAbort<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fn(controller.signal).finally(() => clearTimeout(timer));
}

async function fetchTvmazeEpisode(
  queryTitle: string,
  epNum: number,
  seasonNumber: number,
): Promise<EpisodeGround | null> {
  // TVmaze names the show without subtitles ("Mushoku Tensei: Jobless
  // Reincarnation"), so search a progressively shorter base title.
  const base = queryTitle
    .replace(/\s*[:：].*$/, "")
    .replace(/\b(?:season|part|cour)\s*\d+\b/gi, " ")
    .replace(/\b(viii|vii|vi|iv|ix|iii|ii)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = base.split(" ");
  const queries = [
    base,
    words.slice(0, 3).join(" "),
    words.slice(0, 2).join(" "),
  ].filter((q, i, a) => q && a.indexOf(q) === i);

  // One shared 4.5s budget for ALL search attempts — three sequential aborts
  // could otherwise burn 12s and push past the client's deadline.
  return withAbort(4_500, async (signal) => {
    for (const q of queries) {
      const search = await fetch(
        `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(q)}`,
        { signal },
      );
      if (!search.ok) continue;
      const list = await search.json().catch(() => null);
      const showId = Array.isArray(list) ? list[0]?.show?.id : null;
      if (typeof showId !== "number") continue;
      const res = await fetch(`https://api.tvmaze.com/shows/${showId}/episodes`, { signal });
      if (!res.ok) continue;
      const eps = await res.json().catch(() => null);
      if (!Array.isArray(eps)) continue;
      // Season-numbered match preferred; without a marker fall back to the
      // first episode with the right number (best-effort).
      const pick = seasonNumber > 0
        ? eps.find((e) => e?.season === seasonNumber && e?.number === epNum)
        : eps.find((e) => e?.number === epNum);
      if (!pick) continue;
      return {
        title: typeof pick.name === "string" ? pick.name.slice(0, 160) : null,
        summary: typeof pick.summary === "string" ? cleanText(pick.summary).slice(0, 700) : null,
      };
    }
    return null;
  });
}

async function fetchWikipediaEpisode(
  queryTitle: string,
  epNum: number,
  seasonNumber: number,
): Promise<EpisodeGround | null> {
  try {
    return await withAbort(4_500, async (signal) => {
      const searchQ = seasonNumber > 0
        ? `${queryTitle} season ${seasonNumber}`
        : `${queryTitle} episodes`;
      const search = await fetch(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(searchQ)}&srlimit=3&format=json`,
        { signal },
      );
      if (!search.ok) return null;
      const sdata = await search.json().catch(() => null);
      const titles: string[] = Array.isArray(sdata?.query?.search)
        ? sdata.query.search.map((r: { title?: string }) => String(r?.title || ""))
        : [];
      const page = titles.find((t) => /season|episode|list of/i.test(t)) || titles[0];
      if (!page) return null;

      const parsed = await fetch(
        `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&redirects=1&format=json`,
        { signal },
      );
      if (!parsed.ok) return null;
      const pdata = await parsed.json().catch(() => null);
      const wikitext: string = pdata?.parse?.wikitext?.["*"] || "";
      if (!wikitext) return null;

      const blocks = wikitext.split(/\{\{\s*Episode list/i).slice(1);
      for (const block of blocks) {
        // Season articles carry the season-local number in EpisodeNumber2 and
        // the overall series number in EpisodeNumber; flat "List of …
        // episodes" articles only have EpisodeNumber. Prefer the local one —
        // the user's episode number is always season-local.
        const num =
          block.match(/\|\s*EpisodeNumber2\s*=\s*(\d+)/i)?.[1] ??
          block.match(/\|\s*EpisodeNumber\s*=\s*(\d+)/i)?.[1];
        if (!num || parseInt(num, 10) !== epNum) continue;
        const rawTitle = block.match(/\|\s*Title\s*=\s*([^\n|]+)/i)?.[1];
        const rawSummary = block.match(/\|\s*ShortSummary\s*=\s*([\s\S]*?)(?=\n\s*\||\}\})/i)?.[1];
        const title = rawTitle ? cleanText(rawTitle).slice(0, 160) : null;
        const summary = rawSummary ? cleanText(rawSummary).slice(0, 700) : null;
        if (title || summary) return { title, summary };
      }
      return null;
    });
  } catch {
    return null;
  }
}

async function fetchEpisodeGrounding(
  queryTitle: string,
  epNum: number,
  seasonNumber?: number,
): Promise<EpisodeGround | null> {
  const season = seasonNumber && seasonNumber > 0 ? seasonNumber : 0;
  const key = `${queryTitle.toLowerCase().trim()}#${epNum}#s${season}`;
  const hit = epGroundCache.get(key);
  if (hit) {
    const ttl = hit.data ? MAL_TTL_MS : MAL_NULL_TTL_MS;
    if (Date.now() - hit.at < ttl) return hit.data;
  }
  const [tvmaze, wiki, jikanTitle] = await Promise.all([
    fetchTvmazeEpisode(queryTitle, epNum, season),
    fetchWikipediaEpisode(queryTitle, epNum, season),
    fetchMalEpisodeTitle(queryTitle, epNum, seasonNumber),
  ]);
  const data: EpisodeGround | null = {
    title: tvmaze?.title || wiki?.title || jikanTitle || null,
    // TVmaze summaries are short; Wikipedia's are usually richer. Prefer the
    // longer one when both exist.
    summary:
      (wiki?.summary && (!tvmaze?.summary || wiki.summary.length > tvmaze.summary.length)
        ? wiki.summary
        : tvmaze?.summary) || null,
  };
  const empty = !data.title && !data.summary;
  epGroundCache.set(key, { data: empty ? null : data, at: Date.now() });
  return empty ? null : data;
}

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Verify the JWT manually (in addition to the platform's JWT gate) so we get
  // a userId for the rate limit and never trust an unauthenticated caller.
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  let userId: string | null = null;
  if (jwt) {
    const { data } = await supabase.auth.getUser(jwt);
    userId = data?.user?.id ?? null;
  }
  if (!userId) return err(401, "unauthenticated");

  const aiBase = Deno.env.get("AI_BASE_URL");
  const aiKey = Deno.env.get("AI_API_KEY");
  const aiModel = Deno.env.get("AI_MODEL") || "";
  const fallbackModel = Deno.env.get("AI_MODEL_FALLBACK") || "";
  const fallbackModel2 = Deno.env.get("AI_MODEL_FALLBACK2") || "";
  if (!aiBase || !aiKey || (!aiModel && !fallbackModel && !fallbackModel2)) {
    // Client degrades gracefully: hide the companion when the AI isn't wired.
    return err(200, "not_configured");
  }

  let body: {
    mode?: unknown;
    animeTitle?: unknown;
    epNum?: unknown;
    totalEpisodes?: unknown;
    question?: unknown;
    episodeTitle?: unknown;
    seasonNumber?: unknown;
    altTitle?: unknown;
    history?: unknown;
  } = {};
  try {
    body = await req.json();
  } catch { /* no/empty body → invalid below */ }

  const mode = body?.mode;
  if (mode !== "chat" && mode !== "recap") return err(400, "invalid_request");

  const animeTitle = typeof body?.animeTitle === "string" ? body.animeTitle.trim() : "";
  if (animeTitle.length < 1 || animeTitle.length > 200) return err(400, "invalid_request");

  const rawEp = body?.epNum;
  if (typeof rawEp !== "number" || !Number.isFinite(rawEp)) return err(400, "invalid_request");
  // Clamp instead of rejecting: a stale client sending 0 or a big number still
  // gets a usable companion, and the prompt bound stays sane either way.
  const epNum = Math.min(5000, Math.max(1, Math.trunc(rawEp)));

  const rawTotal = body?.totalEpisodes;
  const totalEpisodes =
    typeof rawTotal === "number" && Number.isFinite(rawTotal) && rawTotal >= 1
      ? Math.trunc(rawTotal)
      : undefined;
  const spoilerBound = totalEpisodes !== undefined ? Math.min(epNum, totalEpisodes) : epNum;

  let question = "";
  if (mode === "chat") {
    if (typeof body?.question !== "string") return err(400, "invalid_request");
    question = body.question.trim();
    if (question.length < 1 || question.length > 500) return err(400, "invalid_request");
  } else if (body?.question !== undefined) {
    // Recap ignores the question, but still reject an oversized payload.
    if (typeof body.question !== "string" || body.question.length > 500) {
      return err(400, "invalid_request");
    }
  }

  const episodeTitle =
    typeof body?.episodeTitle === "string" ? body.episodeTitle.trim().slice(0, 200) : "";
  const rawSeason = body?.seasonNumber;
  const seasonNumber =
    typeof rawSeason === "number" && Number.isFinite(rawSeason) && rawSeason >= 1 && rawSeason <= 50
      ? Math.trunc(rawSeason)
      : undefined;
  const altTitle = typeof body?.altTitle === "string" ? body.altTitle.trim().slice(0, 120) : "";

  // Prior turns keep the conversation continuous. Sanitized, never fatal:
  // junk entries are dropped instead of rejecting the whole question.
  const history: Array<{ role: "user" | "assistant"; content: string }> = [];
  if (Array.isArray(body?.history)) {
    for (const item of body.history.slice(-10)) {
      if (!item || typeof item !== "object") continue;
      const role = (item as { role?: unknown }).role;
      const text = (item as { text?: unknown }).text;
      if ((role !== "user" && role !== "ai") || typeof text !== "string") continue;
      const content = text.trim().slice(0, 500);
      if (!content) continue;
      history.push({ role: role === "ai" ? "assistant" : "user", content });
    }
  }

  // Rate-limit AFTER validation so malformed payloads can't lock a user out.
  if (isRateLimited(userId)) return err(429, "rate_limited");

  const models = [aiModel, fallbackModel, fallbackModel2]
    .map((m) => m.trim())
    .filter((m, i, a) => m && a.indexOf(m) === i);
  // Ground the answer in real data. AniList first (fast, reliable) because its
  // English title is the best search seed for the episode providers; then
  // TVmaze/Wikipedia/Jikan in parallel. All best-effort with short timeouts —
  // grounding upgrades the answer, it is never a dependency.
  const searchTitle = altTitle || animeTitle;
  const today = new Date().toISOString().slice(0, 10);
  const anilistGround = await fetchAniListGrounding(searchTitle, seasonNumber);
  const groundQuery = anilistGround?.enTitle || searchTitle;
  const episodeGround = await fetchEpisodeGrounding(groundQuery, epNum, seasonNumber);
  const contextMessage = buildContextMessage(
    animeTitle,
    epNum,
    episodeTitle,
    seasonNumber,
    altTitle,
    episodeGround?.title ?? null,
    episodeGround?.summary ?? null,
    anilistGround?.text ?? null,
    today,
    totalEpisodes,
    spoilerBound,
  );
  const messages = [
    { role: "system", content: `${SYSTEM_PROMPT}\n\n${contextMessage}` },
    ...history,
    { role: "user", content: mode === "recap" ? RECAP_INSTRUCTION : `سؤال المشاهد: ${question}` },
  ];

  // Model chain with a hard wall-clock budget: 429/503s fail fast, but a hung
  // provider must not eat the client's 45s deadline. Truncation retry only on
  // the primary (the smart tier burns budget on thinking tokens). If every
  // model fails, the client shows its retry toast.
  const budgetDeadline = Date.now() + AI_BUDGET_MS;
  let answer: string | null = null;
  for (let mi = 0; mi < models.length; mi++) {
    const remaining = budgetDeadline - Date.now();
    if (remaining <= 2_000) break;
    const first = await callAI(
      aiBase, aiKey, models[mi], messages, AI_MAX_TOKENS, Math.min(AI_TIMEOUT_MS, remaining),
    );
    if (!first.ok) continue; // timeout / 5xx / non-JSON → next model
    if (!first.truncated && first.content) {
      answer = first.content;
      break;
    }
    if (first.truncated && mi === 0 && models.length > 1) {
      const remaining2 = budgetDeadline - Date.now();
      if (remaining2 > 2_000) {
        const retry = await callAI(
          aiBase, aiKey, models[mi], messages, AI_RETRY_MAX_TOKENS, Math.min(AI_TIMEOUT_MS, remaining2),
        );
        if (retry.ok && retry.content) {
          answer = retry.content;
          break;
        }
      }
      if (first.content) {
        answer = first.content; // keep the partial rather than nothing
        break;
      }
      continue; // empty even after the bigger budget → try the fallback model
    }
    if (first.content) {
      answer = first.content; // truncated fallback: partial beats nothing
      break;
    }
    // ok, not truncated, empty: unreachable (callAI guards) — try next model.
  }
  if (!answer) return err(502, "upstream");

  return json(200, { ok: true, answer, spoilerBound });
});

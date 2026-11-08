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
// Env:  AI_BASE_URL (e.g. https://api.openai.com/v1), AI_API_KEYS (comma-separated,
//       rotated; a key out of quota hands over to the next) or AI_API_KEY, and either
//       AI_MODELS (comma-separated chain, best first) or AI_MODEL (+ _FALLBACK/_FALLBACK2)
//       plus the auto-provided SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchGrounding, type Grounding } from "./grounding.ts";

// The desktop app calls from a Chromium renderer, which sends a CORS preflight
// (Authorization + JSON body). Without an OPTIONS answer it got a 400 and the
// real request was never sent. Native mobile ignores these headers.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const JSON_HEADERS = { ...CORS_HEADERS, "Content-Type": "application/json" };

// Measured on the production key (Gemini free tier, 2026-10-31): the smart
// Flash models answer in 7-30s depending on load, Flash-Lite in ~1.5s. Calling
// them one after another (old 18s per-attempt timeout) made the smart model
// time out, the fallback run out the 32s budget, and the user got nothing.
// Now the models RACE with staggered starts (hedging): the smart model gets a
// head start, the next one joins if it is still silent, and the fast model is
// the safety net. First good answer wins; the rest are aborted.
// The free tier allows only ~20 requests/day PER MODEL, so a hedge costs real
// quota: the second smart model joins only once the first is clearly slow
// (smart answers usually land in 4-7s), the fast tier at 10s.
const HEDGE_DELAYS_MS = [0, 7_000, 10_000, 12_000];
// Whole AI phase hard stop. Grounding (<= GROUND_BUDGET_MS) + this stays
// inside the clients' 28s request deadline.
const AI_BUDGET_MS = 19_500;
// Real episode data is what makes answers accurate and spoiler-safe, so it is
// worth a short wait — measured ~4.5s cold (AniList, then TVmaze/Wikipedia/
// Jikan in parallel), instant once cached. Whatever has arrived by this point
// (counted from request start) goes into the prompt.
const GROUND_BUDGET_MS = 6_500;
// A model that answered 429/503 is skipped for a while so later questions
// don't burn their head start on it. Daily-quota 429s skip it far longer.
const MODEL_COOLDOWN_MS = 60_000;
const MODEL_DAILY_COOLDOWN_MS = 60 * 60 * 1000;
// Low: factual accuracy over creative rambling.
const AI_TEMPERATURE = 0.25;
// Thinking is disabled (reasoning_effort "none"), so this is all visible text:
// plenty for a detailed recap, and a hard cap on runaway answers.
const AI_MAX_TOKENS = 1800;

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

// The rules live in the system message so every mode inherits them. Voice: a
// sharp anime-expert friend. Thinking is off for speed, so the prompt spells
// out the silent checks — above all the spoiler check, because the model's
// general knowledge of a show includes everything AFTER the user's episode.
function systemPrompt(bound: number): string {
  return [
    "أنت «رفيق بانتوفة»: خبير أنمي ومانجا دقيق جدًا، تشرح بوضوح وعمق كصديق يعرف العمل جيدًا.",
    "",
    "مصادرك بالترتيب:",
    "1) «ما حدث حتى الآن» و«الحلقة الحالية» في بطاقة العمل: بيانات حقيقية عن هذا الجزء بالضبط، وهي الحقيقة. ابنِ إجابتك عليها أولًا ولا تناقضها (هي بالإنجليزية؛ أجب بالعربية).",
    `2) معرفتك العامة بالعمل: فقط لما يقع يقينًا في الحلقة ${bound} أو قبلها، ولإضافة تفاصيل (أسماء، قدرات، دوافع، أماكن) تتفق مع البيانات.`,
    "",
    `حد الحرق — أهم قاعدة: المستخدم شاهد حتى الحلقة ${bound} فقط.`,
    "- معرفتك العامة تشمل أحداثًا لاحقة، وهي مصدر الحرق الأول. قبل ذكر أي معلومة ليست في البيانات اسأل نفسك بصمت: هل تحدث أو تُكشف في هذه الحلقة أو قبلها؟ إن لم تكن متأكدًا فلا تذكرها.",
    "- ممنوع: أحداث لاحقة، وفيات، خيانات، هويات أو ماضٍ يُكشف لاحقًا، قدرات أو تحولات لم تظهر بعد، شخصيات لم تظهر بعد، نتائج معارك لم تُحسم، علاقات ستتغير، وأي تلميح مثل «لاحقًا سنعرف» أو «سيكون لهذا دور كبير» أو «انتظر ما سيحدث».",
    `- عن شخصية: صفها كما عُرفت حتى الحلقة ${bound} فقط. إن لم تظهر بعد فقل ذلك دون أي تفصيل عنها.`,
    "- القدرات والتقنيات وأسماء الهجمات والأسلحة الخاصة والماضي والهويات والعلاقات الخفية: اذكرها فقط إذا ظهرت في «ما حدث حتى الآن» أو «الحلقة الحالية» أو «فكرة هذا الجزء». ما لم يظهر هناك لا تذكره ولو كنت تعرفه يقينًا؛ قل إن بقية قدراته أو ماضيه لم تُكشف بعد. (إذا لم تُعطَ بيانات حلقات أصلًا فاعتمد معرفتك بحذر شديد ضمن القوس الحالي.)",
    "- إن كان الجواب الكامل يحتاج أحداثًا لاحقة: أجب بالمعروف حتى الآن، ثم جملة قصيرة «يتضح هذا أكثر في الحلقات القادمة» بلا أي تفصيل.",
    "- الحلقة الحالية قد يكون المستخدم في منتصفها: لا تكشف نهايتها أو مفاجأتها إلا إذا سأل عمّا حدث فيها.",
    "- معلومات الصدور (عدد المواسم، هل انتهى العرض، موعد الموسم القادم) ليست حرقًا. إن طلب المستخدم الحرق صراحةً فاعتذر بلطف في جملة واحدة.",
    "",
    "الدقة:",
    "- التزم بهذا الجزء/الموسم ولا تخلطه بموسم آخر أو بعمل يحمل اسمًا مشابهًا.",
    "- لا تخلط بين الشخصيات المتشابهة ولا تخترع أسماء أو أحداثًا أو أرقام حلقات. تهجئة الأسماء في البطاقة صحيحة.",
    "- إن لم تكن التفصيلة في البيانات ولست متأكدًا منها فقل ذلك باختصار بدل التخمين، وأجب عن بقية السؤال.",
    "- لا تنفِ صدور العمل؛ المستخدم يشاهده الآن، واعتمد حالة العمل وتاريخ اليوم في البطاقة بدل معرفتك القديمة.",
    "- الموضوع: هذا الأنمي والأنمي/المانجا عمومًا (ترشيحات، مقارنات، شرح مصطلحات). ارفض بإيجاز ما سوى ذلك وأي محتوى غير لائق.",
    "",
    "فهم السؤال (بصمت، لا تكتبه):",
    "- افهمه بأي لهجة (جزائرية، مغربية، مصرية، خليجية، شامية، فصحى) أو بحروف لاتينية (مثل «chkoun howa»).",
    "- حدد المقصود بالضبط وأجب عنه أولًا: «من هو» ← الهوية والدور والقدرات والعلاقات وأهم ما فعله حتى الآن. «لماذا» ← الأسباب والدوافع كما ظهرت. «ماذا حدث» ← الأحداث بالترتيب مع أسبابها ونتائجها. «اشرح» ← الفكرة ببساطة مع مثال من القصة. «هل يستحق/ترشيح» ← رأي واضح مع سبب لكل اختيار.",
    `- «هذه الحلقة» = الحلقة ${bound}، و«الحلقة السابقة» = ${Math.max(1, bound - 1)}. السؤال الغامض: اختر التفسير الأرجح في سياق الحلقة وأجب مباشرة.`,
    "",
    "أسلوب الإجابة:",
    "- اللغة: عربية فصحى مبسطة واضحة. إذا كتب المستخدم بالكامل بالإنجليزية أو الفرنسية فأجب بلغته.",
    "- أول جملة هي الجواب نفسه. ممنوع: الترحيب، «بالطبع»، «سؤال رائع»، المقدمات، الخاتمة، الأسئلة الختامية، الإيموجي، وذكر «البطاقة» أو «البيانات» أو «المصدر» أو «الملخص» أو حدود معرفتك.",
    "- الأسماء: اسم الشخصية بالعربية مع الاسم اللاتيني بين قوسين أول مرة فقط، مثل: فيرن (Fern).",
    "- تفاصيل محددة دائمًا: أسماء، أماكن، قدرات، أسباب، نتائج، ورقم الحلقة عند ذكر حدث مهم. لا عموميات ولا حشو.",
    "- الطول حسب السؤال: سؤال بسيط ← جملتان إلى أربع غنيّتان بالمعلومة. سؤال يحتاج شرحًا ← 3 إلى 7 نقاط مفيدة. حتى 230 كلمة إلا إذا طُلب التفصيل.",
    "- التنسيق: نص عادي. للنقاط «• » في أول السطر. ميّز اسمًا أو مصطلحًا مهمًا بـ **نجمتين** باعتدال. لا عناوين (#) ولا جداول ولا فواصل.",
    "- تابع المحادثة: استند إلى الرسائل السابقة ولا تكرر ما قيل إلا إذا طُلب.",
  ].join("\n");
}

function recapInstruction(bound: number): string {
  return bound <= 1
    ? "عرّفني بهذا العمل قبل أن أبدأ: الفكرة والعالم والشخصيات التي تظهر في الحلقة الأولى، في 4 إلى 6 نقاط تبدأ بـ «• »، دون كشف نهاية الحلقة أو أي حرق."
    : [
      `ذكّرني بما حدث قبل الحلقة ${bound}: 6 إلى 9 نقاط تبدأ كل منها بـ «• »، بالترتيب الزمني، كل نقطة حدث محدد بالأسماء مع سببه أو نتيجته.`,
      `ركّز أكثر على آخر حلقتين أو ثلاث قبل الحلقة ${bound} لأنها الأهم لمتابعة المشاهدة، واذكر أين توقفت الأحداث بالضبط.`,
      "بلا مقدمة ولا خاتمة، ودون كشف نهاية الحلقة الحالية أو أي شيء بعدها.",
    ].join(" ");
}

function spoilerReminder(bound: number): string {
  return `تذكير لك لا تكتبه: شاهدتُ حتى الحلقة ${bound} فقط. لا تذكر أي حدث أو قدرة أو تقنية أو سلاح أو شخصية أو ماضٍ أو هوية لم يظهر في البيانات حتى هذه الحلقة، حتى لو كنت تعرفه يقينًا من بقية العمل؛ قل بدلًا منه إنه لم يُكشف بعد.`;
}

/** Episodes before the bound: summaries for the last few, titles before that. */
const TIMELINE_DETAILED = 10;
const TIMELINE_TITLES = 60;

function buildContextMessage(p: {
  animeTitle: string;
  altTitle: string;
  seasonNumber: number | undefined;
  epNum: number;
  episodeTitle: string;
  totalEpisodes: number | undefined;
  spoilerBound: number;
  today: string;
  g: Partial<Grounding>;
}): string {
  const { g } = p;
  const lines: string[] = ["بطاقة العمل", `الأنمي: ${p.animeTitle}`];
  const official = [g.enTitle, g.romaji, p.altTitle]
    .filter((t, i, a): t is string => !!t && a.findIndex((x) => x?.toLowerCase() === t.toLowerCase()) === i);
  if (official.length) lines.push(`الاسم الرسمي: ${official.join(" / ")}`);
  if (p.seasonNumber) {
    lines.push(`الموسم/الجزء: ${p.seasonNumber} — أحداث هذا الجزء فقط، ولا تخلطها بموسم آخر.`);
  }
  if (g.status) lines.push(`${g.status} — المستخدم يشاهده الآن فهو صادر بالتأكيد.`);
  if (p.totalEpisodes !== undefined) lines.push(`عدد الحلقات الكلي: ${p.totalEpisodes}`);
  lines.push(`تاريخ اليوم: ${p.today}`);
  if (g.premise) lines.push(`فكرة هذا الجزء: ${g.premise}`);
  if (g.mainCast?.length) {
    lines.push(
      `الشخصيات الرئيسية (للتهجئة الصحيحة فقط؛ لا تذكر منها من لم يظهر حتى الحلقة ${p.spoilerBound}): ${g.mainCast.join("، ")}`,
    );
  }

  const timeline = (g.timeline ?? []).filter((e) => e.n < p.spoilerBound);
  if (timeline.length) {
    lines.push("", `ما حدث حتى الآن (بيانات حقيقية مرتبة زمنيًا، تتوقف قبل الحلقة ${p.spoilerBound}):`);
    const detailed = timeline.slice(-TIMELINE_DETAILED);
    const titled = timeline.slice(0, -TIMELINE_DETAILED).slice(-TIMELINE_TITLES).filter((e) => e.title);
    if (titled.length) {
      lines.push("عناوين حلقات سابقة: " + titled.map((e) => `${e.n}) ${e.title}`).join(" · "));
    }
    for (const e of detailed) {
      const head = `• الحلقة ${e.n}${e.title ? ` «${e.title}»` : ""}`;
      lines.push(e.summary ? `${head}: ${e.summary.length > 420 ? e.summary.slice(0, 420) + "…" : e.summary}` : head);
    }
  } else if (p.spoilerBound > 1) {
    lines.push(
      "",
      `لا تتوفر بيانات الحلقات السابقة: حدّد بصمت القوس (arc) الذي تقع فيه الحلقة ${p.spoilerBound} واعتمد على معرفتك بحذر شديد دون تجاوزه.`,
    );
  }

  const cur = g.current;
  const curTitle = cur?.title || p.episodeTitle;
  lines.push("", `الحلقة الحالية: ${p.epNum}${curTitle ? ` «${curTitle}»` : ""}`);
  if (cur?.summary) lines.push(`ملخصها (قد يكون المستخدم في منتصفها): ${cur.summary}`);
  lines.push("", `حد الحرق: لا شيء بعد الحلقة ${p.spoilerBound} مهما حدث.`);
  return lines.join("\n");
}

// Models that rejected reasoning_effort:"none" (Flash-Lite answers 400) —
// remembered so they're called without it from then on.
const noReasoningParam = new Set<string>();
// Cooldowns are per key+model: each key (from its own project) has its own
// quota per model, so one exhausted pair says nothing about the others.
const keyModelCooldownUntil = new Map<string, number>();
// A key the provider rejects as invalid/revoked is benched for every model.
const badKeyUntil = new Map<number, number>();
const BAD_KEY_COOLDOWN_MS = 6 * 60 * 60 * 1000;
// Round-robin start point per model, so load (and per-minute limits) spreads
// across all keys instead of draining the first one.
const keyCursor = new Map<string, number>();

const cooldownId = (keyIdx: number, model: string) => `${keyIdx}|${model}`;

function keyReady(keyIdx: number, model: string, now: number): boolean {
  return (badKeyUntil.get(keyIdx) ?? 0) <= now &&
    (keyModelCooldownUntil.get(cooldownId(keyIdx, model)) ?? 0) <= now;
}

type AIResult =
  | { ok: true; content: string; truncated: boolean }
  // cooldownMs: quota hit (try another key). badKey: key rejected outright.
  | { ok: false; status: number; cooldownMs?: number; badKey?: boolean };

/**
 * One provider call. Never throws: network/abort/non-2xx/empty/invalid all
 * come back as { ok: false } so the race just waits for another model.
 */
async function callAI(
  base: string,
  key: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  signal: AbortSignal,
): Promise<AIResult> {
  const send = (withReasoning: boolean) =>
    fetch(`${base.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: AI_TEMPERATURE,
        max_tokens: AI_MAX_TOKENS,
        // Thinking off: it cost 10-20s per answer and could eat the whole
        // token budget (empty reply). The system prompt carries the reasoning
        // steps instead.
        ...(withReasoning ? { reasoning_effort: "none" } : {}),
      }),
      signal,
    });
  try {
    let withReasoning = !noReasoningParam.has(model);
    let upstream = await send(withReasoning);
    if (upstream.status === 400 && withReasoning) {
      await upstream.text().catch(() => "");
      noReasoningParam.add(model);
      withReasoning = false;
      upstream = await send(false);
    }
    if (!upstream.ok) {
      // Log the provider status/body for debugging but never leak it to the client.
      const detail = await upstream.text().catch(() => "");
      console.error("AI upstream error", model, upstream.status, detail.slice(0, 300));
      if (upstream.status === 429 || upstream.status === 503) {
        // Gemini says which quota tripped: a per-day one won't recover for
        // hours; a per-minute one carries its own retryDelay.
        const retrySec = parseInt(detail.match(/"retryDelay"\s*:\s*"(\d+)/)?.[1] ?? "", 10);
        const ms = /PerDay/i.test(detail)
          ? MODEL_DAILY_COOLDOWN_MS
          : Number.isFinite(retrySec) && retrySec > 0
          ? Math.min(retrySec * 1000, MODEL_DAILY_COOLDOWN_MS)
          : MODEL_COOLDOWN_MS;
        return { ok: false, status: upstream.status, cooldownMs: ms };
      }
      // Newer keys can't use some older models ("no longer available to new
      // users") while older keys still can: bench just this key+model pair.
      if (upstream.status === 404) {
        return { ok: false, status: 404, cooldownMs: BAD_KEY_COOLDOWN_MS };
      }
      if (upstream.status === 401 || upstream.status === 403 || /API_KEY_INVALID|API key not valid/i.test(detail)) {
        return { ok: false, status: upstream.status, badKey: true };
      }
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
      console.error("AI response empty", model, finish, JSON.stringify(data)?.slice(0, 300));
      return { ok: false, status: 502 };
    }
    return { ok: true, content: content.trim(), truncated };
  } catch (e) {
    if (!signal.aborted) console.error("AI fetch failed", model, e);
    return { ok: false, status: 502 };
  }
}

/**
 * One model, every key: tries the keys round-robin (ready ones first) and
 * moves straight to the next key when one is out of quota or invalid, so a
 * single race slot keeps going until a key answers or all are spent. Other
 * failures (timeout, 5xx, empty reply) end the slot — another key won't fix
 * those, and the race already has other models for them.
 */
async function callModel(
  base: string,
  keys: string[],
  model: string,
  messages: Array<{ role: string; content: string }>,
  signal: AbortSignal,
): Promise<AIResult> {
  const now = Date.now();
  const start = (keyCursor.get(model) ?? 0) % keys.length;
  keyCursor.set(model, start + 1);
  const rotated = keys.map((_, i) => (start + i) % keys.length);
  const order = [
    ...rotated.filter((k) => keyReady(k, model, now)),
    ...rotated.filter((k) => !keyReady(k, model, now)),
  ];

  let last: AIResult = { ok: false, status: 502 };
  for (const k of order) {
    if (signal.aborted) break;
    last = await callAI(base, keys[k], model, messages, signal);
    if (last.ok) return last;
    if (last.badKey) {
      console.error("AI key rejected", `key#${k + 1}`, last.status);
      badKeyUntil.set(k, Date.now() + BAD_KEY_COOLDOWN_MS);
      continue;
    }
    if (last.cooldownMs) {
      console.log("AI quota hit", model, `key#${k + 1}`, `${Math.round(last.cooldownMs / 1000)}s`);
      keyModelCooldownUntil.set(cooldownId(k, model), Date.now() + last.cooldownMs);
      continue;
    }
    break;
  }
  return last;
}

/** Tidy model output for a plain-text chat bubble. */
function polishAnswer(raw: string, truncated: boolean): string {
  let text = raw
    .replace(/\r/g, "")
    // Headings / rules / tables the prompt forbids but models still emit.
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, "")
    // Markdown bullets → the bubble's "• " style.
    .replace(/^\s*[-*+]\s+/gm, "• ")
    // Stray glyphs from other scripts that Gemini splices into Arabic words
    // (seen: "زولტრاك", "كوجيسากي", "ساтору", "فوشيغuro"): Georgian, Thai,
    // Cyrillic, Armenian never belong in an answer; Latin glued directly to
    // Arabic letters is the same glitch (real romaji sits in parentheses).
    .replace(/[Ѐ-ӿ԰-֏฀-๿Ⴀ-ჿ]+/g, "")
    .replace(/([ء-ي])[A-Za-z]+/g, "$1")
    .replace(/[A-Za-z]+([ء-ي])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  // Small models still open with pleasantries despite the prompt.
  text = text
    .replace(/^(?:أهلًا|أهلاً|مرحبًا|مرحباً|بالطبع|بكل سرور|سؤال رائع|سؤال جميل)[^\n.!؟:]*[.!؟:]?\s*/u, "")
    .replace(/^(?:إليك|بناءً على|بناء على)[^\n:]{0,80}:\s*\n?/u, "")
    .trim();
  if (truncated) {
    // Cut a mid-sentence ending back to the last complete sentence/line.
    const cut = Math.max(text.lastIndexOf("\n"), text.lastIndexOf("."), text.lastIndexOf("؟"), text.lastIndexOf("!"));
    if (cut > text.length * 0.5) text = text.slice(0, cut + 1).trim();
  }
  return text || raw.trim();
}

/**
 * Hedged race across the model chain. Model i starts at HEDGE_DELAYS_MS[i]
 * — or immediately once every model already started has failed — and the
 * first non-empty answer wins (losers aborted). Models cooling down after a
 * 429/503 go to the back of the line instead of wasting the head start.
 */
async function raceModels(
  base: string,
  keys: string[],
  chain: string[],
  messages: Array<{ role: string; content: string }>,
  opts: { raw?: boolean } = {},
): Promise<string | null> {
  const now = Date.now();
  // A model is ready while at least one key still has quota for it.
  const hasKey = (m: string) => keys.some((_, k) => keyReady(k, m, now));
  const ready = chain.filter(hasKey);
  const cooling = chain.filter((m) => !hasKey(m));
  const order = [...ready, ...cooling];
  if (!order.length) return null;

  const abort = new AbortController();
  const hardStop = setTimeout(() => abort.abort(), AI_BUDGET_MS);
  const timers: number[] = [];

  return await new Promise<string | null>((resolve) => {
    let started = 0;
    let failed = 0;
    let done = false;
    let partial: string | null = null;

    const finish = (answer: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(hardStop);
      timers.forEach((t) => clearTimeout(t));
      abort.abort();
      resolve(answer);
    };
    abort.signal.addEventListener("abort", () => finish(partial));

    const launch = (i: number) => {
      if (done || i < started || i >= order.length) return;
      started = i + 1;
      const model = order[i];
      const t0 = Date.now();
      callModel(base, keys, model, messages, abort.signal).then((res) => {
        if (done) return;
        if (res.ok) {
          console.log("AI answered", model, `${Date.now() - t0}ms`, res.truncated ? "truncated" : "");
          // JSON modes (search/bridge) must not go through the chat polish —
          // it strips Latin glued to Arabic, which would corrupt titles.
          const text = opts.raw ? res.content.trim() : polishAnswer(res.content, res.truncated);
          // A cut-off answer is kept as a fallback, but a complete one from a
          // model still running is preferred.
          if (!res.truncated) return finish(text);
          partial = partial ?? text;
        }
        failed++;
        if (started < order.length) launch(started); // a slot freed up — don't wait
        else if (failed >= started) finish(partial);
      });
    };

    launch(0);
    for (let i = 1; i < order.length; i++) {
      const delay = HEDGE_DELAYS_MS[Math.min(i, HEDGE_DELAYS_MS.length - 1)];
      timers.push(setTimeout(() => launch(i), delay));
    }
  });
}

/* ── Answer cache ───────────────────────────────────────────────────────
   Recaps and first questions (no history) are identical for every viewer of
   the same episode, so a warm isolate answers repeats instantly and saves
   provider quota. */
const answerCache = new Map<string, { answer: string; at: number }>();
const ANSWER_TTL_MS = 6 * 60 * 60 * 1000;
const ANSWER_CACHE_MAX = 400;

function cacheGet(key: string): string | null {
  const hit = answerCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > ANSWER_TTL_MS) {
    answerCache.delete(key);
    return null;
  }
  return hit.answer;
}

function cacheSet(key: string, answer: string) {
  if (answerCache.size >= ANSWER_CACHE_MAX) {
    const oldest = answerCache.keys().next().value;
    if (oldest !== undefined) answerCache.delete(oldest);
  }
  answerCache.set(key, { answer, at: Date.now() });
}

/* ── JSON-mode helpers (search / bridge) ─────────────────────────────── */

/** Pull the first JSON object/array out of a model reply (tolerates code
 *  fences and stray prose around it). */
function extractJson(raw: string): any | null {
  const s = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = s.search(/[\[{]/);
  if (start < 0) return null;
  const close = s[start] === "{" ? "}" : "]";
  const end = s.lastIndexOf(close);
  if (end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}

const cleanText = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";

const cleanNum = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 10) / 10 : null;
};

type AIContext = {
  aiBase: string;
  aiKeys: string[];
  models: string[];
  // deno-lint-ignore no-explicit-any
  db: any;
  userId: string;
};

/* ── Mode: "search" — natural-language anime discovery ─────────────────
   The model turns a free-form request (any dialect) into real titles; the
   client resolves them on AniList and opens them through the normal
   title→source resolution. Answers are shared through ai_search_cache so a
   repeated phrase costs no provider quota. */
const SEARCH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function searchCacheKey(q: string): string {
  return q
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[ً-ٕـ]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\s؟?!.،,:;"'«»()\[\]{}\-_/\\]+/g, " ")
    .trim()
    .slice(0, 300);
}

function searchSystemPrompt(today: string): string {
  return [
    "أنت خبير ترشيحات أنمي دقيق. يصف المستخدم ما يريد مشاهدته بأي لهجة عربية (جزائرية، مغربية، مصرية، خليجية، شامية، فصحى) أو بالإنجليزية أو الفرنسية أو بحروف لاتينية.",
    "مهمتك: فهم طلبه بدقة واقتراح أعمال أنمي حقيقية تطابقه.",
    "",
    "القواعد:",
    "- اقترح 10 أعمال أنمي حقيقية موجودة فعلًا (مسلسلات أو أفلام). ممنوع اختراع عناوين.",
    "- title: الاسم الرسمي كما على AniList أو MyAnimeList (روماجي أو إنجليزي)، بلا رقم موسم إلا إذا طُلب موسم بعينه.",
    "- إن ذكر عملًا كمثال («زي هجوم العمالقة») فلا تضعه في النتائج إلا إذا طلبه هو نفسه.",
    "- احترم كل القيود: الطول (قصير = 26 حلقة أو أقل، فيلم)، الحالة (مكتمل/مستمر)، التصنيف، الحقبة، المزاج، الجمهور، الدبلجة.",
    "- إن كان الطلب اسم عمل محدد (حتى لو بتهجئة خاطئة أو بالعربية) فضعه أولًا ثم أعمالًا مشابهة.",
    "- رتّب من الأنسب إلى الأقل، وفضّل الأعمال الأعلى تقييمًا عند التساوي.",
    "- ممنوع تمامًا أي محتوى إباحي أو hentai أو ecchi صريح.",
    "- reason: سبب واحد قصير بالعربية (حتى 14 كلمة) يوضح لماذا يطابق الطلب، بلا حرق.",
    "- intent: إعادة صياغة قصيرة جدًا بالعربية لما فهمته (حتى 10 كلمات).",
    `- تاريخ اليوم: ${today}.`,
    "",
    "أجب بـ JSON فقط، بلا أي نص قبله أو بعده:",
    '{"intent":"...","results":[{"title":"...","reason":"..."}]}',
    'إن لم يكن الطلب عن الأنمي أصلًا: {"intent":"","results":[]}',
  ].join("\n");
}

/** Max "show more" pages (10 titles each) per query. */
const SEARCH_MAX_PAGE = 5;

async function handleSearch(
  ctx: AIContext,
  rawQuery: unknown,
  today: string,
  rawPage?: unknown,
  rawExclude?: unknown,
): Promise<Response> {
  const query = cleanText(rawQuery, 300);
  if (query.length < 2) return err(400, "invalid_request");
  const baseKey = searchCacheKey(query);
  if (!baseKey) return err(400, "invalid_request");
  // "Show more": page N asks for 10 NEW titles, excluding everything the
  // client already shows. Page 1 keeps the original cache key so old clients
  // and old cache rows still match.
  const page = Math.min(SEARCH_MAX_PAGE, Math.max(1, Math.floor(Number(rawPage) || 1)));
  const exclude = page > 1 && Array.isArray(rawExclude)
    ? rawExclude.map((t) => cleanText(t, 120)).filter((t) => t.length >= 2).slice(0, 60)
    : [];
  const key = page > 1 ? `${baseKey}|p${page}` : baseKey;

  try {
    const { data: hit } = await ctx.db
      .from("ai_search_cache")
      .select("payload, created_at")
      .eq("query_key", key)
      .maybeSingle();
    if (hit?.payload && Date.now() - Date.parse(hit.created_at) < SEARCH_TTL_MS) {
      return json(200, { ok: true, cached: true, ...hit.payload });
    }
  } catch (e) {
    console.error("search cache read failed", e);
  }

  if (isRateLimited(ctx.userId)) return err(429, "rate_limited");

  const answer = await raceModels(ctx.aiBase, ctx.aiKeys, ctx.models, [
    { role: "system", content: searchSystemPrompt(today) },
    {
      role: "user",
      content: exclude.length
        ? [
          query,
          "",
          "هذه الأعمال اقتُرحت بالفعل، لا تكرر أيًّا منها ولا مواسمها الأخرى؛ اقترح 10 أعمال جديدة مختلفة تطابق نفس الطلب:",
          ...exclude,
        ].join("\n")
        : query,
    },
  ], { raw: true });
  if (!answer) return err(502, "upstream");

  const parsed = extractJson(answer);
  const seen = new Set<string>(exclude.map((t) => t.toLowerCase()));
  const results: { title: string; reason: string }[] = [];
  for (const r of Array.isArray(parsed?.results) ? parsed.results : []) {
    const title = cleanText(r?.title, 120);
    const k = title.toLowerCase();
    if (title.length < 2 || seen.has(k)) continue;
    seen.add(k);
    results.push({ title, reason: cleanText(r?.reason, 160) });
    if (results.length >= 10) break;
  }
  const payload = { intent: cleanText(parsed?.intent, 120), results };
  if (results.length) {
    const { error } = await ctx.db
      .from("ai_search_cache")
      .upsert({ query_key: key, payload, created_at: new Date().toISOString() });
    if (error) console.error("search cache write failed", error.message);
  }
  return json(200, { ok: true, ...payload });
}

/* ── Mode: "bridge" — where the anime ends in its source manga ─────────
   AniList pins the exact source work (title, format, chapter count) so the
   model only has to answer "which chapters does THIS season adapt". The
   result is stored in manga_bridge for every device; airing shows refresh
   every few days because the adapted range grows weekly. Community votes
   (manga_bridge_votes) can override the AI's chapter on the client. */
const BRIDGE_AIRING_TTL_MS = 4 * 24 * 60 * 60 * 1000;

const ANILIST_BRIDGE_QUERY = `query($s:String){Page(perPage:6){media(search:$s,type:ANIME,sort:SEARCH_MATCH){
  id status episodes format seasonYear source(version:3)
  nextAiringEpisode{episode}
  title{romaji english}
  relations{edges{relationType(version:2) node{id type format status chapters volumes title{romaji english native} synonyms}}}
}}}`;

type BridgeMedia = {
  id: number;
  status?: string | null;
  episodes?: number | null;
  format?: string | null;
  seasonYear?: number | null;
  source?: string | null;
  nextAiringEpisode?: { episode?: number | null } | null;
  title?: { romaji?: string | null; english?: string | null } | null;
  relations?: {
    edges?: Array<{
      relationType?: string | null;
      node?: {
        id: number;
        type?: string | null;
        format?: string | null;
        status?: string | null;
        chapters?: number | null;
        volumes?: number | null;
        title?: { romaji?: string | null; english?: string | null; native?: string | null } | null;
        synonyms?: string[] | null;
      } | null;
    }> | null;
  } | null;
};

async function aniListBridgeLookup(titles: string[]): Promise<BridgeMedia | null> {
  for (const s of titles) {
    if (!s) continue;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: ANILIST_BRIDGE_QUERY, variables: { s } }),
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));
      if (!res.ok) continue;
      const j = await res.json();
      const list: BridgeMedia[] = j?.data?.Page?.media ?? [];
      // Skip music videos / specials that sometimes outrank the TV entry.
      const pick = list.find((m) => m.format !== "MUSIC" && m.format !== "SPECIAL") ?? list[0];
      if (pick) return pick;
    } catch (e) {
      console.error("anilist bridge lookup failed", e);
    }
  }
  return null;
}

function bridgeSourceKind(source: string | null | undefined, nodeFormat: string | null | undefined): string {
  const s = (source || "").toUpperCase();
  if (s === "ORIGINAL") return "original";
  if (s === "LIGHT_NOVEL" || (nodeFormat === "NOVEL" && s !== "MANGA" && s !== "WEB_MANGA")) return "light_novel";
  if (s === "WEB_NOVEL" || s === "NOVEL") return "web_novel";
  if (s === "MANGA" || s === "WEB_MANGA" || s === "DOUJINSHI" || nodeFormat === "MANGA" || nodeFormat === "ONE_SHOT") {
    return "manga";
  }
  if (s === "VIDEO_GAME" || s === "VISUAL_NOVEL" || s === "GAME") return "game";
  return s ? "other" : "manga";
}

async function handleBridge(
  ctx: AIContext,
  body: Record<string, unknown>,
): Promise<Response> {
  const animeKey = cleanText(body?.animeKey, 300);
  const animeTitle = cleanText(body?.animeTitle, 200);
  const altTitle = cleanText(body?.altTitle, 120);
  const seasonNumber = cleanNum(body?.seasonNumber, 1, 50);
  const totalEpisodes = cleanNum(body?.totalEpisodes, 1, 5000);
  const force = body?.force === true;
  if (!animeKey || !animeTitle) return err(400, "invalid_request");

  try {
    const { data: row } = await ctx.db
      .from("manga_bridge")
      .select("payload, updated_at")
      .eq("anime_key", animeKey)
      .maybeSingle();
    const age = row ? Date.now() - Date.parse(row.updated_at) : Infinity;
    const fresh = row?.payload && (!row.payload.airing || age < BRIDGE_AIRING_TTL_MS);
    if (fresh && !force) return json(200, { ok: true, cached: true, payload: row.payload });
    // A forced refresh (stale airing show) is still throttled per anime.
    if (row?.payload && force && age < 6 * 60 * 60 * 1000) {
      return json(200, { ok: true, cached: true, payload: row.payload });
    }
  } catch (e) {
    console.error("bridge cache read failed", e);
  }

  if (isRateLimited(ctx.userId)) return err(429, "rate_limited");

  const seasonHint = seasonNumber && seasonNumber > 1 ? [`${altTitle || animeTitle} Season ${seasonNumber}`] : [];
  const media = await aniListBridgeLookup([...seasonHint, altTitle, animeTitle]);
  const edges = media?.relations?.edges ?? [];
  const sourceEdge =
    edges.find((e) => e.relationType === "SOURCE" && e.node?.type === "MANGA") ??
    edges.find((e) => e.relationType === "ADAPTATION" && e.node?.type === "MANGA" && e.node?.format !== "NOVEL");
  const node = sourceEdge?.node ?? null;
  const kind = bridgeSourceKind(media?.source, node?.format);
  const airing = media?.status === "RELEASING";
  const airedEpisodes = airing && media?.nextAiringEpisode?.episode
    ? Math.max(0, media.nextAiringEpisode.episode - 1)
    : media?.episodes ?? totalEpisodes ?? null;

  const base = {
    source: kind,
    anilistAnimeId: media?.id ?? null,
    anilistMangaId: node?.id ?? null,
    mangaTitle: node?.title?.romaji || node?.title?.english || "",
    mangaTitleEnglish: node?.title?.english || "",
    mangaTitleNative: node?.title?.native || "",
    mangaSynonyms: (node?.synonyms ?? []).filter((s) => typeof s === "string" && s.length <= 120).slice(0, 8),
    mangaFormat: node?.format ?? null,
    mangaChapters: node?.chapters ?? null,
    mangaVolumes: node?.volumes ?? null,
    mangaStatus: node?.status ?? null,
    airing,
  };

  let payload: Record<string, unknown> = {
    ...base,
    startChapter: null,
    endChapter: null,
    endVolume: null,
    confidence: "low",
    note: "",
  };

  // Original / game adaptations have no chapter to continue from: store the
  // fact (so nobody asks the AI again) without a model call.
  if (kind !== "original" && kind !== "game") {
    const animeName = media?.title?.romaji || altTitle || animeTitle;
    const sourceName = base.mangaTitle || base.mangaTitleEnglish || animeName;
    const isNovel = kind === "light_novel" || kind === "web_novel";
    const prompt = [
      `Anime entry: "${animeName}"${media?.title?.english ? ` (English: "${media.title.english}")` : ""}.`,
      `Format: ${media?.format ?? "TV"}, year ${media?.seasonYear ?? "?"}, ${media?.episodes ?? totalEpisodes ?? "?"} episodes, status ${media?.status ?? "?"}.`,
      seasonNumber ? `This is season/part ${seasonNumber} of its franchise.` : "",
      airing ? `It is still airing; ${airedEpisodes ?? "?"} episodes have aired so far.` : "",
      `Source material: "${sourceName}" (${isNovel ? "novel" : "manga"}${base.mangaChapters ? `, ${base.mangaChapters} chapters` : ""}${base.mangaVolumes ? `, ${base.mangaVolumes} volumes` : ""}${base.mangaStatus ? `, ${base.mangaStatus}` : ""}).`,
      "",
      `Question: which part of the source does THIS anime entry adapt (only this season/part, not the whole franchise)?${airing ? " For an airing show, answer for the episodes aired so far." : ""}`,
      isNovel
        ? "Give the first and last chapter of the MANGA adaptation if one exists (else null), and the last NOVEL volume adapted."
        : "Give the first and last manga chapter adapted, and the last volume.",
      "Use exact, well-known adaptation data. If you are not certain, set confidence to \"low\" — never guess wildly.",
      'Reply with JSON only: {"startChapter": number|null, "endChapter": number|null, "endVolume": number|null, "confidence": "high"|"medium"|"low", "note": "one short Arabic sentence about where to continue reading, NO plot spoilers"}',
    ].filter(Boolean).join("\n");

    const answer = await raceModels(ctx.aiBase, ctx.aiKeys, ctx.models, [
      { role: "system", content: "You are a precise anime/manga adaptation database. You answer only with JSON." },
      { role: "user", content: prompt },
    ], { raw: true });
    if (!answer) return err(502, "upstream");
    const parsed = extractJson(answer) ?? {};
    let start = cleanNum(parsed.startChapter, 0, 9999);
    let end = cleanNum(parsed.endChapter, 0.5, 9999);
    const vol = cleanNum(parsed.endVolume, 0.5, 999);
    let confidence = ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "low";
    if (start != null && end != null && start > end) [start, end] = [end, start];
    // A chapter beyond what the manga has published is impossible.
    if (end != null && base.mangaChapters && end > base.mangaChapters + 3) confidence = "low";
    if (end == null && vol == null) confidence = "low";
    payload = {
      ...base,
      startChapter: start,
      endChapter: end,
      endVolume: vol,
      confidence,
      note: cleanText(parsed.note, 220),
    };
  } else {
    payload.confidence = "high";
  }

  const { error } = await ctx.db.from("manga_bridge").upsert({
    anime_key: animeKey,
    anime_title: animeTitle,
    payload,
    updated_at: new Date().toISOString(),
  });
  if (error) console.error("bridge cache write failed", error.message);
  return json(200, { ok: true, payload });
}

/* ── Persistent recap cache ────────────────────────────────────────────
   A recap is identical for every viewer of the same episode; persisting it
   means each recap costs provider quota exactly once, across all isolates. */
const RECAP_DB_TTL_MS = 45 * 24 * 60 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  const startedAt = Date.now();

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Verify the JWT manually (in addition to the platform's JWT gate) so we get
  // a userId for the rate limit and never trust an unauthenticated caller.
  // Started now, awaited before any AI call: it overlaps body parsing and the
  // grounding lookups instead of adding a round-trip in front of them.
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const userIdPromise: Promise<string | null> = jwt
    ? supabase.auth.getUser(jwt).then(({ data }) => data?.user?.id ?? null, () => null)
    : Promise.resolve(null);

  const aiBase = Deno.env.get("AI_BASE_URL");
  // AI_API_KEYS (comma-separated) enables key rotation; AI_API_KEY still works
  // alone. Both may be set — the single key just joins the pool.
  const aiKeys = [...(Deno.env.get("AI_API_KEYS") || "").split(","), Deno.env.get("AI_API_KEY") || ""]
    .map((k) => k.trim())
    .filter((k, i, a) => k && a.indexOf(k) === i);
  const aiModel = Deno.env.get("AI_MODEL") || "";
  const fallbackModel = Deno.env.get("AI_MODEL_FALLBACK") || "";
  const fallbackModel2 = Deno.env.get("AI_MODEL_FALLBACK2") || "";
  if (!aiBase || !aiKeys.length || (!aiModel && !fallbackModel && !fallbackModel2 && !Deno.env.get("AI_MODELS"))) {
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

  // JSON modes: no episode context, no grounding.
  if (mode === "search" || mode === "bridge") {
    const userId = await userIdPromise;
    if (!userId) return err(401, "unauthenticated");
    const chainEnvJ = (Deno.env.get("AI_MODELS") || "").split(",");
    const modelsJ = (chainEnvJ.some((m) => m.trim()) ? chainEnvJ : [aiModel, fallbackModel, fallbackModel2])
      .map((m) => m.trim())
      .filter((m, i, a) => m && a.indexOf(m) === i);
    const ctx: AIContext = { aiBase, aiKeys, models: modelsJ, db: supabase, userId };
    const raw = body as Record<string, unknown>;
    return mode === "search"
      ? await handleSearch(ctx, raw.query, new Date().toISOString().slice(0, 10), raw.page, raw.exclude)
      : await handleBridge(ctx, raw);
  }

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
      // The companion's own answers are kept longer so a follow-up ("explain
      // more", "and the second one?") still sees what was said.
      const content = text.trim().slice(0, role === "ai" ? 1200 : 500);
      if (!content) continue;
      history.push({ role: role === "ai" ? "assistant" : "user", content });
    }
  }

  // AI_MODELS (comma-separated, best first) overrides the legacy 3-var chain.
  // On the free tier every model has its own daily quota, so a longer chain of
  // distinct models multiplies capacity.
  const chainEnv = (Deno.env.get("AI_MODELS") || "").split(",");
  const models = (chainEnv.some((m) => m.trim()) ? chainEnv : [aiModel, fallbackModel, fallbackModel2])
    .map((m) => m.trim())
    .filter((m, i, a) => m && a.indexOf(m) === i);
  const today = new Date().toISOString().slice(0, 10);

  // Real-data grounding (see grounding.ts) starts now, in parallel with auth;
  // late results still warm the caches for the next question.
  const ground: Partial<Grounding> = {};
  const grounding = fetchGrounding([altTitle, animeTitle], epNum, seasonNumber ?? 0, ground)
    .catch((e) => console.error("grounding failed", e));

  const userId = await userIdPromise;
  if (!userId) return err(401, "unauthenticated");

  // Same episode + same opening question (or a recap) → same answer for every
  // viewer. Served before the rate limit: it costs no provider quota.
  const cacheKey = history.length === 0
    ? [
      "v2", mode, animeTitle.toLowerCase(), altTitle.toLowerCase(), seasonNumber ?? 0, epNum,
      question.toLowerCase().replace(/[\s؟?!.،,]+/g, " ").trim(),
    ].join("|")
    : null;
  const cached = cacheKey ? cacheGet(cacheKey) : null;
  if (cached) return json(200, { ok: true, answer: cached, spoilerBound });

  // Recaps are shared across isolates (and days) through the database.
  if (mode === "recap" && cacheKey) {
    try {
      const { data: hit } = await supabase
        .from("ai_recap_cache")
        .select("answer, created_at")
        .eq("cache_key", cacheKey)
        .maybeSingle();
      if (hit?.answer && Date.now() - Date.parse(hit.created_at) < RECAP_DB_TTL_MS) {
        cacheSet(cacheKey, hit.answer);
        return json(200, { ok: true, answer: hit.answer, spoilerBound, cached: true });
      }
    } catch (e) {
      console.error("recap cache read failed", e);
    }
  }

  // Rate-limit AFTER validation so malformed payloads can't lock a user out.
  if (isRateLimited(userId)) return err(429, "rate_limited");

  const waitMs = GROUND_BUDGET_MS - (Date.now() - startedAt);
  if (waitMs > 0) await Promise.race([grounding, new Promise((r) => setTimeout(r, waitMs))]);
  console.log(
    "grounding",
    JSON.stringify({
      title: ground.enTitle ?? null,
      current: !!ground.current?.summary,
      timeline: ground.timeline?.length ?? 0,
      ms: Date.now() - startedAt,
    }),
  );
  const contextMessage = buildContextMessage({
    animeTitle,
    altTitle,
    seasonNumber,
    epNum,
    episodeTitle,
    totalEpisodes,
    spoilerBound,
    today,
    g: ground,
  });
  const messages = [
    { role: "system", content: `${systemPrompt(spoilerBound)}

${contextMessage}` },
    ...history,
    {
      role: "user",
      content: mode === "recap"
        ? recapInstruction(spoilerBound)
        // Restated next to the question: buried in the system message, the
        // spoiler rule lost to what the model "knows" (abilities shown only
        // in later fights leaked into "what can X do?").
        : `${question}\n\n[${spoilerReminder(spoilerBound)}]`,
    },
  ];

  const answer = await raceModels(aiBase, aiKeys, models, messages);
  if (!answer) return err(502, "upstream");
  if (cacheKey) cacheSet(cacheKey, answer);
  if (mode === "recap" && cacheKey) {
    const { error } = await supabase
      .from("ai_recap_cache")
      .upsert({ cache_key: cacheKey, answer, created_at: new Date().toISOString() });
    if (error) console.error("recap cache write failed", error.message);
  }

  return json(200, { ok: true, answer, spoilerBound });
});

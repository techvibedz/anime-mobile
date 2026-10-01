import assert from "node:assert";
import { shouldShowSynopsis, synopsisForDisplay, cleanSynopsis } from "./animeDetail";

assert.equal(shouldShowSynopsis("https://anime3rb.com/titles/one-piece", "Real synopsis"), true);
assert.equal(shouldShowSynopsis("https://witanime.cyou/anime/one-piece", "Real synopsis"), true);
assert.equal(shouldShowSynopsis("https://anime4up.cam/anime/one-piece", "Real synopsis"), true);
assert.equal(shouldShowSynopsis("https://witanime.you/anime/one-piece", ""), false);

const top = "هذه هي القصة الحقيقية التي يجب أن تبقى ظاهرة للمستخدم.";
assert.equal(synopsisForDisplay(`${top}\n\nأسماء أخرى: اسم طويل ووصف غير مرغوب`), top);
assert.equal(synopsisForDisplay(`${top}\n\nالتقييم: 8.4 12 حلقات وصف طويل غير مرغوب`), top);
assert.equal(synopsisForDisplay(`${top} ${top}`), top);
assert.equal(synopsisForDisplay(top), top);

// anime3rb's og:description SEO chain (real structure, captured live). After
// the boilerplate markers are stripped, the alt-name residue used to survive
// as "One Piece. ONE PIECE. OP. عمك. وان بيس…" and showed up as a junk wall on
// the detail page. It must collapse to "" so the block hides entirely.
const JUNK_CHAIN =
  "مشاهدة و تحميل One Piece - One Piece - ONE PIECE - OP - عمك - وان بيس - القطعة الواحدة - القطعة النادرة - ون بيس اون لاين بجودات متعددة - أنميات خريف 1999 - Anime3rb أنمي عرب";
assert.equal(cleanSynopsis(JUNK_CHAIN), "");

// A real story sharing the page with promotion text survives intact.
const realStory = "قصة أنمي ملحمية عن أبطال شجعان يواجهون مصاعب كبيرة ويصنعون المستحيل";
assert.equal(cleanSynopsis(`مشاهدة وتحميل اون لاين - ${realStory}`), realStory);

// Real stories without any junk markers pass through untouched.
const plain = "يبدأ لوفي رحلته بحثًا عن الكنز الأسطوري وسط بحار مليئة بالقراصنة والمخاطر.";
assert.equal(cleanSynopsis(plain), plain);

// Garbage inputs stay empty.
assert.equal(cleanSynopsis(""), "");
assert.equal(cleanSynopsis(null), "");

// anime4up stubs (captured live): the story slot holds a season tag or a name
// wall instead of a plot. They must collapse to "" so the block hides.
assert.equal(
  cleanSynopsis("الموسم الثالث من Mushoku Tensei: Isekai Ittara Honki Dasu."),
  "",
);
assert.equal(
  cleanSynopsis(
    "قصة انمي بليتش Bleach: Sennen Kessen-hen – Kashin-tan الجزء الرابع والأخير من BLEACH: Sennen Kessen-hen.",
  ),
  "",
);

// Real anime4up story prefixed with the "قصة انمي <title>" label keeps the
// prose with the label removed.
const up4Real =
  "قصة انمي Sakura-sou no Pet na Kanojo في ثانوية 'سومي'، يشتهر سكن 'ساكورا' بأنه المكان الذي يجتمع فيه أكثر طلاب المدرسة غرابة وإثارة للمشاكل.";
assert.equal(cleanSynopsis(up4Real).startsWith("Sakura-sou"), true);

// anime4up SEO lead glued to a real story gets cut, the story stays.
const up4Lead =
  "مشاهدة جميع حلقات انمي Liar Game مترجمة اون لاين. تدور قصة الانمي حول ناو كانزاكي، طالبة جامعية معروفة بصدقها الشديد.";
assert.equal(cleanSynopsis(up4Lead).startsWith("تدور"), true);

// Captured live (Bleach: Sennen Kessen-hen – Kashin-tan, anime4up): the story
// slot holds a name/season tag sentence glued to the real plot. The tag is
// dropped and only the plot remains.
const bleachFull =
  "قصة انمي بليتش Bleach: Sennen Kessen-hen – Kashin-tan الجزء الرابع والأخير من BLEACH: Sennen Kessen-hen. يلوح الدمار في نهاية حرب الدم التي دامت ألف عام بين Soul Reapers وQuiency. . . حيث يعكس موت ملك الروح انهيار العوالم الثلاثة، وتبدأ التشوهات وعلامات الدمار في الظهور في جميع العوالم. اندلعت معارك ضارية في جميع أنحاء منطقة الوهر بين فرق حرس المحكمة الثلاثة عشر والحرس الملكي. يتعلم Ichigo عن نوايا Uryuu الحقيقية ويجدد تصميمه على حماية العالم معًا، كأصدقاء يثقون ببعضهم البعض.";
const bleachOut = cleanSynopsis(bleachFull);
assert.equal(bleachOut.startsWith("يلوح الدمار"), true);
assert.equal(bleachOut.includes("Kashin-tan"), false);

// Captured live stubs (anime4up): season/OVA tags with no plot at all must
// collapse to "" so the block hides.
assert.equal(
  cleanSynopsis("قصة انمي قاتل الشياطين الموسم الرابع Kimetsu no Yaiba: Hashira Geiko-hen تتمة لاحداث المواسم السابقة."),
  "",
);
assert.equal(
  cleanSynopsis("قصة انمي Shingeki no Kyojin: The Final Season Part 2 تتمة لاحداث الموسم السابق."),
  "",
);
assert.equal(cleanSynopsis("القسم الثالث من الموسم الثاني."), "");
assert.equal(cleanSynopsis("حلقة خاصة تابعة لانمي Clannad."), "");

// The source's per-season re-description restarting after the real story
// ("…انهارت العوالم. الموسم الرابع من بليتش…") must be cut — that is the
// "description repeated in a different format" leak.
const restartStory =
  "يلوح الدمار في نهاية حرب الدم التي دامت ألف عام، وتبدأ العوالم الثلاثة بالانهيار واحدة تلو الأخرى، وتظهر التشوهات في كل مكان.";
const restartLeak =
  restartStory +
  " الموسم الرابع من بليتش: حرب الألف عام تدور أحداثه بعد انهيار العوالم الثلاثة ويتبع المعركة الأخيرة.";
const restartOut = cleanSynopsis(restartLeak);
assert.equal(restartOut.includes("الموسم الرابع"), false);
assert.equal(restartOut.startsWith("يلوح الدمار"), true);

// A mid-sentence part reference inside a story is NOT a restart and survives.
const recapStory =
  "يواصل البطل رحلته في الجزء الأخير من القصة حيث يواجه عدوه القديم من جديد لأجل حماية أصدقائه والأشخاص الذين يحبهم.";
assert.equal(cleanSynopsis(recapStory), recapStory);

// The anime3rb seasons-grid tail captured from the Re:Zero page: per-season
// cards (meta + the same story re-told) glued after the real story. The
// result must be the story only — no card meta, no re-tellings.
const rezeroStory =
  "عندما يغادر سوبارو ناتسوكي متجر البقالة، يُنتزع فجأة من حياته اليومية ويلقى في عالم خيالي، حيث يجد المراهق الحائر نفسه في ورطة منذ اللحظة الأولى.";
const rezeroTail =
  rezeroStory +
  " كوميدي ربيع 2016 التقييم 6.92 11 حلقات. ناتسوكي سوبارو ينتقل فجأة إلى عالم آخر مليء بالتوتر واليأس، لكنه يجد فيه فرصة للراحة واستكشاف ما حوله. كوميدي صيف 2016 التقييم 6.81 14 حلقات. سوبارو ناتسوكي يستيقظ ليكتشف أنه انتقل إلى العالم الخيالي من جديد.";
const rezeroOut = cleanSynopsis(rezeroTail);
assert.equal(rezeroOut.startsWith("عندما يغادر سوبارو"), true);
assert.equal(rezeroOut.includes("التقييم"), false);
assert.equal(rezeroOut.includes("ناتسوكي سوبارو ينتقل فجأة"), false);

console.log("anime detail tests passed");

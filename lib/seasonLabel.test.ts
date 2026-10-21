// Run: npx tsx lib/seasonLabel.test.ts — fixtures are real AniList entries.
import assert from "node:assert/strict";
import { explicitSeason, explicitPart, romanSeason, resolveSeason, seasonLabelAr, cleanAniListDescription, type SeasonNode } from "./seasonLabel";

const tv = (romaji: string, english: string | null, episodes: number, format = "TV"): SeasonNode => ({ format, episodes, title: { romaji, english } });

// Words, ordinals, Arabic; Part/Cour are not seasons.
assert.equal(explicitSeason("Dandadan 2nd Season"), 2);
assert.equal(explicitSeason("Ore dake Level Up na Ken: Season 2 - Arise from the Shadow"), 2);
assert.equal(explicitSeason("Shingeki no Kyojin Second Season"), 2);
assert.equal(explicitSeason("الموسم ٣"), 3);
assert.equal(explicitSeason("Spy x Family Part 2"), null);
assert.equal(explicitSeason("86 Eighty Six"), null, "a number in the name is not a season");
assert.equal(explicitPart("Re:Zero kara Hajimeru Isekai Seikatsu 2nd Season Part 2"), 2);
assert.equal(explicitPart("Tokyo Revengers Season 2 Part 2"), 2);
assert.equal(explicitPart("Jujutsu Kaisen 2nd Season"), null);
assert.equal(romanSeason("Mushoku Tensei Ⅲ: Isekai Ittara Honki Dasu"), 3);
assert.equal(romanSeason("Youjo Senki II"), 2);
assert.equal(romanSeason("Kimetsu no Yaiba"), null);

// Tokyo Revengers: Tenjiku-hen has no number; AniList's official name says S2 Part 2.
const tenjiku = tv("Tokyo Revengers: Tenjiku-hen", "Tokyo Revengers Season 2 Part 2", 13);
assert.deepEqual(resolveSeason("Tokyo Revengers: Tenjiku-hen", tenjiku, []), { season: 2, part: 2 });

// No official number anywhere: count the chain. Kimetsu's 7-episode TV recut
// (Mugen Ressha-hen) must not count as a season → Yuukaku-hen is season 2.
const yuukaku = tv("Kimetsu no Yaiba: Yuukaku-hen", "Demon Slayer: Kimetsu no Yaiba Entertainment District Arc", 11);
assert.deepEqual(resolveSeason("Kimetsu no Yaiba: Yuukaku-hen", yuukaku, [
  tv("Kimetsu no Yaiba: Mugen Ressha-hen (TV)", "Demon Slayer: Mugen Train Arc", 7),
  tv("Kimetsu no Yaiba", "Demon Slayer: Kimetsu no Yaiba", 26),
]), { season: 2, part: null });

// Split cours merge: Mushoku Tensei III after S1, S1 Part 2, S2, S2 Part 2 is 3.
const mt3 = tv("Mushoku Tensei III: Isekai Ittara Honki Dasu", null, 14);
const mtChain = [
  tv("Mushoku Tensei II: Isekai Ittara Honki Dasu Part 2", "Mushoku Tensei: Jobless Reincarnation Season 2 Part 2", 12),
  tv("Mushoku Tensei II: Isekai Ittara Honki Dasu", "Mushoku Tensei: Jobless Reincarnation Season 2", 13),
  tv("Mushoku Tensei: Isekai Ittara Honki Dasu Part 2", "Mushoku Tensei: Jobless Reincarnation Part 2", 12),
  tv("Mushoku Tensei: Isekai Ittara Honki Dasu", "Mushoku Tensei: Jobless Reincarnation", 11),
];
assert.deepEqual(resolveSeason("Mushoku Tensei Ⅲ: Isekai Ittara Honki Dasu", mt3, mtChain), { season: 3, part: null });

// A Roman numeral without a sequel chain is NOT a season.
assert.deepEqual(resolveSeason("Final Fantasy VII: Advent Children", tv("Final Fantasy VII: Advent Children", null, 1, "MOVIE"), []), { season: null, part: null });
assert.deepEqual(resolveSeason("Some Show VII", tv("Some Show VII", null, 12), []), { season: 1, part: null });

// Source words beat everything; first seasons get no label.
assert.deepEqual(resolveSeason("Kusuriya no Hitorigoto 2nd Season", null, []), { season: 2, part: null });
assert.equal(seasonLabelAr(1, null), null);
assert.equal(seasonLabelAr(null, null), null);
assert.equal(seasonLabelAr(3, null), "الموسم الثالث");
assert.equal(seasonLabelAr(2, 2), "الموسم الثاني · الجزء الثاني");
assert.equal(seasonLabelAr(1, 2), "الموسم الأول · الجزء الثاني");
assert.equal(seasonLabelAr(12, null), "الموسم 12");

assert.equal(
  cleanAniListDescription("While the mission to exorcise <i>Jiji</i>&#039;s family home is underway, a new threat appears.<br><br>\n(Source: Crunchyroll)<br><br><i>Note: Excludes recap.</i>"),
  "While the mission to exorcise Jiji's family home is underway, a new threat appears.",
);

// Stubs that only restate the season are dropped (the pill already says it).
assert.equal(cleanAniListDescription("The second season of <i>Ao no Hako</i>."), "");
assert.equal(cleanAniListDescription("The third season of <i>Tensei Kizoku</i>.<br><br>\nNote: Excludes the recap episode."), "");
assert.equal(
  cleanAniListDescription("Mastering his new abilities in secret, Jin-U must battle humanity's toughest threats."),
  "Mastering his new abilities in secret, Jin-U must battle humanity's toughest threats.",
  "a short real story stays",
);
const real = "Using her wit and vast knowledge of medicines and poisons alike, Maomao keeps working at the palace. A new season brings new mysteries and new dangers to the inner court.";
assert.equal(cleanAniListDescription(real), real, "a real story mentioning 'season' stays");

console.log("PASS season labels + AniList description cleanup");

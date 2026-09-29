// Matching tests for the next-episode countdown. The old matcher fell back to
// AniList's raw ordering and accepted loose containment, so a finished "Naruto"
// page showed "Boruto" episode numbers and Arabic-only titles matched random
// entries. Run:  npx tsx lib/airingMatch.test.ts

import assert from "node:assert";
import { pickAiring, titleScore } from "./airing";

const future = Math.floor(Date.now() / 1000) + 86_400;

const media = (romaji: string, episode: number | null, extra: Record<string, any> = {}) => ({
  title: { romaji, english: null, native: null },
  synonyms: [],
  nextAiringEpisode: episode == null ? null : { airingAt: future, episode },
  ...extra,
});

// Exact match wins.
assert.equal(
  titleScore(media("Naruto", 1), ["naruto"]),
  1000,
);

// Containment is weak: "Boruto: Naruto Next Generations" must NOT be trusted
// for a "naruto" query.
assert.equal(
  titleScore(media("Boruto: Naruto Next Generations", 1), ["naruto"]),
  300,
);

// Prefix matches are the season/cour continuation form.
assert.equal(
  titleScore(media("Tensei Shitara Slime Datta Ken 4th Season", 1), ["tensei shitara slime datta ken"]),
  500,
);

// A finished exact match plus an airing spin-off → no countdown, not the spin-off.
assert.equal(
  pickAiring(
    [media("Naruto", null), media("Boruto: Naruto Next Generations", 294)],
    ["naruto"],
  ),
  null,
);

// The airing later season wins over the finished earlier one when the query is
// the shared base name.
assert.deepEqual(
  pickAiring(
    [media("Tensei Shitara Slime Datta Ken", null), media("Tensei Shitara Slime Datta Ken 4th Season", 5)],
    ["tensei shitara slime datta ken"],
  ),
  { episode: 5, airingAt: future },
);

// Arabic-only query with no romaji match → null (the Jikan alt-title path runs
// before this in production; the matcher must not guess).
assert.equal(pickAiring([media("Some Random Anime", 3)], [""]), null);

// Past airing times are rejected outright.
assert.equal(
  pickAiring([media("X", 1, { nextAiringEpisode: { airingAt: 1000, episode: 1 } })], ["x"]),
  null,
);

console.log("airing match tests passed");

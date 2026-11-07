import assert from "node:assert";
import {
  hoursSaved,
  isSkippable,
  kindsFromJikan,
  matchAflShow,
  nextCanonEpisode,
  normShowName,
  parseAflShowList,
  parseAflShowPage,
  parseRanges,
  summarizeFiller,
} from "./fillerParse";

assert.deepEqual(parseRanges("1-3, 5, 8-9"), [1, 2, 3, 5, 8, 9]);
assert.deepEqual(parseRanges("junk, 4, 7-6"), [4]);
assert.deepEqual(parseRanges(""), []);

// Real animefillerlist markup shape (Naruto page).
const page = `
<div class="manga_canon"><span class="Label">Manga Canon Episodes:</span><span class="Episodes"><a href="javascript://" onclick="jumpToNum(1);">1-6</a>, <a href="javascript://">8</a></span></div>
<div class="mixed_canon/filler"><span class="Label">Mixed Canon/Filler Episodes:</span><span class="Episodes"><a href="javascript://">7</a></span></div>
<div class="filler"><span class="Label">Filler Episodes:</span><span class="Episodes"><a href="javascript://">26</a>, <a href="javascript://">97-100</a></span></div>
`;
const kinds = parseAflShowPage(page);
assert.equal(kinds[1], "canon");
assert.equal(kinds[7], "mixed");
assert.equal(kinds[26], "filler");
assert.equal(kinds[99], "filler");
assert.equal(kinds[50], undefined);

// Show list parsing + exact matching with romanization folding.
const list = parseAflShowList(`
<a href="/shows/naruto">Naruto</a>
<a href="/shows/naruto-shippuden">Naruto: Shippuden</a>
<a href="/shows/certain-magical-index">A Certain Magical Index (Toaru Majutsu No Index)</a>
<a href="/shows/one-pace">One Pace (One Piece)</a>
<a href="/shows/one-piece">One Piece</a>
`);
assert.equal(list.length, 5);
assert.equal(matchAflShow(list, ["One Piece"]), "one-piece", "primary name beats a paren alias");
assert.equal(matchAflShow(list, ["Naruto Shippuuden"]), "naruto-shippuden");
assert.equal(matchAflShow(list, ["Naruto"]), "naruto");
assert.equal(matchAflShow(list, ["Toaru Majutsu no Index"]), "certain-magical-index");
assert.equal(matchAflShow(list, ["One Piece Film Red"]), null, "no fuzzy matches");
assert.equal(matchAflShow(list, [null, "", "Boruto"]), null);
assert.equal(normShowName("The Promised Neverland (TV)"), "promised neverland");

// Jikan flags → kinds.
const jk = kindsFromJikan([{ data: [{ mal_id: 1, filler: false, recap: false }, { mal_id: 2, filler: true }, { mal_id: 3, recap: true }] }]);
assert.deepEqual(jk, { 2: "filler", 3: "recap" });

assert.ok(isSkippable("filler") && isSkippable("recap"));
assert.ok(!isSkippable("mixed") && !isSkippable("canon") && !isSkippable(undefined));

// Summary only counts available episodes.
const sum = summarizeFiller(kinds, [1, 2, 7, 26, 97, 98]);
assert.equal(sum.fillerCount, 3);
assert.equal(sum.mixedCount, 1);
assert.deepEqual(sum.skippable, [26, 97, 98]);

// Next canon skips filler runs; respects the available list.
assert.equal(nextCanonEpisode(kinds, 96), 101);
assert.equal(nextCanonEpisode(kinds, 25), 27);
assert.equal(nextCanonEpisode(kinds, 96, [97, 98, 99, 100]), null);
assert.equal(nextCanonEpisode(kinds, 96, [97, 101, 102]), 101);

assert.equal(hoursSaved(90), 34.5);
assert.equal(hoursSaved(0), 0);

console.log("filler parse tests passed");

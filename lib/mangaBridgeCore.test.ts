import assert from "node:assert";
import {
  bridgeIsShowable,
  bridgeSearchTitles,
  continueFrom,
  pickChapter,
  resolveBridgeView,
  type BridgePayload,
} from "./mangaBridgeCore";

const ai = (end: number | null, confidence: "high" | "medium" | "low" = "high"): BridgePayload => ({
  source: "manga", endChapter: end, confidence, mangaTitle: "Jujutsu Kaisen", mangaTitleEnglish: "Jujutsu Kaisen",
});

assert.equal(continueFrom(63), 64);
assert.equal(continueFrom(63.5), 64);
assert.equal(continueFrom(null), null);

// Confident AI with no votes.
let v = resolveBridgeView(ai(63), []);
assert.equal(v.endChapter, 63);
assert.equal(v.continueChapter, 64);
assert.equal(v.basis, "ai");
assert.equal(v.uncertain, false);

// Two dissenting votes do NOT override a confident AI; three do.
v = resolveBridgeView(ai(63), [{ ch: 79, n: 2 }]);
assert.equal(v.endChapter, 63);
v = resolveBridgeView(ai(63), [{ ch: 79, n: 3 }]);
assert.equal(v.endChapter, 79);
assert.equal(v.basis, "community");
assert.equal(v.agree, 3);

// ...unless as many people back the AI's number.
v = resolveBridgeView(ai(63), [{ ch: 79, n: 3 }, { ch: 63, n: 3 }]);
assert.equal(v.endChapter, 63);
assert.equal(v.basis, "community", "AI backed by 2+ votes reads as community-confirmed");

// Low-confidence AI is uncertain and yields to 2 votes.
v = resolveBridgeView(ai(40, "low"), []);
assert.equal(v.uncertain, true);
v = resolveBridgeView(ai(40, "low"), [{ ch: 44, n: 2 }]);
assert.equal(v.endChapter, 44);
assert.equal(v.uncertain, false);

// No AI number: any vote fills the gap.
v = resolveBridgeView(ai(null, "low"), [{ ch: 12, n: 1 }]);
assert.equal(v.endChapter, 12);
v = resolveBridgeView(ai(null), []);
assert.equal(v.endChapter, null);
assert.equal(v.basis, "none");
assert.equal(v.uncertain, true);

assert.equal(bridgeIsShowable(ai(1)), true);
assert.equal(bridgeIsShowable({ source: "original" }), false);
assert.equal(bridgeIsShowable(null), false);

// Search titles: English first, deduped, season tags stripped from the anime title.
const titles = bridgeSearchTitles(
  { ...ai(1), mangaTitle: "Jujutsu Kaisen", mangaSynonyms: ["JJK", "呪術廻戦"] },
  "Jujutsu Kaisen 2nd Season",
);
assert.deepEqual(titles, ["Jujutsu Kaisen", "JJK"]);

// Chapter picking: exact, else the next one within 3, else null.
const chs = [{ number: "62" }, { number: "64" }, { number: "65.5" }, { number: "خاص" }];
assert.equal(pickChapter(chs, 62)?.number, "62");
assert.equal(pickChapter(chs, 63)?.number, "64");
assert.equal(pickChapter(chs, 65)?.number, "65.5");
assert.equal(pickChapter(chs, 70), null);

// Anime covered the whole finished manga: nothing to continue from.
v = resolveBridgeView({ ...ai(700), mangaChapters: 700, mangaStatus: "FINISHED" }, []);
assert.equal(v.coversAll, true);
assert.equal(v.continueChapter, null);
v = resolveBridgeView({ ...ai(690), mangaChapters: 700, mangaStatus: "FINISHED" }, []);
assert.equal(v.coversAll, false);
assert.equal(v.continueChapter, 691);
v = resolveBridgeView({ ...ai(300), mangaChapters: 300, mangaStatus: "RELEASING" }, []);
assert.equal(v.coversAll, false, "an ongoing manga always has more coming");

console.log("manga bridge core tests passed");

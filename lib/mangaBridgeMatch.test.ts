import assert from "node:assert";
import {
  BRIDGE_MATCH_MIN,
  bridgeCardScore,
  bridgeNames,
  bridgeQueryPlan,
  cleanBridgeTitle,
  rankBridgeCards,
  titleHalves,
} from "./mangaBridgeMatch";
import type { BridgePayload } from "./mangaBridgeCore";

const P = (p: Partial<BridgePayload>): BridgePayload => ({ source: "manga", ...p });

// Punctuation that breaks phrase search.
assert.equal(cleanBridgeTitle("HUNTER×HUNTER"), "HUNTER x HUNTER");
assert.equal(cleanBridgeTitle("Tokyo卍Revengers"), "Tokyo Revengers");

// Colon halves keep long heads only (Re:Zero stays whole).
assert.deepEqual(titleHalves("Demon Slayer: Kimetsu no Yaiba"), ["Demon Slayer", "Kimetsu no Yaiba"]);
assert.deepEqual(titleHalves("Re:Zero kara Hajimeru"), ["Zero kara Hajimeru"]);

// Names include Arabic synonyms + the season-stripped anime title.
const kny = bridgeNames(
  P({ mangaTitleEnglish: "Demon Slayer: Kimetsu no Yaiba", mangaTitle: "Kimetsu no Yaiba", mangaSynonyms: ["قاتل الشياطين", "귀멸의 칼날"] }),
  "Kimetsu no Yaiba 2nd Season",
);
assert.ok(kny.some((n) => n.title === "قاتل الشياطين"));
assert.ok(!kny.some((n) => n.title === "귀멸의 칼날"));
assert.ok(kny.some((n) => n.title === "Kimetsu no Yaiba" && n.weight === 1));

// The plan reaches short key words a person would type.
const plan = bridgeQueryPlan(kny);
assert.ok(plan.first.includes("Demon Slayer: Kimetsu no Yaiba"));
assert.ok([...plan.first, ...plan.second].includes("kimetsu"));

// A card titled by the OTHER name still matches (3asq: "Kimetsu No Yaiba").
assert.ok(bridgeCardScore(kny, "Kimetsu No Yaiba") >= 0.98);
// Spin-offs do not.
assert.ok(bridgeCardScore(kny, "Kimetsu no Yaiba: Rengoku Kyoujurou Gaiden") < BRIDGE_MATCH_MIN);

// × spelling and compact spacing.
const hxh = bridgeNames(P({ mangaTitle: "HUNTER×HUNTER" }), "Hunter x Hunter (2011)");
assert.ok(bridgeCardScore(hxh, "Hunter X Hunter") >= 0.98);
const ao = bridgeNames(P({ mangaTitle: "Aoashi" }), "Aoashi Season 2");
assert.ok(bridgeCardScore(ao, "Ao Ashi") >= 0.95);

// Plain card beats its colored/alternate cut; the cut still qualifies alone.
const ranked = rankBridgeCards(hxh, [
  { title: "Hunter X Hunter – colored" },
  { title: "Hunter x Hunter: Kurapika Tsuioku-hen" },
  { title: "Hunter X Hunter" },
]);
assert.equal(ranked[0].card.title, "Hunter X Hunter");
assert.equal(ranked[1].card.title, "Hunter X Hunter – colored");
assert.equal(ranked.length, 2);

// A wrong spin-off title from the AI falls back to the anime title.
const op = bridgeNames(P({ mangaTitle: "ONE PIECE: Loguetown-hen" }), "One Piece");
assert.equal(rankBridgeCards(op, [{ title: "One Piece Colored" }, { title: "One Piece" }])[0].card.title, "One Piece");

// Empty payload titles: the anime title alone still works.
const tbate = bridgeNames(P({}), "The Beginning After the End Season 2");
assert.ok(bridgeCardScore(tbate, "The Beginning After the End") >= 0.98);
assert.ok(!bridgeQueryPlan(tbate).second.includes("after"));

// Bare numbers are never searched.
assert.ok(![...bridgeQueryPlan(hxh).first, ...bridgeQueryPlan(hxh).second].includes("2011"));

console.log("mangaBridgeMatch tests passed");

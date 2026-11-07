import assert from "node:assert";
import { decideRecapOffer, RECAP_GAP_DAYS, type RecapHistoryRow } from "./recapOffer";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 10, 7);
const row = (ep: number, daysAgo: number, key = "witanime/anime/frieren"): RecapHistoryRow => ({
  hrefKey: key, titleKey: "frieren", episodeHref: `https://x/e${ep}`, updatedAt: now - daysAgo * DAY, epNum: ep,
});
const ctx = (epNum: number | null) => ({ hrefKey: "witanime/anime/frieren", titleKey: "frieren", episodeHref: "https://x/cur", epNum, now });

// Episode 1 / unknown episode never offers.
assert.equal(decideRecapOffer([], ctx(1)), null);
assert.equal(decideRecapOffer([], ctx(null)), null);

// Cold jump-in mid-show (no history) offers; episode 2 doesn't.
assert.deepEqual(decideRecapOffer([], ctx(7)), { kind: "jump" });
assert.equal(decideRecapOffer([], ctx(2)), null);

// Active binge (watched 1 day ago) → nothing.
assert.equal(decideRecapOffer([row(5, 1)], ctx(6)), null);

// Break of ≥ RECAP_GAP_DAYS → gap offer with the last episode.
const gap = decideRecapOffer([row(4, 20), row(5, RECAP_GAP_DAYS + 3)], ctx(6));
assert.deepEqual(gap, { kind: "gap", days: RECAP_GAP_DAYS + 3, lastEp: 5 });

// Matching by title key across sources (different href key).
const cross = decideRecapOffer([{ ...row(5, 30), hrefKey: "anime4up/anime/frieren-x" }], ctx(6));
assert.equal(cross?.kind, "gap");

// Re-watching an early episode after having watched later ones → no offer.
assert.equal(decideRecapOffer([row(12, 40)], ctx(3)), null);

// Other anime's history is ignored.
assert.deepEqual(
  decideRecapOffer([{ ...row(5, 2), hrefKey: "other", titleKey: "other" }], ctx(6)),
  { kind: "jump" },
);

console.log("recap offer tests passed");

// completionMatch tests — the "watched the finale but a stale duplicate record
// shows no badge" path. Run:  npx tsx lib/completionMatch.test.ts

import assert from "node:assert";
import { matchingRecords } from "./completionMatch";

const rec = (name: string, hrefs: string[], titles: string[]) => ({ name, hrefs, titles });
const names = (records: { name: string }[]) => records.map((r) => r.name);
const keys = (...k: string[]) => new Set(k);

// No keys → nothing matches.
assert.deepEqual(matchingRecords([rec("a", ["h1"], ["t1"])], keys(), keys()), []);

// Href key hit.
assert.deepEqual(
  matchingRecords([rec("a", ["h1"], []), rec("b", ["h2"], [])], keys("h2"), keys()),
  [rec("b", ["h2"], [])],
);

// Title key is the fallback when no href matches.
assert.deepEqual(
  names(matchingRecords([rec("a", ["h1"], ["title a"])], keys("nope"), keys("title a"))),
  ["a"],
);

// ALL matches are returned, not just the first: one record via href, a
// duplicate of the same anime via title (the regression this guards — only
// updating the first copy is what left badges off).
assert.deepEqual(
  names(
    matchingRecords(
      [rec("href-copy", ["h1"], []), rec("title-copy", [], ["title a"])],
      keys("h1"),
      keys("title a"),
    ),
  ),
  ["href-copy", "title-copy"],
);

// Unrelated records are never swept in.
assert.deepEqual(matchingRecords([rec("other", ["h9"], ["t9"])], keys("h1"), keys("title a")), []);

console.log("completionMatch.test.ts — all assertions passed");

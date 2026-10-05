// staleAgainstRemote tests — the "cloud lost a watched mark and never gets it
// back" heal path. Run:  npx tsx lib/historyMerge.test.ts

import assert from "node:assert";
import { staleAgainstRemote, type MergeEntry } from "./historyMerge";

const e = (episodeHref: string, updatedAt: number): MergeEntry => ({ episodeHref, updatedAt });

// Local-only entry → must be re-uploaded.
assert.deepEqual(staleAgainstRemote([e("a", 10)], []).map((x) => x.episodeHref), ["a"]);

// Cloud has an older copy → re-upload.
assert.deepEqual(staleAgainstRemote([e("a", 20)], [e("a", 10)]).map((x) => x.episodeHref), ["a"]);

// Cloud is newer or identical → nothing to do (cloud won the merge; ties are fine).
assert.deepEqual(staleAgainstRemote([e("a", 10)], [e("a", 10)]), []);
assert.deepEqual(staleAgainstRemote([e("a", 10)], [e("a", 20)]), []);

// Mixed batch → only the stale one, original order kept.
assert.deepEqual(
  staleAgainstRemote([e("a", 30), e("b", 5), e("c", 7)], [e("b", 5), e("c", 9)]).map((x) => x.episodeHref),
  ["a"],
);

console.log("historyMerge.test.ts — all assertions passed");

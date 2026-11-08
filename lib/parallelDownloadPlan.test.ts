import assert from "node:assert";
import {
  concurrencyFor,
  isBusyStatus,
  parseContentRangeTotal,
  planChunks,
  retryDelayMs,
} from "./parallelDownloadPlan";

assert.deepEqual(planChunks(0), []);
assert.deepEqual(planChunks(10, 4), [
  { index: 0, start: 0, end: 3 },
  { index: 1, start: 4, end: 7 },
  { index: 2, start: 8, end: 9 },
]);
assert.deepEqual(planChunks(8, 4).map((c) => c.end), [3, 7]);
// Chunks cover every byte exactly once.
{
  const total = 484358775;
  const chunks = planChunks(total);
  let next = 0;
  for (const c of chunks) {
    assert.equal(c.start, next);
    next = c.end + 1;
  }
  assert.equal(next, total);
}

assert.equal(parseContentRangeTotal("bytes 0-0/484358775"), 484358775);
assert.equal(parseContentRangeTotal("bytes */100"), 0);
assert.equal(parseContentRangeTotal(null), 0);

assert.equal(concurrencyFor("vid3rb"), 2);
assert.equal(concurrencyFor("mp4upload"), 4);
assert.ok(isBusyStatus(503) && isBusyStatus(429) && !isBusyStatus(200));
assert.ok(retryDelayMs(0, true) > retryDelayMs(0, false));
assert.equal(retryDelayMs(50, true), 8000);

console.log("parallelDownloadPlan ok");

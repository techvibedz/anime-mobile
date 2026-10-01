import assert from "node:assert";
import {
  parseAniSkipResponse,
  isInsideInterval,
  activeSkipInterval,
  type EpisodeSkipTimes,
} from "./aniskip";

// 1. Parsing AniSkip response with OP and ED
const sampleResponse = {
  found: true,
  results: [
    {
      interval: {
        startTime: 90.5,
        endTime: 180.2,
      },
      skipType: "op",
      skipId: "test-op-id",
      episodeLength: 1420.5,
    },
    {
      interval: {
        startTime: 1300.0,
        endTime: 1390.0,
      },
      skipType: "ed",
      skipId: "test-ed-id",
      episodeLength: 1420.5,
    },
  ],
  message: "Successfully found skip times",
  statusCode: 200,
};

const parsed = parseAniSkipResponse(sampleResponse);
assert.equal(parsed.found, true);
assert.deepEqual(parsed.op, { startTime: 90.5, endTime: 180.2 });
assert.deepEqual(parsed.ed, { startTime: 1300, endTime: 1390 });
assert.equal(parsed.episodeLength, 1420.5);

// 2. Parsing not-found response
const notFound = parseAniSkipResponse({
  found: false,
  results: [],
  statusCode: 404,
});
assert.equal(notFound.found, false);
assert.equal(notFound.op, undefined);
assert.equal(notFound.ed, undefined);

// Null or corrupt response
assert.equal(parseAniSkipResponse(null).found, false);
assert.equal(parseAniSkipResponse({}).found, false);

// Inverted interval (endTime <= startTime) should be discarded
const inverted = parseAniSkipResponse({
  found: true,
  results: [{ interval: { startTime: 200, endTime: 100 }, skipType: "op" }],
});
assert.equal(inverted.found, false);

// 3. isInsideInterval
const interval = { startTime: 90, endTime: 180 };
// At 89.4s (before lead buffer): false
assert.equal(isInsideInterval(89.4, interval), false);
// At 89.6s (within 0.5s lead buffer): true
assert.equal(isInsideInterval(89.6, interval), true);
// At 120s (right in middle): true
assert.equal(isInsideInterval(120, interval), true);
// At 179.4s (within tail buffer): true
assert.equal(isInsideInterval(179.4, interval), true);
// At 180s (at end): false
assert.equal(isInsideInterval(180, interval), false);
// At 200s (after): false
assert.equal(isInsideInterval(200, interval), false);

// 4. activeSkipInterval
const testSkipTimes: EpisodeSkipTimes = {
  found: true,
  op: { startTime: 90, endTime: 180 },
  ed: { startTime: 1300, endTime: 1390 },
};

assert.deepEqual(activeSkipInterval(100, testSkipTimes), {
  type: "op",
  interval: { startTime: 90, endTime: 180 },
});
assert.deepEqual(activeSkipInterval(1320, testSkipTimes), {
  type: "ed",
  interval: { startTime: 1300, endTime: 1390 },
});
assert.equal(activeSkipInterval(500, testSkipTimes), null);
assert.equal(activeSkipInterval(100, { found: false }), null);

console.log("All lib/aniskip tests passed!");

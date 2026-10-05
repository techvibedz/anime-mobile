import assert from "node:assert";
import {
  NEXT_EPISODE_COUNTDOWN_SECONDS,
  SLEEP_PRESETS,
  cycleSubtitleTrack,
  nextSleepPreset,
  sleepMinutesLeft,
} from "./playerExtras";

function main() {
  assert.deepEqual([...SLEEP_PRESETS], [15, 30, 45, 60]);
  assert.equal(nextSleepPreset(null), 15, "off must arm the first preset");
  assert.equal(nextSleepPreset(15), 30);
  assert.equal(nextSleepPreset(45), 60);
  assert.equal(nextSleepPreset(60), null, "last preset must cycle back to off");
  assert.equal(nextSleepPreset(999), null, "unknown preset must reset to off");

  assert.equal(sleepMinutesLeft(1000 + 30 * 60_000, 1000), 30);
  assert.equal(sleepMinutesLeft(1000 + 1, 1000), 1, "partial minute must round up");
  assert.equal(sleepMinutesLeft(0, 60_000), 0, "expired timer must clamp to zero");

  assert.equal(cycleSubtitleTrack(0, 2), 1);
  assert.equal(cycleSubtitleTrack(1, 2), -1, "last track must cycle to off");
  assert.equal(cycleSubtitleTrack(-1, 2), 0, "off must cycle back to the first track");
  assert.equal(cycleSubtitleTrack(0, 1), -1);
  assert.equal(cycleSubtitleTrack(0, 0), -1, "no tracks must stay off");

  assert.equal(NEXT_EPISODE_COUNTDOWN_SECONDS, 10);

  console.log("player extras tests passed");
}

main();

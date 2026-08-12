import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shouldRunEpisodeNotifier } from "./notificationQueue";

assert.equal(shouldRunEpisodeNotifier(null), false);
assert.equal(shouldRunEpisodeNotifier([]), false);
assert.equal(shouldRunEpisodeNotifier([{ episode_key: "anime#1" }]), true);

const notifier = readFileSync("supabase/functions/episode-notifier/index.ts", "utf8");
assert.ok(
  notifier.indexOf('.from("episode_queue")') < notifier.indexOf("// 1. Tokens"),
  "episode-notifier must check queue work before downloading fan-out data",
);

console.log("notification queue tests passed");

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shouldRunEpisodeNotifier } from "./notificationQueue";

assert.equal(shouldRunEpisodeNotifier(null), false);
assert.equal(shouldRunEpisodeNotifier([]), false);
assert.equal(shouldRunEpisodeNotifier([{ episode_key: "anime#1" }]), true);

const notifier = readFileSync("supabase/functions/episode-notifier/index.ts", "utf8");
const notificationSchema = readFileSync("supabase/notifications.sql", "utf8");
assert.ok(
  notifier.indexOf('.from("episode_queue")') < notifier.indexOf("// 1. Tokens"),
  "episode-notifier must check queue work before downloading fan-out data",
);
assert.match(notifier, /\.is\("processed_at", null\)/);
assert.match(notifier, /\.update\(\{ processed_at: new Date\(\)\.toISOString\(\) \}\)/);
assert.match(notificationSchema, /add column if not exists processed_at timestamptz/);

console.log("notification queue tests passed");

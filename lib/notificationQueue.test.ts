import assert from "node:assert/strict";
import { shouldRunEpisodeNotifier } from "./notificationQueue";

assert.equal(shouldRunEpisodeNotifier(null), false);
assert.equal(shouldRunEpisodeNotifier([]), false);
assert.equal(shouldRunEpisodeNotifier([{ episode_key: "anime#1" }]), true);

console.log("notification queue tests passed");

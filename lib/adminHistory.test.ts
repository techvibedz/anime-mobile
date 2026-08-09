import assert from "node:assert/strict";
import { mapAdminHistoryRow, mergeWatchSummaries } from "./adminHistory";

const users = mergeWatchSummaries(
  [{ userId: "u1", name: "One" }, { userId: "u2", name: "Two" }],
  [{ user_id: "u1", episodes_started: "4", episodes_completed: "2" }],
);

assert.deepEqual(users, [
  { userId: "u1", name: "One", episodesStarted: 4, episodesCompleted: 2 },
  { userId: "u2", name: "Two", episodesStarted: 0, episodesCompleted: 0 },
]);

assert.deepEqual(
  mapAdminHistoryRow({
    episode_href: "/ep/1",
    episode_title: "Episode 1",
    anime_title: "Anime",
    anime_href: "/anime",
    image: null,
    image_fallback: "https://img.example/fallback.jpg",
    position_ms: "1200",
    duration_ms: "1000",
    completed: false,
    updated_at: "2026-08-09T00:00:00Z",
  }),
  {
    episodeHref: "/ep/1",
    episodeTitle: "Episode 1",
    animeTitle: "Anime",
    animeHref: "/anime",
    image: "https://img.example/fallback.jpg",
    positionMs: 1200,
    durationMs: 1000,
    completed: false,
    updatedAt: "2026-08-09T00:00:00Z",
    progress: 1,
  },
);

assert.equal(
  mapAdminHistoryRow({
    image: "https://img.example/stored.jpg",
    image_fallback: "https://img.example/fallback.jpg",
  }).image,
  "https://img.example/stored.jpg",
);

assert.equal(mapAdminHistoryRow({ duration_ms: 0, position_ms: 10 }).progress, 0);

console.log("adminHistory mapper tests passed");

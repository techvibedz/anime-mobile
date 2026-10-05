import assert from "node:assert";
import {
  PREFETCH_BUFFER_SECONDS,
  PREFETCH_MAX_MS,
  choosePrefetchServer,
} from "./prefetchPlan";

function main() {
  const list = [
    { provider: "mp4upload", iframeUrl: "https://mp4upload/x" },
    { provider: "vid3rb", iframeUrl: "https://vid3rb/a" },
    { provider: "vid3rb", iframeUrl: "https://vid3rb/b" },
  ];
  assert.equal(choosePrefetchServer(list)?.iframeUrl, "https://vid3rb/a", "first vid3rb wins");

  assert.equal(choosePrefetchServer([]), null, "empty list must have no pick");
  assert.equal(
    choosePrefetchServer([{ provider: "mp4upload", iframeUrl: "https://x" }]),
    null,
    "non-vid3rb providers are not prefetchable",
  );
  assert.equal(
    choosePrefetchServer([{ provider: "vid3rb" }]),
    null,
    "vid3rb without an iframe URL must be skipped",
  );
  assert.equal(
    choosePrefetchServer([null as any, { provider: "vid3rb", iframeUrl: "https://vid3rb/ok" }])?.iframeUrl,
    "https://vid3rb/ok",
    "garbage rows must be skipped",
  );

  assert.ok(PREFETCH_BUFFER_SECONDS > 0 && PREFETCH_BUFFER_SECONDS <= 300);
  assert.ok(PREFETCH_MAX_MS >= 30_000);

  console.log("prefetch plan tests passed");
}

main();

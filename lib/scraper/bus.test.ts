import assert from "node:assert/strict";
import { _cancelBackground, _claimNext, _isCancelled, _peek, enqueue } from "./bus";

const job = (url: string, priority = false) => ({
  url,
  injectAfter: "true;",
  timeoutMs: 1000,
  priority,
});

async function main() {
  const activeResult = enqueue(job("https://example.com/active")).catch((error) => error.message);
  await Promise.resolve();
  const active = _claimNext();
  assert.ok(active);

  const queuedResult = enqueue(job("https://example.com/queued")).catch((error) => error.message);
  const priorityResult = enqueue(job("https://example.com/play", true)).catch((error) => error.message);
  await Promise.resolve();

  _cancelBackground();

  assert.equal(await activeResult, "cancelled: playback selected");
  assert.equal(await queuedResult, "cancelled: playback selected");
  assert.equal(_isCancelled(active.job.id), true);
  assert.equal(_peek()?.priority, true);

  const priority = _claimNext();
  assert.ok(priority);
  priority.resolve("kept");
  assert.equal(await priorityResult, "kept");

  console.log("scraper bus tests passed");
}

void main();

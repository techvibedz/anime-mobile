import assert from "node:assert/strict";
import { _cancelBackground, _claimNext, _isCancelled, _peek, _resolve, enqueue } from "./bus";

const job = (url: string, priority = false) => ({
  url,
  injectAfter: "true;",
  timeoutMs: 1000,
  priority,
});

async function main() {
  const mangaResult = enqueue(job("https://example.com/manga"));
  await Promise.resolve();
  const manga = _claimNext();
  assert.ok(manga);
  const discoveryResult = enqueue(job("https://example.com/source", true));
  await Promise.resolve();
  assert.equal(_isCancelled(manga.job.id), false, "a source fallback must not interrupt another source");
  const discovery = _claimNext();
  assert.ok(discovery);
  _resolve(discovery.job.id, "discovered");
  _resolve(manga.job.id, "loaded");
  assert.equal(await discoveryResult, "discovered");
  assert.equal(await mangaResult, "loaded");

  const activeResult = enqueue(job("https://example.com/active")).catch((error) => error.message);
  await Promise.resolve();
  const active = _claimNext();
  assert.ok(active);

  const queuedResult = enqueue(job("https://example.com/queued")).catch((error) => error.message);
  const priorityResult = enqueue({ ...job("https://example.com/play", true), allFrames: true }).catch((error) => error.message);
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

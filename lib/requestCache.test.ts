import assert from "node:assert";
import { createRequestCache, withTimeout } from "./requestCache";

async function main() {
  let now = 1000;
  const cache = createRequestCache<number>(100, () => now);

  let calls = 0;
  let release!: (value: number) => void;
  const pending = new Promise<number>((resolve) => { release = resolve; });
  const first = cache.run("same", () => { calls++; return pending; });
  const second = cache.run("same", () => { calls++; return Promise.resolve(2); });
  assert.equal(calls, 1, "concurrent calls must share one loader");
  release(1);
  assert.deepEqual(await Promise.all([first, second]), [1, 1]);

  assert.equal(await cache.run("same", () => { calls++; return Promise.resolve(3); }), 1);
  assert.equal(calls, 1, "fresh cache hit must not invoke loader");

  assert.equal(await cache.run("same", () => { calls++; return Promise.resolve(4); }, { force: true }), 4);
  assert.equal(calls, 2, "force must bypass cached value");

  let releaseBackground!: (value: number) => void;
  const background = cache.run("playback", () => new Promise<number>((resolve) => { releaseBackground = resolve; }));
  const selected = cache.run("playback", () => Promise.resolve(9), { force: true });
  assert.equal(await selected, 9, "force must bypass an in-flight background request");
  releaseBackground(8);
  assert.equal(await background, 8);

  let invalidCalls = 0;
  await cache.run("invalid", async () => { invalidCalls++; return 0; }, { valid: (value) => value > 0 });
  await cache.run("invalid", async () => { invalidCalls++; return 5; }, { valid: (value) => value > 0 });
  assert.equal(invalidCalls, 2, "invalid results must not be cached");

  now += 101;
  assert.equal(await cache.run("same", () => { calls++; return Promise.resolve(6); }), 6);
  assert.equal(calls, 3, "expired values must reload");

  cache.delete("same");
  assert.equal(await cache.run("same", () => { calls++; return Promise.resolve(7); }), 7);
  cache.clear();

  const timedOut = await withTimeout(new Promise<number>(() => {}), 5, 9);
  assert.equal(timedOut, 9, "timeout must return the bounded fallback");
  const fast = await withTimeout(Promise.resolve(8), 50, 9);
  assert.equal(fast, 8, "completed work must win before the deadline");

  console.log("request cache tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

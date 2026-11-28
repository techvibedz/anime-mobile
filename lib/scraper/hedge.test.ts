import assert from "node:assert/strict";
import { hedge } from "./hedge";
import { _resetCfGate, hostsNeedingWarm, isCfBlocked, markCfBlocked, markCfCleared } from "./cfGate";
import { clearTimings, recordTiming, summarizeTimings } from "./timing";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // Fast primary wins; fallback never starts.
  {
    let fallbackRan = false;
    const v = await hedge(async () => { await sleep(10); return "direct"; }, async () => { fallbackRan = true; return "wv"; }, { delayMs: 100 });
    assert.equal(v, "direct");
    await sleep(120);
    assert.equal(fallbackRan, false);
  }
  // Slow primary: fallback starts at delay and wins.
  {
    const v = await hedge(async () => { await sleep(300); return "direct"; }, async () => { await sleep(20); return "wv"; }, { delayMs: 30 });
    assert.equal(v, "wv");
  }
  // Primary fails fast: fallback starts immediately, without waiting for delay.
  {
    const t0 = Date.now();
    const v = await hedge(async () => null, async () => "wv", { delayMs: 5000 });
    assert.equal(v, "wv");
    assert.ok(Date.now() - t0 < 1000);
  }
  // Primary wins after fallback started: fallback gets aborted.
  {
    let aborted = false;
    const v = await hedge(
      async () => { await sleep(60); return "direct"; },
      (signal) => new Promise((resolve) => {
        signal.addEventListener("abort", () => { aborted = true; resolve(null); });
      }),
      { delayMs: 10 },
    );
    assert.equal(v, "direct");
    assert.equal(aborted, true);
  }
  // Both fail -> null; invalid results don't win.
  {
    const v = await hedge(async () => [] as number[], async () => { throw new Error("x"); }, { delayMs: 10, valid: (a) => a.length > 0 });
    assert.equal(v, null);
  }
  // Fallback fails first, primary later succeeds -> primary value.
  {
    const v = await hedge(async () => { await sleep(80); return "direct"; }, async () => null, { delayMs: 10 });
    assert.equal(v, "direct");
  }

  // cfGate: block, cleared by a browser, warm list.
  _resetCfGate();
  const now = Date.now();
  assert.equal(isCfBlocked("https://anime3rb.com/x", now), false);
  markCfBlocked("https://anime3rb.com/titles/a", now);
  assert.equal(isCfBlocked("https://anime3rb.com/episode/b", now + 1000), true);
  assert.equal(isCfBlocked("https://witanime.site/", now + 1000), false);
  assert.equal(isCfBlocked("https://anime3rb.com/", now + 5 * 60_000), false, "block expires");
  assert.deepEqual(hostsNeedingWarm(25 * 60_000, now + 1000), ["anime3rb.com"]);
  markCfCleared("https://anime3rb.com/", now + 2000);
  assert.equal(isCfBlocked("https://anime3rb.com/", now + 3000), false, "browser clear lifts block");
  assert.deepEqual(hostsNeedingWarm(25 * 60_000, now + 3000), [], "fresh clearance needs no warm");
  assert.deepEqual(hostsNeedingWarm(25 * 60_000, now + 30 * 60_000), ["anime3rb.com"], "refresh before expiry");
  markCfCleared("https://witanime.site/", now);
  assert.deepEqual(hostsNeedingWarm(25 * 60_000, now + 30 * 60_000), ["anime3rb.com"], "never-blocked hosts are not tracked");

  // timing summary
  clearTimings();
  for (const ms of [100, 200, 300, 400, 5000]) recordTiming({ kind: "direct", host: "witanime", ms, outcome: "ok" });
  recordTiming({ kind: "webview", host: "anime3rb", ms: 9000, waitMs: 1000, outcome: "cf" });
  const rows = summarizeTimings();
  assert.equal(rows[0].key, "webview:anime3rb");
  const wit = rows.find((r) => r.key === "direct:witanime")!;
  assert.equal(wit.count, 5);
  assert.equal(wit.p50, 300);
  assert.equal(wit.p90, 5000);
  assert.equal(rows[0].avgWait, 1000);

  console.log("hedge/cfGate/timing tests passed");
}

main().catch((e) => { console.error(e); process.exit(1); });

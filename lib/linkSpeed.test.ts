// Throughput-aware ranking (lib/linkSpeed). Regression for "servers are slow /
// not working": a reachable server on a crawling route must be judged slow,
// siblings on the same crawling box inherit it, and probes are deduped.
import assert from "node:assert";
import {
  __resetSpeedForTests,
  groupHosts,
  groupKey,
  isMeasuring,
  measureServerSpeed,
  progressiveNeedKbps,
  recordSpeed,
  recordUnresponsive,
  serverVerdict,
  subscribeSpeed,
  verdictOf,
} from "./linkSpeed";

async function main() {
  // vid3rb signs 2.4× the bitrate into speed=.
  assert.equal(progressiveNeedKbps("Anime3rb 720p", "https://video.vid3rb.com/video/x?speed=189&token=t"), 79);
  assert.equal(progressiveNeedKbps("Some 1080p", "https://example.com/a.mp4"), 180);

  const now = Date.now();
  assert.equal(verdictOf({ kbps: 79, needKbps: 79, host: "h", at: now }), "slow");
  assert.equal(verdictOf({ kbps: 200, needKbps: 79, host: "h", at: now }), "fast");
  assert.equal(verdictOf({ kbps: 0, needKbps: 164, host: "h", at: now }), "slow");
  assert.equal(verdictOf({ kbps: 50, needKbps: 0, host: "h", at: now }), null);

  // A crawling box drags unmeasured sibling qualities down with it.
  __resetSpeedForTests();
  const s720 = { name: "Anime3rb 720p", iframeUrl: "p720", provider: "vid3rb", source: "anime3rb" };
  const s480 = { name: "Anime3rb 480p", iframeUrl: "p480", provider: "vid3rb", source: "anime3rb" };
  recordSpeed("p720", { kbps: 23, needKbps: 79, host: "files-5.vid3rb.com" });
  const hosts = groupHosts([s720, s480]);
  assert.equal(serverVerdict(s480, hosts.get(groupKey(s480))), "slow");

  // Unresponsive = slow.
  recordUnresponsive("dead");
  assert.equal(serverVerdict({ name: "x", iframeUrl: "dead", provider: "voe" }, null), "slow");

  // measureServerSpeed: in flight synchronously (the picker holds its vid3rb
  // prefetch on this), deduped, cached, notifies on finish.
  __resetSpeedForTests();
  let probes = 0;
  let ticks = 0;
  const off = subscribeSpeed(() => { ticks++; });
  const fakeProbe = async () => { probes++; return { kbps: 300, needKbps: 0, host: "files-2.vid3rb.com" }; };
  const srv = { name: "Anime3rb 720p", iframeUrl: "m720", provider: "vid3rb" };
  const url = "https://video.vid3rb.com/video/x?speed=189";
  const a = measureServerSpeed(srv, url, {}, fakeProbe);
  assert.equal(isMeasuring("m720"), true);
  const b = measureServerSpeed(srv, url, {}, fakeProbe);
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(probes, 1, "concurrent calls share one probe");
  assert.equal(ra?.kbps, 300);
  assert.equal(rb?.needKbps, 79);
  assert.equal(isMeasuring("m720"), false);
  await measureServerSpeed(srv, url, {}, fakeProbe);
  assert.equal(probes, 1, "cached reading is reused");
  assert.ok(ticks >= 1, "listeners hear the reading");
  off();

  // Unmeasurable (probe null / custom scheme) stays unknown, never slow.
  __resetSpeedForTests();
  assert.equal(await measureServerSpeed(srv, url, {}, async () => null), null);
  assert.equal(serverVerdict(srv, null), null);
  assert.equal(await measureServerSpeed(srv, "file:///x.mp4", {}, fakeProbe), null);

  console.log("linkSpeed tests passed");
}

void main().catch((e) => { console.error(e); process.exit(1); });

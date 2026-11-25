// Throughput-aware server ranking (desktop parity: pantoufa-desktop
// src/lib/linkSpeed.ts, v0.13.1).
//
// Discovery proves a stream ANSWERS (probeMediaUrl: a 2-byte Range), not that
// it can keep up. Measured 2026-11-24 on a home connection: vid3rb's file boxes
// at 9-80KB/s (720p needs 78KB/s), hgcloud at 20-65KB/s (needs 283), anime4up's
// CDN at ~21KB/s — while megamax ran at ~1-2MB/s. The picker still pinned
// anime3rb as "recommended", the user tapped it, and sat on "loading". We
// measure what each warmed stream actually delivers and rank the ones that
// can't sustain their bitrate last.
//
// Streaming body reads need expo/fetch (RN's fetch buffers the whole body);
// it ships in every current binary (ScraperHost uses it), so this is OTA-safe.

// Loaded lazily so the pure ranking logic stays testable under Node.
const streamFetch: typeof import("expo/fetch").fetch = (...args) =>
  (require("expo/fetch") as typeof import("expo/fetch")).fetch(...args);

export type SpeedVerdict = "fast" | "slow";

export type SpeedSample = {
  kbps: number;      // measured body throughput, KB/s
  needKbps: number;  // what the stream needs to play in real time, KB/s
  host: string;      // media host (after redirects, when known)
  at: number;
};

// A link at exactly the bitrate still rebuffers on every dip.
export const SPEED_HEADROOM = 1.3;
const SAMPLE_TTL_MS = 15 * 60_000;
// Mobile data is metered: a probe reads at most this much / this long.
const PROBE_MAX_BYTES = 1_500_000;
const PROBE_MS = 6000;
// vid3rb (and others) burst the head of a response, then pace.
const BURST_SKIP_MS = 1500;

const samples = new Map<string, SpeedSample>();
const hostSamples = new Map<string, SpeedSample>();
const inflight = new Map<string, Promise<SpeedSample | null>>();
const listeners = new Set<() => void>();

export function subscribeSpeed(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

function qualityOf(name: string): number {
  const m = /(\d{3,4})p/i.exec(name);
  if (m) return Number(m[1]);
  if (/fhd|1080/i.test(name)) return 1080;
  if (/\bhd\b|720/i.test(name)) return 720;
  if (/\bsd\b|480|360/i.test(name)) return 480;
  return 0;
}

// Runtime of the episode being watched, for turning a file's size into its
// bitrate: the player sets it from saved progress / the player once known.
const DEFAULT_DURATION_SEC = 24 * 60;
let expectedDurationSec = DEFAULT_DURATION_SEC;
export function setExpectedDurationSec(sec: number | null | undefined): void {
  expectedDurationSec = sec && Number.isFinite(sec) && sec > 60 ? sec : DEFAULT_DURATION_SEC;
}

/** KB/s a progressive file needs. vid3rb signs `speed=` = 2.4× the file's
 * average bitrate into its URL (720p speed=189 ↔ 110.7MB / 23.5min).
 * Otherwise file size ÷ runtime is the real average bitrate — the quality
 * label lies (desktop 2026-11-25: an mp4upload "FHD" file was 465MB for
 * 24 min = 323KB/s, not the 180 guessed from "FHD"; a 238KB/s link was ranked
 * fast and stalled every few seconds). The label is the last resort. */
export function progressiveNeedKbps(name: string, videoUrl: string, totalBytes = 0): number {
  const speed = /[?&]speed=(\d+)/.exec(videoUrl);
  if (speed && /vid3rb\.com/i.test(videoUrl)) return Math.max(20, Math.round(Number(speed[1]) / 2.4));
  if (totalBytes > 8_000_000) {
    return Math.min(2500, Math.max(30, Math.round(totalBytes / 1024 / expectedDurationSec)));
  }
  const q = qualityOf(name);
  if (q >= 1080) return 180;
  if (q >= 720) return 90;
  if (q > 0) return 45;
  return 90;
}

function fresh(s: SpeedSample | undefined): s is SpeedSample {
  return !!s && Date.now() - s.at < SAMPLE_TTL_MS;
}

export function verdictOf(sample: SpeedSample | null | undefined): SpeedVerdict | null {
  if (!sample || sample.kbps < 0 || sample.needKbps <= 0) return null;
  return sample.kbps >= sample.needKbps * SPEED_HEADROOM ? "fast" : "slow";
}

/** Graded headroom (desktop parity): pass/fail let a 52KB/s anime3rb file at
 * 2× its bitrate outrank a 1.9MB/s anime4up stream at 20×. great ≥3×,
 * good ≥2×, ok ≥1.3×. */
export type SpeedTier = "great" | "good" | "ok" | "slow";
export function tierOf(sample: SpeedSample | null | undefined): SpeedTier | null {
  if (!sample || sample.kbps < 0 || sample.needKbps <= 0) return null;
  const ratio = sample.kbps / sample.needKbps;
  if (ratio >= 3) return "great";
  if (ratio >= 2) return "good";
  if (ratio >= SPEED_HEADROOM) return "ok";
  return "slow";
}

/** Sort key: proven headroom first, unmeasured in the middle, slow last. */
export function tierRank(tier: SpeedTier | null): number {
  return tier === "great" ? 0 : tier === "good" ? 1 : tier === "ok" ? 2 : tier === "slow" ? 4 : 3;
}

export function speedSampleFor(iframeUrl: string): SpeedSample | null {
  const s = samples.get(iframeUrl);
  return fresh(s) ? s : null;
}

export function hostSample(host: string): SpeedSample | null {
  const s = hostSamples.get(host);
  return fresh(s) ? s : null;
}

export function isMeasuring(iframeUrl: string): boolean {
  return inflight.has(iframeUrl);
}

export function recordSpeed(iframeUrl: string, sample: Omit<SpeedSample, "at">): SpeedSample {
  const full = { ...sample, at: Date.now() };
  samples.set(iframeUrl, full);
  if (full.host) hostSamples.set(full.host, full);
  for (const cb of listeners) { try { cb(); } catch {} }
  return full;
}

/** A resolved stream that didn't even answer the 2-byte reachability probe:
 * rank it last instead of leaving it top-ranked as "unmeasured". */
export function recordUnresponsive(iframeUrl: string): void {
  recordSpeed(iframeUrl, { kbps: 0, needKbps: 1, host: "" });
}

/** Playback itself proved this stream can't keep up (it kept rebuffering).
 * That beats any probe — a probe sees a connection's opening seconds,
 * playback the sustained rate. No host: siblings can live on other boxes. */
export function markPlaybackSlow(iframeUrl: string, needKbps = 1): void {
  const need = Math.max(1, needKbps);
  recordSpeed(iframeUrl, { kbps: Math.round(need * 0.9), needKbps: need, host: "" });
}

/** Media host of the first measured server in each source+provider group —
 * an episode's servers from one provider share a CDN box (vid3rb: all three
 * qualities on the same files-N host). */
export function groupKey(s: { provider: string; source?: string }): string {
  return `${s.source || ""}|${s.provider}`;
}

export function groupHosts(
  servers: readonly { iframeUrl: string; provider: string; source?: string }[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of servers) {
    const key = groupKey(s);
    if (out.has(key)) continue;
    const sample = speedSampleFor(s.iframeUrl);
    if (sample?.host) out.set(key, sample.host);
  }
  return out;
}

/** A host that crawled for ANY of its streams is slow for all of them (the
 * route is the problem and it fluctuates); a fast host is re-judged against
 * each stream's own bitrate. */
export function serverVerdict(
  server: { name: string; iframeUrl: string; provider: string; videoUrl?: string | null },
  groupHost?: string | null,
): SpeedVerdict | null {
  const tier = serverTier(server, groupHost);
  return tier == null ? null : tier === "slow" ? "slow" : "fast";
}

/** Graded counterpart of serverVerdict, same host inheritance. An inherited
 * reading never vouches for more than "ok": the sibling's file is unproven. */
export function serverTier(
  server: { name: string; iframeUrl: string; provider: string; videoUrl?: string | null },
  groupHost?: string | null,
): SpeedTier | null {
  const own = speedSampleFor(server.iframeUrl);
  if (own) return tierOf(own);
  const host = groupHost ? hostSample(groupHost) : null;
  if (!host) return null;
  const hostTier = tierOf(host);
  if (hostTier == null || hostTier === "slow") return hostTier;
  if (server.provider !== "vid3rb" && !server.videoUrl) return "ok";
  return tierOf({ ...host, needKbps: progressiveNeedKbps(server.name, server.videoUrl || "") }) === "slow" ? "slow" : "ok";
}

// ── Measurement ──────────────────────────────────────────────────────────────

type Reader = { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(): Promise<void> };

async function readRate(reader: Reader, deadline: number): Promise<{ bytes: number; kbps: number }> {
  const t0 = Date.now();
  let bytes = 0;
  let markBytes = -1;
  let markAt = 0;
  try {
    while (bytes < PROBE_MAX_BYTES && Date.now() < deadline) {
      const left = deadline - Date.now();
      const chunk = await Promise.race([
        reader.read(),
        new Promise<null>((r) => setTimeout(() => r(null), Math.max(50, left))),
      ]);
      if (!chunk || chunk.done) break;
      bytes += chunk.value?.byteLength || 0;
      if (markBytes < 0 && Date.now() - t0 >= BURST_SKIP_MS) { markBytes = bytes; markAt = Date.now(); }
    }
  } catch {}
  void reader.cancel().catch(() => {});
  const end = Date.now();
  const steady = markBytes >= 0 && end - markAt >= 1000
    ? (bytes - markBytes) / ((end - markAt) / 1000)
    : bytes / (Math.max(1, end - t0) / 1000);
  return { bytes, kbps: Math.round(steady / 1024) };
}

type Probe = { kbps: number; needKbps: number; host: string; hls?: boolean; totalBytes?: number } | null;

const hostOf = (u: string) => { try { return new URL(u).host; } catch { return ""; } };

/** Steady-state throughput of a progressive file or of the first media
 * segment of an HLS stream's lowest variant. A stream that stays silent for
 * the whole window (after discovery proved it reachable) is a zero rate. */
export async function probeThroughput(
  videoUrl: string,
  headers: Record<string, string>,
  isHls: boolean,
): Promise<Probe> {
  const deadline = Date.now() + (isHls ? PROBE_MS + 2000 : PROBE_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(500, deadline - Date.now()));
  let lastHost = hostOf(videoUrl);
  const open = async (url: string, extra: Record<string, string> = {}) => {
    lastHost = hostOf(url);
    const res = await streamFetch(url, { headers: { ...headers, ...extra }, signal: controller.signal });
    if (!(res.ok || res.status === 206)) return null;
    if (res.url) lastHost = hostOf(res.url);
    return res;
  };
  try {
    const first = await open(videoUrl, isHls ? {} : { Range: `bytes=0-${PROBE_MAX_BYTES * 2 - 1}` });
    if (!first) return null;
    let playlistUrl = first.url || videoUrl;
    const ctype = (first.headers.get("content-type") || "").toLowerCase();
    if (!isHls && !/mpegurl/.test(ctype)) {
      if (!first.body) return null;
      // Full file size (Content-Range total) → real bitrate, not the label.
      const total = Number(/\/(\d+)\s*$/.exec(first.headers.get("content-range") || "")?.[1] || 0);
      const { kbps } = await readRate(first.body.getReader() as unknown as Reader, deadline);
      return { kbps, needKbps: 0, host: lastHost, totalBytes: total };
    }
    let text = await first.text();
    let needKbps = 0;
    if (/#EXT-X-STREAM-INF/i.test(text)) {
      const lines = text.split(/\r?\n/);
      let best: { bw: number; uri: string } | null = null;
      for (let i = 0; i < lines.length; i++) {
        const m = /^#EXT-X-STREAM-INF:.*?\bBANDWIDTH=(\d+)/i.exec(lines[i]);
        if (!m) continue;
        const uri = (lines.slice(i + 1).find((l) => l.trim() && !l.startsWith("#")) || "").trim();
        const bw = Number(m[1]);
        if (uri && (!best || bw < best.bw)) best = { bw, uri };
      }
      if (!best) return null;
      needKbps = Math.round(best.bw / 8 / 1024);
      playlistUrl = new URL(best.uri, playlistUrl).toString();
      const media = await open(playlistUrl);
      if (!media) return null;
      if (media.url) playlistUrl = media.url;
      text = await media.text();
    }
    const segs = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    if (!segs.length) return null;
    const segIdx = Math.min(2, segs.length - 1);
    const segUrl = new URL(segs[segIdx], playlistUrl).toString();
    const durs = [...text.matchAll(/#EXTINF:([\d.]+)/gi)].map((m) => Number(m[1]));
    const seg = await open(segUrl);
    if (!seg?.body) return null;
    const total = Number(seg.headers.get("content-length") || 0);
    const { kbps } = await readRate(seg.body.getReader() as unknown as Reader, deadline);
    if (!needKbps && total > 0 && durs[segIdx] > 0) needKbps = Math.round(total / 1024 / durs[segIdx]);
    return { kbps, needKbps: needKbps || 90, hls: true, host: lastHost };
  } catch {
    // Aborted by our own window = the link never delivered in time.
    if (controller.signal.aborted && Date.now() >= deadline - 200) {
      return { kbps: 0, needKbps: isHls ? 90 : 0, hls: isHls, host: lastHost };
    }
    return null;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

// At most two probes at once: parallel probes split a weak link, so every
// server would read slower than it is.
const MAX_PARALLEL_PROBES = 2;
let activeProbes = 0;
const probeQueue: (() => void)[] = [];
async function withProbeSlot<T>(run: () => Promise<T>): Promise<T> {
  if (activeProbes >= MAX_PARALLEL_PROBES) await new Promise<void>((r) => probeQueue.push(r));
  activeProbes++;
  try { return await run(); } finally {
    activeProbes--;
    probeQueue.shift()?.();
  }
}

/** Measure a warmed stream once per embed (deduped, cached 15 min). Registers
 * as in-flight synchronously, so callers can hold conflicting downloads (the
 * picker's vid3rb prefetch — vid3rb 503s a second connection) until it ends.
 * Resolves null when unmeasurable; unknown is never treated as slow. */
export function measureServerSpeed(
  server: { name: string; iframeUrl: string; provider: string },
  videoUrl: string,
  headers: Record<string, string>,
  probe: typeof probeThroughput = probeThroughput,
): Promise<SpeedSample | null> {
  const cached = speedSampleFor(server.iframeUrl);
  if (cached) return Promise.resolve(cached);
  const running = inflight.get(server.iframeUrl);
  if (running) return running;
  if (!/^https?:/i.test(videoUrl)) return Promise.resolve(null);
  const isHls = /\.m3u8(\?|$)/i.test(videoUrl) || server.provider === "anime4upcdn";
  const p = withProbeSlot(() => probe(videoUrl, headers, isHls))
    .then((r) => {
      if (!r) return null;
      const needKbps = r.hls ? (r.needKbps || 90) : progressiveNeedKbps(server.name, videoUrl, r.totalBytes || 0);
      return recordSpeed(server.iframeUrl, { kbps: r.kbps, needKbps, host: r.host });
    })
    .catch(() => null)
    .finally(() => {
      inflight.delete(server.iframeUrl);
      for (const cb of listeners) { try { cb(); } catch {} }
    });
  inflight.set(server.iframeUrl, p);
  return p;
}

export function __resetSpeedForTests(): void {
  samples.clear(); hostSamples.clear(); inflight.clear(); probeQueue.length = 0; activeProbes = 0;
}

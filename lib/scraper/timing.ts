// Scrape timing recorder (Phase 1 of the speed pass).
//
// Every network step the scraper takes — a direct HTML fetch, a hidden-WebView
// job, a video resolve — records how long it took and how it ended. The samples
// live in a small in-memory ring buffer:
//   • /scraper-debug shows the per-step summary (p50/p90, outcome counts), so a
//     device-only slowdown can be read straight off the phone;
//   • once per session a single aggregated row goes to device_logs (see
//     flushTimingSummary), so real-device numbers from every user reach the
//     admin without one row per request.
//
// Pure module: no react-native import, so node tests can load it.

export type TimingKind = "direct" | "webview" | "resolve" | "cf-warm";
export type TimingOutcome = "ok" | "cf" | "timeout" | "http" | "error" | "empty" | "cancelled" | "skipped";

export type TimingSample = {
  kind: TimingKind;
  /** Source label (witanime/anime4up/anime3rb/…) or hostname. */
  host: string;
  ms: number;
  outcome: TimingOutcome;
  /** WebView only: time the job sat in the queue before a slot took it. */
  waitMs?: number;
  at: number;
};

const MAX_SAMPLES = 300;
const samples: TimingSample[] = [];

export function hostLabel(url: string): string {
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (h.includes("witanime")) return "witanime";
    if (h.includes("anime4up")) return "anime4up";
    if (h.includes("vid3rb")) return "vid3rb";
    if (h.includes("anime3rb")) return "anime3rb";
    return h.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

export function recordTiming(sample: Omit<TimingSample, "at">): void {
  samples.push({ ...sample, ms: Math.max(0, Math.round(sample.ms)), at: Date.now() });
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    // eslint-disable-next-line no-console
    console.log(`[timing] ${sample.kind} ${sample.host} ${sample.outcome} ${Math.round(sample.ms)}ms${sample.waitMs ? ` (queued ${sample.waitMs}ms)` : ""}`);
  }
}

/** Convenience: time a promise-returning step. `classify` maps the result to an outcome. */
export async function timed<T>(
  kind: TimingKind,
  host: string,
  run: () => Promise<T>,
  classify: (value: T) => TimingOutcome = (v) => (v == null ? "empty" : "ok"),
): Promise<T> {
  const start = Date.now();
  try {
    const value = await run();
    recordTiming({ kind, host, ms: Date.now() - start, outcome: classify(value) });
    return value;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    recordTiming({ kind, host, ms: Date.now() - start, outcome: /cancel|supersed/i.test(msg) ? "cancelled" : /timeout/i.test(msg) ? "timeout" : "error" });
    throw e;
  }
}

export function getTimings(): readonly TimingSample[] {
  return samples;
}

export function clearTimings(): void {
  samples.length = 0;
}

export type TimingRow = {
  key: string;
  kind: TimingKind;
  host: string;
  count: number;
  p50: number;
  p90: number;
  max: number;
  avgWait: number;
  outcomes: Partial<Record<TimingOutcome, number>>;
};

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

/** Per (kind, host) summary, slowest p90 first. */
export function summarizeTimings(input: readonly TimingSample[] = samples): TimingRow[] {
  const groups = new Map<string, TimingSample[]>();
  for (const s of input) {
    const key = `${s.kind}:${s.host}`;
    const g = groups.get(key);
    if (g) g.push(s);
    else groups.set(key, [s]);
  }
  const rows: TimingRow[] = [];
  for (const [key, g] of groups) {
    const ms = g.map((s) => s.ms).sort((a, b) => a - b);
    const waits = g.filter((s) => s.waitMs != null).map((s) => s.waitMs!);
    const outcomes: Partial<Record<TimingOutcome, number>> = {};
    for (const s of g) outcomes[s.outcome] = (outcomes[s.outcome] || 0) + 1;
    rows.push({
      key,
      kind: g[0].kind,
      host: g[0].host,
      count: g.length,
      p50: percentile(ms, 50),
      p90: percentile(ms, 90),
      max: ms[ms.length - 1],
      avgWait: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : 0,
      outcomes,
    });
  }
  return rows.sort((a, b) => b.p90 - a.p90);
}

// ── Remote summary (one row per session window) ──────────────────────────────

const FLUSH_EVERY_MS = 30 * 60_000;
let lastFlushAt = 0;
let lastFlushedCount = 0;

/** Ship the aggregated summary to device_logs at most once per 30 minutes,
 *  and only when there are new samples. Called when the app goes to the background. */
export function flushTimingSummary(log: (message: string, context: Record<string, unknown>) => void): void {
  const now = Date.now();
  if (now - lastFlushAt < FLUSH_EVERY_MS) return;
  if (samples.length < 5 || samples.length === lastFlushedCount) return;
  lastFlushAt = now;
  lastFlushedCount = samples.length;
  const rows = summarizeTimings().slice(0, 20).map((r) => ({
    k: r.key, n: r.count, p50: r.p50, p90: r.p90, max: r.max, wait: r.avgWait || undefined, out: r.outcomes,
  }));
  log("scrape timing summary", { rows });
}

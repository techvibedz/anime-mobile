// Singleton job bus for in-app scraping.
//
// React component <ScraperHost> mounts N hidden WebView slots and pulls jobs
// from this bus. Multiple jobs run concurrently (one per slot). Callers use
// `enqueue()` and await the result.

import { getSourceCandidates } from "./sourceDomains";
import { hostLabel, recordTiming, type TimingOutcome } from "./timing";
import { markCfCleared } from "./cfGate";

export type ScrapeJob = {
  id: string;
  url: string;
  urls: string[];
  // JS injected BEFORE document starts loading (for fetch/XHR hooks).
  injectBefore?: string;
  // JS injected AFTER document loads — must call postMessage with the result.
  injectAfter: string;
  // Hard timeout in ms.
  timeoutMs: number;
  // User-facing video extraction jumps ahead of background scrape jobs.
  priority?: boolean;
  // Inject scripts into every frame (not just the main one). Used by video
  // extraction so nested player iframes (videa intermediaries) get hooked.
  allFrames?: boolean;
};

type Pending = {
  job: ScrapeJob;
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  enqueuedAt: number;
  claimedAt?: number;
};

function classifyFailure(message: string): TimingOutcome {
  if (/cancel|supersed/i.test(message)) return "cancelled";
  if (/timeout|timed out/i.test(message)) return "timeout";
  if (/challenge/i.test(message)) return "cf";
  if (/HTTP \d/.test(message)) return "http";
  return "error";
}

function recordJob(p: Pending, outcome: TimingOutcome) {
  const now = Date.now();
  const start = p.claimedAt ?? now;
  recordTiming({
    kind: p.job.injectBefore || p.job.allFrames ? "resolve" : "webview",
    host: hostLabel(p.job.url),
    ms: now - start,
    waitMs: start - p.enqueuedAt,
    outcome,
  });
}

let _seq = 0;
const _queue: Pending[] = [];
const _inFlight = new Map<string, Pending>(); // job id → pending
const _cancelled = new Set<string>();
let _onChange: (() => void) | null = null;

// Rapid-navigation backlog guard. Each detail/watch screen enqueues background
// scrape jobs; hopping through many pages quickly piles up jobs for screens the
// user has already left, and because the WebView slots are finite those dead
// jobs starve the CURRENT screen's scrape — the app "gets stuck". When the
// non-priority backlog exceeds this, the OLDEST background job (almost certainly
// from an abandoned screen) is dropped so the freshest screen's work runs soon.
// Priority (user-initiated video) jobs are never dropped. Callers treat a
// rejection as a soft miss (cancelled flags / .catch), so this only degrades
// already-abandoned requests.
const MAX_BG_QUEUE = 12;

export function _subscribe(cb: () => void) {
  _onChange = cb;
  return () => { _onChange = null; };
}

/** Pull the next pending job and mark it as in-flight. Priority (video)
 *  jobs are pulled ahead of background scrape jobs. */
export function _claimNext(): Pending | null {
  let idx = _queue.findIndex((p) => p.job.priority);
  if (idx === -1) idx = 0;
  const next = _queue.splice(idx, 1)[0];
  if (!next) return null;
  next.claimedAt = Date.now();
  _inFlight.set(next.job.id, next);
  return next;
}

export function _hasPending(): boolean {
  return _queue.length > 0;
}

/** The job _claimNext would pull next, without pulling it. Lets the host
 *  reserve capacity for priority jobs (see ScraperHost). */
export function _peek(): ScrapeJob | null {
  let idx = _queue.findIndex((p) => p.job.priority);
  if (idx === -1) idx = 0;
  return _queue[idx]?.job ?? null;
}

export function _resolve(id: string, value: any) {
  const p = _inFlight.get(id);
  if (!p) return;
  _inFlight.delete(id);
  recordJob(p, value == null ? "empty" : "ok");
  // A real browser just completed a page here, so the shared cookie jar holds
  // a fresh Cloudflare clearance: let the direct path try this host again.
  for (const u of p.job.urls.length ? p.job.urls : [p.job.url]) markCfCleared(u);
  p.resolve(value);
  _onChange?.();
}

export function _reject(id: string, message: string) {
  const p = _inFlight.get(id);
  if (!p) return;
  _inFlight.delete(id);
  recordJob(p, classifyFailure(message));
  p.reject(new Error(message));
  _onChange?.();
}

/** Drop work that was only warming/discovering servers. Priority jobs are
 * explicit user selections and must survive. */
export function _cancelBackground() {
  const message = "cancelled: playback selected";
  for (let i = _queue.length - 1; i >= 0; i--) {
    if (_queue[i].job.priority) continue;
    const [pending] = _queue.splice(i, 1);
    pending.reject(new Error(message));
  }
  for (const [id, pending] of _inFlight) {
    if (pending.job.priority) continue;
    _inFlight.delete(id);
    _cancelled.add(id);
    pending.reject(new Error(message));
  }
  _onChange?.();
}

export function _isCancelled(id: string): boolean {
  return _cancelled.has(id);
}

export function _consumeCancelled(id: string): boolean {
  return _cancelled.delete(id);
}

/** Cancel one job (queued or running). Its promise rejects with "cancelled". */
function cancelJob(id: string, message: string) {
  const qi = _queue.findIndex((p) => p.job.id === id);
  if (qi >= 0) {
    const [pending] = _queue.splice(qi, 1);
    pending.reject(new Error(message));
    _onChange?.();
    return;
  }
  const running = _inFlight.get(id);
  if (!running) return;
  _inFlight.delete(id);
  _cancelled.add(id);
  recordJob(running, "cancelled");
  running.reject(new Error(message));
  _onChange?.();
}

export async function enqueue(job: Omit<ScrapeJob, "id" | "urls">, signal?: AbortSignal): Promise<any> {
  if (signal?.aborted) throw new Error("cancelled: aborted before start");
  // A priority job is user-initiated (opening an episode / tapping a server).
  // Free the in-flight background slots it would otherwise wait behind — the
  // host only reserves one slot, so 3 long background scrapes could still delay
  // playback by their full timeouts. Background callers already treat rejection
  // as a soft miss.
  // Discovery also uses the reserved slot. Only the playback collector
  // (allFrames) interrupts work already loading in the other source browsers.
  if (job.priority && job.allFrames) _cancelBackground();
  const id = `s${++_seq}`;
  const urls = await getSourceCandidates(job.url);
  if (signal?.aborted) throw new Error("cancelled: aborted before start");
  return new Promise((resolve, reject) => {
    const entry: Pending = { job: { ...job, urls, id }, resolve, reject, enqueuedAt: Date.now() };
    // Hedged callers (see hedge.ts) abort the WebView job once the direct
    // fetch wins, so the slot goes back to work instead of finishing a page
    // nobody is waiting for.
    signal?.addEventListener("abort", () => cancelJob(id, "cancelled: superseded"), { once: true });
    if (job.priority) {
      // Place ahead of any non-priority jobs already queued.
      const at = _queue.findIndex((p) => !p.job.priority);
      if (at === -1) _queue.push(entry);
      else _queue.splice(at, 0, entry);
    } else {
      _queue.push(entry);
      // Shed the oldest background job(s) once the backlog is too deep, so a
      // flood of abandoned-screen scrapes can't block the current screen.
      let bg = _queue.reduce((n, p) => n + (p.job.priority ? 0 : 1), 0);
      while (bg > MAX_BG_QUEUE) {
        const oldIdx = _queue.findIndex((p) => !p.job.priority);
        if (oldIdx === -1) break;
        const [dropped] = _queue.splice(oldIdx, 1);
        dropped.reject(new Error("superseded: scrape queue overflow"));
        bg--;
      }
    }
    _onChange?.();
  });
}

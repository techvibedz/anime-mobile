// Singleton job bus for in-app scraping.
//
// React component <ScraperHost> mounts N hidden WebView slots and pulls jobs
// from this bus. Multiple jobs run concurrently (one per slot). Callers use
// `enqueue()` and await the result.

export type ScrapeJob = {
  id: string;
  url: string;
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
};

let _seq = 0;
const _queue: Pending[] = [];
const _inFlight = new Map<string, Pending>(); // job id → pending
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
  _inFlight.set(next.job.id, next);
  return next;
}

export function _hasPending(): boolean {
  return _queue.length > 0;
}

export function _resolve(id: string, value: any) {
  const p = _inFlight.get(id);
  if (!p) return;
  _inFlight.delete(id);
  p.resolve(value);
  _onChange?.();
}

export function _reject(id: string, message: string) {
  const p = _inFlight.get(id);
  if (!p) return;
  _inFlight.delete(id);
  p.reject(new Error(message));
  _onChange?.();
}

export function enqueue(job: Omit<ScrapeJob, "id">): Promise<any> {
  const id = `s${++_seq}`;
  return new Promise((resolve, reject) => {
    const entry = { job: { ...job, id }, resolve, reject };
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

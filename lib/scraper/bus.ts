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

export function _subscribe(cb: () => void) {
  _onChange = cb;
  return () => { _onChange = null; };
}

/** Pull the next pending job and mark it as in-flight. */
export function _claimNext(): Pending | null {
  const next = _queue.shift();
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
    _queue.push({ job: { ...job, id }, resolve, reject });
    _onChange?.();
  });
}

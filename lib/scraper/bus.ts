// Singleton job bus for in-app scraping.
// React component <ScraperHost> subscribes to `_pending` and processes jobs
// serially in a hidden WebView. Callers use `enqueue()` and await the result.

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
let _onChange: (() => void) | null = null;

export function _subscribe(cb: () => void) {
  _onChange = cb;
  return () => { _onChange = null; };
}

export function _peek(): Pending | null {
  return _queue[0] ?? null;
}

export function _resolveCurrent(id: string, value: any) {
  const head = _queue[0];
  if (!head || head.job.id !== id) return;
  _queue.shift();
  head.resolve(value);
  _onChange?.();
}

export function _rejectCurrent(id: string, message: string) {
  const head = _queue[0];
  if (!head || head.job.id !== id) return;
  _queue.shift();
  head.reject(new Error(message));
  _onChange?.();
}

export function enqueue(job: Omit<ScrapeJob, "id">): Promise<any> {
  const id = `s${++_seq}`;
  return new Promise((resolve, reject) => {
    _queue.push({ job: { ...job, id }, resolve, reject });
    _onChange?.();
  });
}

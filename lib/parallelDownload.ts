// Segmented, multi-connection file download (see lib/parallelDownloadPlan.ts
// for why). Each byte range is fetched by expo-file-system's native downloader
// into its own part file; finished parts are appended IN ORDER to a `.part`
// output and deleted, so disk use stays ~concurrency × chunk size. The output
// is renamed to its final name only after every byte arrived, so a killed app
// never leaves a half-written file that looks complete.
//
// Pure JS over modules already in the APK (legacy resumable downloader + the
// File API's append write) → ships over OTA. Throws NoRangeSupport when the
// host ignores Range so the caller can fall back to a single stream.

import * as FileSystem from "expo-file-system/legacy";
import { File } from "expo-file-system";
import {
  type Chunk,
  isBusyStatus,
  parseContentRangeTotal,
  planChunks,
  retryDelayMs,
} from "./parallelDownloadPlan";

export class NoRangeSupport extends Error {
  constructor() { super("host does not support byte ranges"); }
}
export class DownloadCancelled extends Error {
  constructor() { super("cancelled"); }
}

export interface ParallelDownloadHandle {
  cancelAsync(): Promise<void>;
}

export interface ParallelDownloadOptions {
  url: string;
  headers: Record<string, string>;
  /** Final file:// destination. */
  dest: string;
  concurrency: number;
  onProgress?: (written: number, total: number) => void;
  /** Receives a handle the caller can use to cancel. */
  onHandle?: (handle: ParallelDownloadHandle) => void;
}

const MAX_ATTEMPTS = 8;
/** "Too many connections" answers tolerated per chunk when it's the last worker. */
const MAX_BUSY_ATTEMPTS = 40;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Total size via a 1-byte range request; 0 = ranges unsupported/unknown. */
async function probeTotal(url: string, headers: Record<string, string>): Promise<number> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: { ...headers, Range: "bytes=0-0" } });
      if (res.status === 206) return parseContentRangeTotal(res.headers.get("content-range"));
      if (isBusyStatus(res.status)) { await sleep(retryDelayMs(attempt, true)); continue; }
      return 0;
    } catch {
      await sleep(retryDelayMs(attempt, false));
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
  return 0;
}

export function parallelDownloadAvailable(): boolean {
  try {
    return typeof File === "function" && typeof (File.prototype as any).write === "function";
  } catch {
    return false;
  }
}

export async function parallelDownload(opts: ParallelDownloadOptions): Promise<{ uri: string; bytes: number }> {
  const { url, headers, dest } = opts;
  const total = await probeTotal(url, headers);
  if (!total) throw new NoRangeSupport();

  const chunks = planChunks(total);
  const partDir = `${dest}.parts/`;
  const outUri = `${dest}.part`;
  await FileSystem.deleteAsync(partDir, { idempotent: true }).catch(() => {});
  await FileSystem.deleteAsync(outUri, { idempotent: true }).catch(() => {});
  await FileSystem.makeDirectoryAsync(partDir, { intermediates: true });
  const out = new File(outUri);
  out.create({ overwrite: true });

  let cancelled = false;
  let failure: Error | null = null;
  const live = new Set<ReturnType<typeof FileSystem.createDownloadResumable>>();
  const inFlight = new Map<number, number>();
  let doneBytes = 0;
  const report = () => {
    let written = doneBytes;
    for (const v of inFlight.values()) written += v;
    opts.onProgress?.(Math.min(written, total), total);
  };

  opts.onHandle?.({
    async cancelAsync() {
      cancelled = true;
      await Promise.all([...live].map((r) => r.cancelAsync().catch(() => {})));
    },
  });

  // In-order merge: parts that finish early wait until their predecessors land.
  const finished = new Set<number>();
  let merged = 0;
  let merging: Promise<void> = Promise.resolve();
  const mergeReady = () => {
    merging = merging.then(async () => {
      while (!cancelled && !failure && finished.has(merged)) {
        const part = new File(`${partDir}${merged}`);
        const bytes = await part.bytes();
        out.write(bytes, { append: true });
        try { part.delete(); } catch {}
        finished.delete(merged);
        merged++;
      }
    }).catch((e) => { failure = e instanceof Error ? e : new Error(String(e)); });
  };

  let activeWorkers = Math.max(1, opts.concurrency);
  /** "ok" = chunk stored; "yield" = host is out of connection slots (e.g. the
   *  player streams the same file) → hand the chunk back, run one fewer worker. */
  const fetchChunk = async (c: Chunk): Promise<"ok" | "yield"> => {
    const expected = c.end - c.start + 1;
    const partUri = `${partDir}${c.index}`;
    let failures = 0;
    let busyRun = 0;
    for (let attempt = 0; failures < MAX_ATTEMPTS && attempt < MAX_BUSY_ATTEMPTS; attempt++) {
      if (cancelled) throw new DownloadCancelled();
      if (failure) throw failure;
      inFlight.set(c.index, 0);
      const resumable = FileSystem.createDownloadResumable(
        url,
        partUri,
        { headers: { ...headers, Range: `bytes=${c.start}-${c.end}` } },
        (p) => {
          inFlight.set(c.index, Math.min(expected, p.totalBytesWritten));
          report();
        },
      );
      live.add(resumable);
      let status = 0;
      try {
        const res = await resumable.downloadAsync();
        status = res?.status ?? 0;
      } catch {
        status = 0;
      } finally {
        live.delete(resumable);
        inFlight.delete(c.index);
      }
      if (cancelled) throw new DownloadCancelled();
      if (status === 200 && c.start === 0 && expected < total) throw new NoRangeSupport();
      if (status === 206) {
        const info = await FileSystem.getInfoAsync(partUri);
        if (info.exists && "size" in info && info.size === expected) {
          doneBytes += expected;
          report();
          finished.add(c.index);
          mergeReady();
          return "ok";
        }
      }
      await FileSystem.deleteAsync(partUri, { idempotent: true }).catch(() => {});
      report();
      const busy = isBusyStatus(status);
      if (busy) {
        busyRun++;
        if (busyRun >= 3 && activeWorkers > 1) return "yield";
      } else {
        busyRun = 0;
        failures++;
      }
      await sleep(retryDelayMs(Math.min(attempt, 5), busy));
    }
    throw new Error(`chunk ${c.index} failed`);
  };

  const queue = [...chunks];
  const worker = async (slot: number) => {
    // Stagger starts so a host's per-IP connection limit isn't hit in one burst.
    if (slot > 0) await sleep(400 * slot);
    try {
      while (!cancelled && !failure) {
        // Don't race far ahead of the merge — bounds the parts kept on disk.
        // The queue stays sorted (a handed-back chunk is always the lowest
        // pending one), so waiting on queue[0] can never block on itself.
        while (!cancelled && !failure && queue.length > 0 && queue[0].index - merged > opts.concurrency * 3) {
          await sleep(200);
        }
        const c = queue.shift();
        if (!c) return;
        try {
          if ((await fetchChunk(c)) === "yield") {
            queue.unshift(c);
            return;
          }
        } catch (e) {
          if (!failure) failure = e instanceof Error ? e : new Error(String(e));
          // Stop siblings promptly.
          await Promise.all([...live].map((r) => r.cancelAsync().catch(() => {})));
          return;
        }
      }
    } finally {
      activeWorkers--;
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.max(1, opts.concurrency) }, (_, i) => worker(i)));
    // A chunk handed back just as its sibling ran out of work: finish it solo.
    while (queue.length > 0 && !cancelled && !failure) {
      activeWorkers = 1;
      await worker(0);
    }
    await merging;
    if (cancelled) throw new DownloadCancelled();
    if (failure) throw failure;
    if (merged !== chunks.length) throw new Error("incomplete download");
    const info = await FileSystem.getInfoAsync(outUri);
    if (!info.exists || !("size" in info) || info.size !== total) throw new Error("size mismatch");
    await FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => {});
    await FileSystem.moveAsync({ from: outUri, to: dest });
    return { uri: dest, bytes: total };
  } catch (e) {
    await FileSystem.deleteAsync(outUri, { idempotent: true }).catch(() => {});
    throw e;
  } finally {
    await FileSystem.deleteAsync(partDir, { idempotent: true }).catch(() => {});
  }
}

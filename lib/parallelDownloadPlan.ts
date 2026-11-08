// Pure planning helpers for segmented (multi-connection) episode downloads.
//
// Video hosts throttle EACH connection, not the client: anime3rb's vid3rb CDN
// signs a `speed=<KB/s>` cap into every URL (~825 KB/s for 1080p, verified
// 2026-11-08) and rejects edits to it, so one stream crawls no matter how fast
// the phone's internet is. Splitting the file into byte ranges fetched over a
// few parallel connections multiplies the throughput. vid3rb allows 2
// concurrent connections per file (a 3rd gets 503), other hosts get more.

export interface Chunk {
  index: number;
  start: number;
  /** Inclusive end byte. */
  end: number;
}

export const CHUNK_SIZE = 8 * 1024 * 1024;

export function planChunks(total: number, chunkSize = CHUNK_SIZE): Chunk[] {
  if (!Number.isFinite(total) || total <= 0 || chunkSize <= 0) return [];
  const out: Chunk[] = [];
  for (let start = 0, index = 0; start < total; start += chunkSize, index++) {
    out.push({ index, start, end: Math.min(total, start + chunkSize) - 1 });
  }
  return out;
}

/** Total size from a `Content-Range: bytes 0-0/12345` header, or 0 if unknown. */
export function parseContentRangeTotal(header: string | null | undefined): number {
  const m = String(header || "").match(/bytes\s+\d+-\d+\/(\d+)/i);
  const n = m ? Number(m[1]) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Parallel connections per host. vid3rb answers a 3rd concurrent range with 503. */
export function concurrencyFor(provider: string | undefined): number {
  const p = String(provider || "").toLowerCase();
  if (p === "vid3rb") return 2;
  return 4;
}

/** Status codes that mean "too many connections right now — back off and retry". */
export function isBusyStatus(status: number): boolean {
  return status === 503 || status === 429 || status === 509;
}

/** Backoff before retrying a chunk, growing with attempts, capped at 8s. */
export function retryDelayMs(attempt: number, busy: boolean): number {
  const base = busy ? 1500 : 800;
  return Math.min(8000, base * (attempt + 1));
}

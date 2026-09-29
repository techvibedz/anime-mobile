export function mapNativeDownload(job: {
  status: number;
  bytes: number;
  totalBytes: number;
  localUri: string | null;
  validMp4: boolean;
}) {
  const progress = job.totalBytes > 0 ? Math.min(1, job.bytes / job.totalBytes) : 0;
  if (job.status === 8) {
    return job.localUri && job.validMp4
      ? { status: "completed" as const, progress: 1 }
      : { status: "failed" as const, progress };
  }
  if (job.status === 16) return { status: "failed" as const, progress };
  return { status: "downloading" as const, progress };
}

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Decode the first `maxBytes` of a base64 payload into a latin1 string. */
export function base64PrefixToLatin1(b64: string, maxBytes: number): string {
  const lookup: Record<string, number> = {};
  for (let i = 0; i < B64_ALPHABET.length; i++) lookup[B64_ALPHABET[i]] = i;
  const clean = String(b64 || "").replace(/[^A-Za-z0-9+/]/g, "");
  let out = "";
  for (let i = 0; i < clean.length && out.length < maxBytes; i += 4) {
    const e1 = lookup[clean[i]], e2 = lookup[clean[i + 1]], e3 = lookup[clean[i + 2]], e4 = lookup[clean[i + 3]];
    if (e1 === undefined || e2 === undefined) break;
    out += String.fromCharCode((e1 << 2) | (e2 >> 4));
    if (e3 !== undefined) out += String.fromCharCode(((e2 & 15) << 4) | (e3 >> 2));
    if (e4 !== undefined) out += String.fromCharCode(((e3 & 3) << 6) | e4);
  }
  return out.slice(0, maxBytes);
}

/**
 * True when the first bytes of an MP4 header carry the `ftyp` box brand at
 * offset 4 (same check the native module runs). The previous JS check searched
 * the base64 TEXT for "ZnR5cA": base64 works in 6-bit groups, so "ftyp" is only
 * contiguous in the encoded text when it starts on a 3-byte boundary — at
 * offset 4 it never is. Every completed JS-side download was therefore rejected
 * and deleted at 100%.
 */
export function isMp4Header(base64Header: string): boolean {
  const head = base64PrefixToLatin1(base64Header, 12);
  return head.length >= 8 && head.slice(4, 8) === "ftyp";
}

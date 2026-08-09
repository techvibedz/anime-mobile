import AsyncStorage from "@react-native-async-storage/async-storage";

export type SourceId = "witanime" | "anime4up" | "anime3rb";
export type SourceFailure = "dns" | "network" | "timeout" | "ssl" | "http" | "cloudflare" | "invalid-content";

export const SOURCE_DOMAINS: Record<SourceId, readonly string[]> = {
  witanime: ["witanime.you", "witanime.life", "witanime.cyou"],
  anime4up: ["w1.anime4up.rest", "anime4up.rest"],
  anime3rb: ["anime3rb.com", "www.anime3rb.com"],
};

const PREFERENCE_MS = 30 * 60 * 1000;
const preferenceKey = (source: SourceId) => `@source_host_${source}_v1`;

export function identifySource(rawUrl: string): SourceId | null {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return (Object.keys(SOURCE_DOMAINS) as SourceId[]).find((source) =>
      SOURCE_DOMAINS[source].includes(host),
    ) ?? null;
  } catch {
    return null;
  }
}

export function rewriteToCandidate(rawUrl: string, candidateUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const candidate = new URL(candidateUrl);
    url.protocol = candidate.protocol;
    url.host = candidate.host;
    return url.toString();
  } catch {
    return rawUrl;
  }
}

export function sourceCandidates(rawUrl: string, preferredHost?: string | null): string[] {
  const source = identifySource(rawUrl);
  if (!source) return [rawUrl];
  const current = new URL(rawUrl);
  const hosts = SOURCE_DOMAINS[source];
  const order = [preferredHost, current.hostname, ...hosts].filter(
    (host, index, all): host is string => !!host && hosts.includes(host) && all.indexOf(host) === index,
  );
  return order.map((host) => rewriteToCandidate(rawUrl, `https://${host}`));
}

export function candidateForAttempt(candidates: readonly string[], attempt: number): string {
  return candidates[(attempt - 1) % candidates.length];
}

export function nextCandidateIndex(current: number, total: number): number | null {
  return current + 1 < total ? current + 1 : null;
}

export function preferredHostFromValue(
  raw: string | null,
  source: SourceId,
  now = Date.now(),
): string | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { host?: string; expiresAt?: number };
    return typeof value.host === "string" &&
      SOURCE_DOMAINS[source].includes(value.host) &&
      typeof value.expiresAt === "number" && value.expiresAt > now
      ? value.host
      : null;
  } catch {
    return null;
  }
}

export async function getSourceCandidates(rawUrl: string): Promise<string[]> {
  const source = identifySource(rawUrl);
  if (!source) return [rawUrl];
  let preferred: string | null = null;
  try {
    preferred = preferredHostFromValue(await AsyncStorage.getItem(preferenceKey(source)), source);
  } catch {
    // Storage is an optimization; routing still works without it.
  }
  return sourceCandidates(rawUrl, preferred);
}

export async function markSourceHealthy(rawUrl: string): Promise<void> {
  const source = identifySource(rawUrl);
  if (!source) return;
  const host = new URL(rawUrl).hostname.toLowerCase();
  await AsyncStorage.setItem(preferenceKey(source), JSON.stringify({
    host,
    expiresAt: Date.now() + PREFERENCE_MS,
  }));
}

export async function clearSourcePreference(rawUrl: string): Promise<void> {
  const source = identifySource(rawUrl);
  if (source) await AsyncStorage.removeItem(preferenceKey(source));
}

const SOURCE_MARKERS: Record<SourceId, RegExp> = {
  witanime: /anime-card-container|episodes-card-container|lucodeia-slider-slide-item|وايت\s*انمي|witanime/i,
  anime4up: /anime-card-container|episode-servers|انمي\s*فور\s*اب|anime4up/i,
  anime3rb: /anime3rb|itemListElement|\/titles\/|انمي\s*عرب/i,
};

export function isValidSourceHtml(source: SourceId, html: string): boolean {
  return SOURCE_MARKERS[source].test(html);
}

export function isRetryableSourceStatus(status: number): boolean {
  return status === 403 || status === 429 || status >= 500;
}

/** Android WebView reports HTTP failures for subresources too. Only a failure
 * for the active document should reject the scrape. */
export function isTopLevelWebViewError(errorUrl: string | undefined, topLevelUrl: string): boolean {
  if (!errorUrl) return true;
  try {
    const failed = new URL(errorUrl);
    const page = new URL(topLevelUrl);
    failed.hash = "";
    page.hash = "";
    return failed.href === page.href;
  } catch {
    return errorUrl === topLevelUrl;
  }
}

export function classifySourceFailure(message: string, statusCode?: number): SourceFailure {
  const text = message.toLowerCase();
  if (statusCode === 403 || statusCode === 429 || statusCode === 503 || /cloudflare|challenge/.test(text)) return "cloudflare";
  if (/ssl|certificate|cert_|handshake/.test(text)) return "ssl";
  if (/name_not_resolved|unknownhost|dns|nxdomain|resolve host/.test(text)) return "dns";
  if (/timeout|timed out|abort/.test(text)) return "timeout";
  if (statusCode || /http \d{3}/.test(text)) return "http";
  if (/invalid|unexpected content/.test(text)) return "invalid-content";
  return "network";
}

export type ProviderFailureMode = "failed" | "webview";
export type ProviderResolution = "direct" | "directThenWebView" | "webview";

export type ProviderPolicy = {
  patterns: string[];
  rank: number;
  resolution: ProviderResolution;
  failureMode: ProviderFailureMode;
  supported: boolean;
  downloadable?: boolean;
};

export const VIDEO_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

export function createGenerationGuard() {
  let current = 0;
  return {
    next: () => ++current,
    isCurrent: (generation: number) => generation === current,
  };
}

export function episodeNumberFromUrl(raw: string): number | null {
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch {}
  const match = decoded.match(/الحلقة[\s_-]*(\d+)/) || decoded.match(/\/episode\/[^/]+\/(\d+)(?:\/|$)/i);
  return match ? parseInt(match[1], 10) : null;
}

export function anime4upEpisodeUrl(title: string, episodeNumber: number): string | null {
  const slug = String(title || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `https://w1.anime4up.rest/episode/انمي-${slug}-الحلقة-${episodeNumber}-مترجمة/` : null;
}

export function preferredAnime4upEpisodeUrl(explicit?: string | null, harvested?: string | null): string | null {
  return explicit || harvested || null;
}

// Ordered: specific aliases must match before the generic fallback.
export const PROVIDER_POLICIES: Record<string, ProviderPolicy> = {
  anime4upcdn: { patterns: ["anime4up-s\\d", "z4m2r9t\\.shop"], rank: 0, resolution: "directThenWebView", failureMode: "failed", supported: true },
  mp4upload: { patterns: ["mp4upload"], rank: 1, resolution: "directThenWebView", failureMode: "failed", supported: true, downloadable: true },
  dailymotion: { patterns: ["dailymotion", "dai\\.ly"], rank: 0, resolution: "directThenWebView", failureMode: "failed", supported: true },
  streamwish: { patterns: ["streamwish", "hlswish", "wishembed", "wishfast", "hgcloud", "jwembed", "vibuxer", "audinifer", "masukestin", "hanerix", "playerwish"], rank: 2, resolution: "directThenWebView", failureMode: "failed", supported: true },
  voe: { patterns: ["voe\\."], rank: 4, resolution: "directThenWebView", failureMode: "failed", supported: true },
  share4max: { patterns: ["share4max", "megamax"], rank: 7, resolution: "directThenWebView", failureMode: "failed", supported: true },
  streamruby: { patterns: ["rubyvidhub", "streamruby", "rubystm", "ruby"], rank: 7, resolution: "directThenWebView", failureMode: "failed", supported: true },
  doodstream: { patterns: ["doodstream", "dood\\.", "dsvplay", "d-s\\.io", "vidply", "ds2play", "ds2video", "d0o0d", "do0od", "all3do", "doply", "playmogo"], rank: 5, resolution: "directThenWebView", failureMode: "failed", supported: true },
  uqload: { patterns: ["uqload"], rank: 8, resolution: "directThenWebView", failureMode: "failed", supported: true },
  okru: { patterns: ["ok\\.ru", "odnoklassniki"], rank: 6, resolution: "directThenWebView", failureMode: "failed", supported: true },
  videas: { patterns: ["app\\.videas\\.fr"], rank: 3, resolution: "directThenWebView", failureMode: "failed", supported: true },
  videa: { patterns: ["videa\\.", "vidvaita", "vidit", "videakid"], rank: 3, resolution: "directThenWebView", failureMode: "failed", supported: true },
  vk: { patterns: ["vk\\.com"], rank: 11, resolution: "webview", failureMode: "webview", supported: true },
  mega: { patterns: ["mega\\.nz"], rank: 12, resolution: "webview", failureMode: "webview", supported: true },
  vid3rb: { patterns: ["vid3rb", "anime3rb"], rank: -1, resolution: "direct", failureMode: "failed", supported: true, downloadable: true },
  luluvdo: { patterns: ["luluvdo", "lulustream", "luluvid"], rank: 9, resolution: "directThenWebView", failureMode: "failed", supported: true },
  yonaplay: { patterns: ["yonaplay"], rank: 99, resolution: "webview", failureMode: "failed", supported: false },
  generic: { patterns: [], rank: 10, resolution: "webview", failureMode: "webview", supported: true },
};

const PROVIDER_ENTRIES = Object.entries(PROVIDER_POLICIES).filter(([id]) => id !== "generic");

export function classifyProvider(url: string): string {
  const value = String(url || "").toLowerCase();
  for (const [id, policy] of PROVIDER_ENTRIES) {
    if (policy.patterns.some((pattern) => new RegExp(pattern, "i").test(value))) return id;
  }
  return "generic";
}

export function classifyProviderWithName(url: string, name: string): string {
  const provider = classifyProvider(url);
  if (provider !== "generic") return provider;
  if (/anime4up\s*\d/i.test(name)) return "anime4upcdn";
  if (/doodstream/i.test(name)) return "doodstream";
  return provider;
}

export function providerClassifierScript(functionName = "provider"): string {
  const lines = PROVIDER_ENTRIES.map(([id, policy]) => {
    const condition = policy.patterns
      .map((pattern) => `new RegExp(${JSON.stringify(pattern)},'i').test(url)`)
      .join("||");
    return `if(${condition})return ${JSON.stringify(id)};`;
  });
  return `function ${functionName}(url){url=String(url||'').toLowerCase();${lines.join("")}return 'generic';}`;
}

export function providerPolicy(provider: string): ProviderPolicy {
  return PROVIDER_POLICIES[provider] || PROVIDER_POLICIES.generic;
}

export function providerRank(provider: string): number {
  return providerPolicy(provider).rank;
}

export function providerFailureMode(provider?: string): ProviderFailureMode {
  return providerPolicy(provider || "generic").failureMode;
}

export function isProviderSupported(provider: string): boolean {
  return providerPolicy(provider).supported;
}

export function isDirectProvider(provider: string): boolean {
  const policy = providerPolicy(provider);
  return policy.supported && policy.resolution !== "webview";
}

export function isDownloadProvider(provider: string): boolean {
  return providerPolicy(provider).downloadable === true;
}

export function qualityScore(name: string): number {
  const value = String(name || "").toLowerCase();
  if (value.includes("fhd") || value.includes("1080")) return 3;
  if (value.includes("hd") || value.includes("720")) return 2;
  if (value.includes("sd") || value.includes("480") || value.includes("360")) return 0;
  return 1;
}

export function sortVideoServers<T extends { name: string; provider: string }>(servers: T[]): T[] {
  return [...servers].sort((a, b) =>
    providerRank(a.provider) - providerRank(b.provider) || qualityScore(b.name) - qualityScore(a.name));
}

export function selectWarmupServers<T extends { name: string; provider: string }>(servers: T[], limit = 3): T[] {
  return sortVideoServers(servers.filter((server) => isDirectProvider(server.provider))).slice(0, limit);
}

export function selectServerCandidates<T extends { provider: string }>(servers: readonly T[]): T[] {
  return servers.filter((server) => isDirectProvider(server.provider));
}

export function serverCandidateSignature(servers: readonly { provider: string; iframeUrl: string; source?: string }[]): string {
  return servers.map((server) => `${server.source || ""}|${server.provider}|${server.iframeUrl}`).join("\n");
}

export function mergeVideoServers<T extends { id?: string; name: string; provider: string; iframeUrl: string }>(
  groups: readonly (readonly T[])[],
): (T & { id: string })[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const group of groups) {
    for (const server of group) {
      const iframeUrl = normalizeServerUrl(server.iframeUrl);
      const dedupeKey = serverDedupeKey(iframeUrl);
      const provider = server.provider || classifyProvider(iframeUrl);
      if (!iframeUrl || !isProviderSupported(provider) || seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      merged.push({ ...server, provider, iframeUrl });
    }
  }
  return sortVideoServers(merged).map((server, index) => ({ ...server, id: String(index) }));
}

export function normalizeServerUrl(raw: string): string {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return "";
  }
}

function serverDedupeKey(raw: string): string {
  try {
    const url = new URL(raw);
    if (!/^#vid3rb=\d+$/i.test(url.hash)) url.hash = "";
    return url.toString();
  } catch {
    return raw;
  }
}

const MEDIA_DECOY_RE =
  /test-videos\.co\.uk|bigbuckbunny|sample[-_.]|placeholder|tos\.mp4|googleapis\.com\/.*oggtheora|\/lol\/file\.mp4|doubleclick|adserv|\/vast|preroll|\/ads\//i;

export function validateMediaUrl(raw: string, provider = "generic"): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (MEDIA_DECOY_RE.test(raw) || /\/embed(?:[-/]|$)|\/e\/[^/]*\.(?:mp4|m3u8)/i.test(url.pathname)) return false;
    if (provider === "mp4upload") {
      return (url.hostname === "mp4upload.com" || url.hostname.endsWith(".mp4upload.com")) &&
        url.pathname.toLowerCase().endsWith(".mp4");
    }
    if (provider === "vid3rb" && /(^|\.)vid3rb\.com$/i.test(url.hostname)) {
      return /\.(?:m3u8|mp4)$/i.test(url.pathname) || /^\/video\//i.test(url.pathname);
    }
    if (provider === "doodstream" && url.searchParams.has("token") && url.searchParams.has("expiry")) return true;
    if (provider === "dailymotion" && /(^|\.)(?:dailymotion\.com|dmcdn\.net)$/i.test(url.hostname)) return true;
    if (provider === "okru" && /(^|\.)(?:ok\.ru|mycdn\.me|okcdn\.)/i.test(url.hostname)) return true;
    if (/videa\.hu$/i.test(url.hostname) && /\/static\//i.test(url.pathname) && url.searchParams.has("md5")) return true;
    return /\.(?:m3u8|mp4)(?:$|\?)/i.test(raw);
  } catch {
    return false;
  }
}

export async function validateDirectServers<
  T extends { provider: string; iframeUrl: string },
>(
  servers: readonly T[],
  resolve: (server: T) => Promise<string | null>,
  onUpdate?: (servers: (T & { videoUrl: string })[]) => void,
): Promise<(T & { videoUrl: string })[]> {
  const candidates = servers.filter((server) => isDirectProvider(server.provider));
  const playable = new Map<string, T & { videoUrl: string }>();
  await Promise.all(candidates.map(async (server) => {
    try {
      const videoUrl = await resolve(server);
      if (!videoUrl || !validateMediaUrl(videoUrl, server.provider)) return;
      playable.set(server.iframeUrl, { ...server, videoUrl });
      onUpdate?.(candidates.flatMap((candidate) => {
        const resolved = playable.get(candidate.iframeUrl);
        return resolved ? [resolved] : [];
      }));
    } catch {}
  }));
  return candidates.flatMap((server) => {
    const resolved = playable.get(server.iframeUrl);
    return resolved ? [resolved] : [];
  });
}

export function videoContentType(videoUrl: string, provider = "generic"): "hls" | "progressive" {
  if (/\.m3u8(?:\?|$)/i.test(videoUrl)) return "hls";
  if (["streamwish", "voe", "dailymotion", "okru"].includes(provider) && !/\.mp4(?:\?|$)/i.test(videoUrl)) return "hls";
  return "progressive";
}

export function videoPlaybackHeaders(videoUrl: string, iframeUrl: string, provider = "generic"): Record<string, string> {
  const headers: Record<string, string> = { "User-Agent": VIDEO_USER_AGENT, Connection: "keep-alive" };
  let referer = "";
  let origin = "";
  try {
    const host = new URL(videoUrl).hostname.toLowerCase();
    if (provider === "mp4upload" || /mp4upload/.test(host)) referer = "https://www.mp4upload.com/";
    else if (provider === "vid3rb" || /vid3rb|anime3rb/.test(host)) referer = "https://anime3rb.com/";
    else if (provider === "streamwish") {
      const root = host.split(".").slice(-2).join(".");
      referer = `https://${root}/`;
      origin = `https://${root}`;
    }
    else if (provider === "voe") { referer = "https://voe.sx/"; origin = "https://voe.sx"; }
    else if (provider === "okru") { referer = "https://ok.ru/"; origin = "https://ok.ru"; }
    else if (provider === "dailymotion") { referer = "https://www.dailymotion.com/"; origin = "https://www.dailymotion.com"; }
    else if (provider === "videa" || provider === "videas") referer = "https://videa.hu/";
    else if (provider === "doodstream") referer = iframeUrl ? `${new URL(iframeUrl).origin}/` : `https://${host}/`;
    else {
      const sourceOrigin = iframeUrl ? new URL(iframeUrl).origin : new URL(videoUrl).origin;
      referer = `${sourceOrigin}/`;
      origin = sourceOrigin;
    }
  } catch {}
  if (referer) headers.Referer = referer;
  if (origin) headers.Origin = origin;
  return headers;
}

type MediaProbeFetch = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number }>;

export async function probeMediaUrl(
  url: string,
  headers: Record<string, string>,
  fetcher: MediaProbeFetch = fetch,
  timeoutMs = 8000,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {
      signal: controller.signal,
      headers: { ...headers, Range: "bytes=0-1" },
    });
    return response.ok || response.status === 206;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

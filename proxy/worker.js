/**
 * Pantoufa video proxy — Cloudflare Worker.
 *
 * Mirrors the desktop Electron proxy (electron/main.ts): the native mobile
 * player (expo-video / ExoPlayer) cannot inject a per-host Referer, retry
 * Referer strategies, or rewrite HLS playlists. This Worker does all three so
 * mp4upload + the anime4up CDNs (streamwish family, voe, …) play natively.
 *
 *   GET /?url=<encoded video url>[&ref=<encoded referer override>]
 *
 * - Picks the canonical Referer/Origin for the host (mp4upload wants
 *   www.mp4upload.com, streamwish family wants its root domain, …).
 * - Tries canonical → embed-host → no-referer until one returns 2xx.
 * - Passes the client Range header through; retries mp4upload with bytes=0-.
 * - If the body is an m3u8 playlist, rewrites every segment/key/variant URI
 *   back through this proxy so sub-requests keep the right Referer.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function canonicalReferer(hostname) {
  const host = hostname.toLowerCase();
  if (/mp4upload/.test(host)) {
    return { referer: "https://www.mp4upload.com/", origin: "https://www.mp4upload.com" };
  }
  if (/streamwish|hgcloud|wishfast|wishembed|jwembed|hlswish|vibuxer|audinifer|masukestin|hanerix|swhoi|streamruby|playerwish/.test(host)) {
    const root = host.split(".").slice(-2).join(".");
    return { referer: `https://${root}/`, origin: `https://${root}` };
  }
  if (/voe\./.test(host)) {
    return { referer: "https://voe.sx/", origin: "https://voe.sx" };
  }
  if (/dailymotion|dmcdn/.test(host)) {
    return { referer: "https://www.dailymotion.com/", origin: "https://www.dailymotion.com" };
  }
  if (/dood|dosool|d000d|dood\.|doodstream/.test(host)) {
    return { referer: "https://dood.to/", origin: "https://dood.to" };
  }
  if (/uqload/.test(host)) {
    return { referer: "https://uqload.net/", origin: "https://uqload.net" };
  }
  if (/anime4up/.test(host)) {
    return { referer: "https://w1.anime4up.rest/", origin: "https://w1.anime4up.rest" };
  }
  const root = host.split(".").slice(-2).join(".");
  return { referer: `https://${root}/`, origin: `https://${root}` };
}

function proxyBase(request) {
  return new URL(request.url).origin;
}

function isPlaylist(url, contentType) {
  if (/\.m3u8(\?|$)/i.test(url)) return true;
  if (contentType && /mpegurl|x-mpegurl|vnd\.apple/i.test(contentType)) return true;
  return false;
}

// Rewrite every absolute/relative URI inside an m3u8 playlist so it is fetched
// back through this proxy (preserving the Referer for the same host).
function rewritePlaylist(text, playlistUrl, base) {
  const baseUrl = new URL(playlistUrl);
  const toProxy = (raw) => {
    let abs;
    try {
      abs = new URL(raw, baseUrl).toString();
    } catch {
      return raw;
    }
    return `${base}/?url=${encodeURIComponent(abs)}`;
  };
  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        // Rewrite URI="..." attributes (EXT-X-KEY, EXT-X-MEDIA, MAP, …).
        return line.replace(/URI="([^"]+)"/gi, (_m, uri) => `URI="${toProxy(uri)}"`);
      }
      // A bare media/variant URI line.
      return toProxy(trimmed);
    })
    .join("\n");
}

async function fetchWithStrategies(target, range, refOverride) {
  const t = new URL(target);
  const canonical = refOverride
    ? { referer: refOverride, origin: (() => { try { return new URL(refOverride).origin; } catch { return refOverride; } })() }
    : canonicalReferer(t.hostname);

  const strategies = [
    { Referer: canonical.referer, Origin: canonical.origin },
    { Referer: `${t.protocol}//${t.host}/` },
    {}, // no referer
  ];

  let last = null;
  for (const extra of strategies) {
    const headers = { "User-Agent": UA, Accept: "*/*", ...extra };
    if (range) headers.Range = range;
    let resp;
    try {
      resp = await fetch(target, { headers, redirect: "follow" });
    } catch {
      continue;
    }
    if (resp.status >= 200 && resp.status < 400) return { resp, used: extra };
    last = resp;
  }

  // mp4upload sometimes only answers Range requests — retry with bytes=0-.
  if ((!last || !last.ok) && /mp4upload/.test(t.hostname) && !range) {
    try {
      const resp = await fetch(target, {
        headers: { "User-Agent": UA, Referer: canonical.referer, Origin: canonical.origin, Range: "bytes=0-" },
        redirect: "follow",
      });
      if (resp.status >= 200 && resp.status < 400) return { resp, used: { range: "0-" } };
      last = resp;
    } catch {}
  }
  return { resp: last, used: null };
}

function corsHeaders(extra) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
    "Access-Control-Allow-Headers": "Range,Content-Type",
    "Access-Control-Expose-Headers": "Content-Length,Content-Range,Accept-Ranges,Content-Type",
    ...extra,
  };
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const reqUrl = new URL(request.url);
    const target = (reqUrl.searchParams.get("url") || "").trim();
    if (!target) {
      return new Response("missing url", { status: 400, headers: corsHeaders() });
    }
    const refOverride = reqUrl.searchParams.get("ref") || null;
    const range = request.headers.get("Range");

    const { resp } = await fetchWithStrategies(target, range, refOverride);
    if (!resp) {
      return new Response("upstream unreachable", { status: 502, headers: corsHeaders() });
    }

    const contentType = resp.headers.get("Content-Type") || "";

    // HLS playlist → rewrite and return as text.
    if (isPlaylist(target, contentType)) {
      const text = await resp.text();
      const rewritten = rewritePlaylist(text, resp.url || target, proxyBase(request));
      return new Response(rewritten, {
        status: 200,
        headers: corsHeaders({
          "Content-Type": "application/vnd.apple.mpegurl",
          "Cache-Control": "no-store",
        }),
      });
    }

    // Media bytes → stream straight through, preserving Range semantics.
    const headers = corsHeaders({
      "Content-Type": contentType || "video/mp4",
      "Accept-Ranges": "bytes",
    });
    const cl = resp.headers.get("Content-Length");
    if (cl) headers["Content-Length"] = cl;
    const cr = resp.headers.get("Content-Range");
    if (cr) headers["Content-Range"] = cr;

    return new Response(resp.body, { status: resp.status, headers });
  },
};

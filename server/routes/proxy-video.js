const express = require('express');
const axios = require('axios');
const router = express.Router();

/**
 * GET /api/proxy-video?url=<encoded_video_url>[&ref=<encoded_referer>]
 *
 * General video proxy mirroring the desktop Electron proxy. The native mobile
 * player can't inject a per-host Referer, retry Referer strategies, or rewrite
 * HLS playlists — this route does all three so mp4upload + the anime4up CDNs
 * (streamwish family, voe, …) play natively.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function canonicalReferer(hostname) {
  const host = (hostname || '').toLowerCase();
  if (/mp4upload/.test(host)) return { referer: 'https://www.mp4upload.com/', origin: 'https://www.mp4upload.com' };
  if (/streamwish|hgcloud|wishfast|wishembed|jwembed|hlswish|vibuxer|audinifer|masukestin|hanerix|swhoi|streamruby|playerwish/.test(host)) {
    const root = host.split('.').slice(-2).join('.');
    return { referer: `https://${root}/`, origin: `https://${root}` };
  }
  if (/voe\./.test(host)) return { referer: 'https://voe.sx/', origin: 'https://voe.sx' };
  if (/dailymotion|dmcdn/.test(host)) return { referer: 'https://www.dailymotion.com/', origin: 'https://www.dailymotion.com' };
  if (/dood|d000d|doodstream/.test(host)) return { referer: 'https://dood.to/', origin: 'https://dood.to' };
  if (/uqload/.test(host)) return { referer: 'https://uqload.net/', origin: 'https://uqload.net' };
  if (/anime4up/.test(host)) return { referer: 'https://w1.anime4up.rest/', origin: 'https://w1.anime4up.rest' };
  const root = host.split('.').slice(-2).join('.');
  return { referer: `https://${root}/`, origin: `https://${root}` };
}

function isPlaylistUrl(url, contentType) {
  if (/\.m3u8(\?|$)/i.test(url)) return true;
  if (contentType && /mpegurl|x-mpegurl|vnd\.apple/i.test(contentType)) return true;
  return false;
}

function rewritePlaylist(text, playlistUrl, base) {
  const toProxy = (raw) => {
    let abs;
    try {
      abs = new URL(raw, playlistUrl).toString();
    } catch {
      return raw;
    }
    return `${base}/api/proxy-video?url=${encodeURIComponent(abs)}`;
  };
  return text
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith('#')) return line.replace(/URI="([^"]+)"/gi, (_m, uri) => `URI="${toProxy(uri)}"`);
      return toProxy(t);
    })
    .join('\n');
}

// Returns { headers, status } from the first Referer strategy that succeeds.
async function pickStrategy(target, range, refOverride) {
  const t = new URL(target);
  const canonical = refOverride
    ? { referer: refOverride, origin: (() => { try { return new URL(refOverride).origin; } catch { return refOverride; } })() }
    : canonicalReferer(t.hostname);

  const strategies = [
    { Referer: canonical.referer, Origin: canonical.origin },
    { Referer: `${t.protocol}//${t.host}/` },
    {},
  ];

  for (const extra of strategies) {
    const headers = { 'User-Agent': UA, Accept: '*/*', ...extra };
    if (range) headers.Range = range;
    try {
      const resp = await axios.get(target, {
        timeout: 12000,
        responseType: 'arraybuffer',
        maxContentLength: 64,
        maxBodyLength: 64,
        headers: { ...headers, Range: 'bytes=0-1' },
        validateStatus: () => true,
      });
      if (resp.status >= 200 && resp.status < 400) return { headers, ok: true };
    } catch {
      /* try next */
    }
  }
  // Fallback to canonical even if the probe failed (server may reject tiny Range).
  const headers = { 'User-Agent': UA, Accept: '*/*', Referer: canonical.referer, Origin: canonical.origin };
  if (range) headers.Range = range;
  return { headers, ok: false };
}

router.get('/', async (req, res) => {
  const url = (req.query.url || '').trim();
  if (!url) return res.status(400).json({ error: 'url is required' });
  const refOverride = (req.query.ref || '').trim() || null;
  const range = req.headers.range;
  const base = `${req.protocol}://${req.get('host')}`;

  try {
    // Playlists: fetch text, rewrite, return.
    if (/\.m3u8(\?|$)/i.test(url)) {
      const { headers } = await pickStrategy(url, null, refOverride);
      const resp = await axios.get(url, { timeout: 15000, responseType: 'text', headers, validateStatus: (s) => s >= 200 && s < 400 });
      const rewritten = rewritePlaylist(resp.data, url, base);
      res.status(200);
      res.set({ 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      return res.send(rewritten);
    }

    const { headers } = await pickStrategy(url, range, refOverride);
    const streamHeaders = { ...headers };
    if (range) streamHeaders.Range = range;

    let resp;
    try {
      resp = await axios.get(url, { timeout: 30000, responseType: 'stream', headers: streamHeaders, validateStatus: (s) => s >= 200 && s < 400 });
    } catch (e) {
      // mp4upload sometimes only answers Range requests.
      if (!range && /mp4upload/.test(new URL(url).hostname)) {
        resp = await axios.get(url, { timeout: 30000, responseType: 'stream', headers: { ...headers, Range: 'bytes=0-' }, validateStatus: (s) => s >= 200 && s < 400 });
      } else {
        throw e;
      }
    }

    // Detect a playlist served without .m3u8 extension.
    const ct = resp.headers['content-type'] || '';
    if (isPlaylistUrl(url, ct)) {
      const chunks = [];
      for await (const c of resp.data) chunks.push(c);
      const text = Buffer.concat(chunks).toString('utf8');
      const rewritten = rewritePlaylist(text, url, base);
      res.status(200);
      res.set({ 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      return res.send(rewritten);
    }

    res.status(resp.status);
    const passthrough = {
      'Content-Type': ct || 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
    };
    if (resp.headers['content-length']) passthrough['Content-Length'] = resp.headers['content-length'];
    if (resp.headers['content-range']) passthrough['Content-Range'] = resp.headers['content-range'];
    res.set(passthrough);
    resp.data.pipe(res);
  } catch (err) {
    console.error('[/api/proxy-video]', err.message);
    if (!res.headersSent) res.status(502).json({ error: 'Proxy failed' });
  }
});

module.exports = router;

const express = require('express');
const axios = require('axios');
const puppeteer = require('../lib/puppeteer');

const router = express.Router();

const httpClient = axios.create({
  timeout: 15000,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate',
    'Sec-Ch-Ua': '"Chromium";v="131", "Not_A Brand";v="24"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'iframe',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'cross-site',
  },
  maxRedirects: 10,
  validateStatus: (s) => s < 500,
});

const cache = new Map();
const CACHE_TTL = 86400000; // 24 hours for successes

router.get('/', async (req, res) => {
  try {
    const url = (req.query.url || '').trim();
    if (!url) {
      return res.status(400).json({ success: false, error: 'url is required' });
    }

    const fullUrl = url.startsWith('//') ? `https:${url}` : url;

    const cached = cache.get(fullUrl);
    if (cached && cached.found && Date.now() - cached.ts < CACHE_TTL) {
      return res.json({ success: true, data: cached.data });
    }

    const provider = (req.query.provider || '').toLowerCase();

    // Tier 1: provider-specific extractors (fastest, most reliable when available)
    let videoUrl = null;
    const isDailymotion = provider === 'dailymotion' || /dailymotion\.com|dai\.ly/i.test(fullUrl);
    if (isDailymotion) {
      videoUrl = await extractDailymotion(fullUrl);
    } else if (provider === 'yonaplay') {
      videoUrl = await extractYonaplay(fullUrl);
    } else if (provider === 'mp4upload') {
      videoUrl = await extractMp4Upload(fullUrl);
    } else if (provider === 'streamwish' || /hlswish|streamwish|wishembed|wishfast|hgcloud|jwembed/i.test(fullUrl)) {
      videoUrl = await extractStreamwishProvider(fullUrl);
    } else if (provider === 'voe' || /voe\.sx|voe\./i.test(fullUrl)) {
      videoUrl = await extractVoe(fullUrl);
    } else if (provider === 'share4max' || /share4max|megamax/i.test(fullUrl)) {
      videoUrl = await extractShare4max(fullUrl);
    }

    // Tier 2: generic HTML extraction (works for most embeds with inline player config)
    if (!videoUrl) {
      try {
        const resp = await httpClient.get(fullUrl, {
          responseType: 'text',
          headers: { Referer: new URL(fullUrl).origin + '/' },
        });
        const html = resp.data;
        if (html && html.length >= 100) {
          videoUrl =
            extractJWPlayer(html) ||
            extractSourceTag(html) ||
            extractPackedJS(html) ||
            extractStreamwish(html) ||
            extractGeneric(html);
        }
      } catch {}
    }

    // Tier 3: Puppeteer network interception (works for JS-heavy embeds: videa, voe, share4max...)
    // Skip providers that we know cannot be played natively even with interception.
    const noNativeFallback = ['mega', 'vk']; // require WebView
    if (!videoUrl && !noNativeFallback.includes(provider)) {
      videoUrl = await extractViaChrome(fullUrl);
    }

    if (videoUrl && videoUrl !== fullUrl && !isEmbedPage(videoUrl) && !isDecoyVideoUrl(videoUrl)) {
      const data = {
        videoUrl,
        type: /\.m3u8/i.test(videoUrl) ? 'hls' : 'mp4',
      };
      cache.set(fullUrl, { ts: Date.now(), found: true, data });
      return res.json({ success: true, data });
    }

    res.json({ success: false, error: 'Could not extract video URL' });
  } catch (err) {
    console.error('[/api/resolve-video]', err.message);
    res.status(502).json({ success: false, error: 'Resolution failed' });
  }
});

// ── Provider-specific extractors ────────────────

async function extractDailymotion(url) {
  try {
    // Extract the video ID from various dailymotion URL formats
    const idMatch = url.match(/(?:dailymotion\.com\/(?:embed\/)?video\/|dai\.ly\/)([a-zA-Z0-9]+)/);
    if (!idMatch) return null;

    const videoId = idMatch[1];
    const metaUrl = `https://www.dailymotion.com/player/metadata/video/${videoId}`;
    const resp = await httpClient.get(metaUrl, {
      responseType: 'json',
      headers: {
        Referer: 'https://www.dailymotion.com/',
        Origin: 'https://www.dailymotion.com',
      },
    });

    const data = resp.data;
    if (!data || !data.qualities) return null;

    // Prefer highest fixed quality (1080p > 720p > 480p)
    const qualityOrder = ['1080', '720', '480', '380', '240'];
    for (const q of qualityOrder) {
      const streams = data.qualities[q];
      if (streams && streams.length > 0) {
        const mp4 = streams.find((v) => v.type === 'video/mp4');
        if (mp4 && mp4.url) return mp4.url;
      }
    }

    // Fall back to HLS adaptive master playlist
    if (data.qualities.auto && data.qualities.auto.length > 0) {
      const hls = data.qualities.auto.find(q => q.type === 'application/x-mpegURL');
      if (hls && hls.url) return hls.url;
      if (data.qualities.auto[0].url) return data.qualities.auto[0].url;
    }

    // Last resort: grep for any m3u8 URL
    const jsonStr = JSON.stringify(data);
    const m3u8Match = jsonStr.match(/https?:\/\/[^"'\\]+\.m3u8[^"'\\]*/);
    if (m3u8Match) return m3u8Match[0];

    return null;
  } catch {
    return null;
  }
}

async function extractYonaplay(url) {
  try {
    const resp = await httpClient.get(url, {
      responseType: 'text',
      headers: { Referer: 'https://witanime.you/' },
    });
    const html = resp.data;

    // yonaplay often has JWPlayer config with file: "url"
    const jwUrl = extractJWPlayer(html);
    if (jwUrl) return jwUrl;

    // Sometimes yonaplay has an API endpoint that returns the m3u8
    const apiMatch = html.match(/\/api\/.*?[?&]id=\d+/);
    if (apiMatch) {
      const apiUrl = new URL(apiMatch[0], url).href;
      try {
        const apiResp = await httpClient.get(apiUrl, {
          responseType: 'text',
          headers: { Referer: url },
        });
        const apiData = typeof apiResp.data === 'string' ? apiResp.data : JSON.stringify(apiResp.data);
        const m3u8 = apiData.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/);
        if (m3u8) return m3u8[0];
      } catch {}
    }

    return extractPackedJS(html) || extractGeneric(html);
  } catch {
    return null;
  }
}

async function extractMp4Upload(url) {
  try {
    const resp = await httpClient.get(url, {
      responseType: 'text',
      headers: { Referer: 'https://www.mp4upload.com/' },
    });
    const html = resp.data;

    // mp4upload uses packed JS with the video URL inside
    const packed = extractPackedJS(html);
    if (packed) return packed;

    // Also check for player.src({src: "url"})
    const srcMatch = html.match(/player\.src\(\s*\{\s*(?:type\s*:\s*["'][^"']*["']\s*,\s*)?src\s*:\s*["']([^"']+)["']/i);
    if (srcMatch) return srcMatch[1];

    return extractSourceTag(html) || extractGeneric(html);
  } catch {
    return null;
  }
}

async function extractStreamwishProvider(url) {
  try {
    const origin = new URL(url).origin;
    const resp = await httpClient.get(url, {
      responseType: 'text',
      headers: { Referer: origin + '/' },
    });
    const html = resp.data;
    const packed = extractPackedJS(html);
    if (packed) return packed;
    return extractJWPlayer(html) || extractSourceTag(html) || extractGeneric(html);
  } catch {
    return null;
  }
}

// ── Generic extractors ──────────────────────────

function extractStreamwish(html) {
  // Streamwish variants (hgcloud, jwembed, wishfast etc.) use packed JS
  const packed = extractPackedJS(html);
  if (packed) return packed;

  // Also try sources array pattern
  const m = html.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*["']([^"']+)["']/i);
  return m ? m[1] : null;
}

function extractJWPlayer(html) {
  for (const re of [
    /file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i,
    /file\s*:\s*["']([^"']+\.mp4[^"']*)["']/i,
    /sources\s*:\s*\[\s*\{\s*(?:type\s*:\s*["'][^"']*["']\s*,\s*)?file\s*:\s*["']([^"']+)["']/i,
    /src\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i,
    /src\s*:\s*["']([^"']+\.mp4[^"']*)["']/i,
    /player\.src\(\{[^}]*?src\s*:\s*["']([^"']+)["']/i,
    /source\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i,
    /source\s*:\s*["']([^"']+\.mp4[^"']*)["']/i,
  ]) {
    const m = html.match(re);
    if (m && !isEmbedPage(m[1])) return m[1];
  }
  return null;
}

function extractSourceTag(html) {
  const m =
    html.match(/<source[^>]*?src\s*=\s*["']([^"']+\.(?:mp4|m3u8|webm)[^"']*)["']/i) ||
    html.match(/<video[^>]*?src\s*=\s*["']([^"']+\.(?:mp4|m3u8|webm)[^"']*)["']/i);
  return m ? m[1] : null;
}

function extractPackedJS(html) {
  const packed = html.match(
    /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*d\s*\)\s*\{[^}]+?\}\s*\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'(.*?)'\s*\.\s*split\s*\(\s*'\|'\s*\)/s,
  );
  if (!packed) return null;
  try {
    const text = unpack(
      packed[1].replace(/\\(.)/g, '$1'),
      +packed[2],
      +packed[3],
      packed[4].split('|'),
    );
    return extractJWPlayer(text) || extractGenericFromText(text);
  } catch {
    return null;
  }
}

function extractGeneric(html) {
  return extractGenericFromText(html);
}

function extractGenericFromText(text) {
  for (const re of [
    /https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/gi,
    /https?:\/\/[^"'\s<>]+\.mp4[^"'\s<>]*/gi,
  ]) {
    const matches = text.match(re);
    if (matches) {
      for (const u of matches) {
        if (!isEmbedPage(u) && !isTracker(u)) return u;
      }
    }
  }
  return null;
}

function isEmbedPage(url) {
  const lower = url.toLowerCase();
  return (
    lower.includes('/embed') ||
    lower.includes('mp4upload.com/e') ||
    lower.includes('hgcloud.to/e/') ||
    lower.includes('yonaplay.net/embed')
  );
}

function isTracker(url) {
  const lower = url.toLowerCase();
  return (
    lower.includes('google') ||
    lower.includes('facebook') ||
    lower.includes('cloudflare') ||
    lower.includes('analytics') ||
    lower.includes('tracker')
  );
}

function unpack(p, a, c, k) {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  function baseN(n, r) {
    let s = '';
    while (n > 0) {
      s = chars[n % r] + s;
      n = Math.floor(n / r);
    }
    return s || '0';
  }
  while (c--) {
    if (k[c]) p = p.replace(new RegExp('\\b' + baseN(c, a) + '\\b', 'g'), k[c]);
  }
  return p;
}

/* ── Chrome CDP fallback for streamwish ────────── */

/**
 * Loads the embed page in Chrome and intercepts all network requests, returning
 * the first .m3u8 or .mp4 URL the player tries to fetch. Works for JS-heavy
 * embeds (videa, voe, share4max, doodstream) that don't expose URLs in HTML.
 *
 * Also tries clicking the play button if no video URL appears within 4s — many
 * players defer the manifest request until after user interaction.
 */
/**
 * Decoys/placeholders that some embed pages reference to mislead scrapers.
 * Any URL matching these patterns is ignored even if a video extension is present.
 */
function isDecoyVideoUrl(u) {
  const lu = u.toLowerCase();
  if (!lu.startsWith('http')) return true; // skip relative URLs like /lol/file.mp4
  return /test-videos\.co\.uk/.test(lu)
    || /bigbuckbunny/.test(lu)
    || /sample[-_.]/.test(lu)
    || /\/lol\/file\.mp4/.test(lu)
    || /placeholder/.test(lu)
    || /tos\.mp4/.test(lu)
    || /\.googleapis\.com\/.*\/oggtheora/.test(lu);
}

async function extractViaChrome(url) {
  let browser = null;
  let page = null;
  try {
    const chrome = require('../lib/chrome-manager');
    await chrome.ensureReady();
    browser = await puppeteer.connect({
      browserURL: `http://localhost:${chrome.DEBUG_PORT}`,
      defaultViewport: null,
    });
    page = await browser.newPage();
    const captured = [];
    const isVideoUrl = (u, ct = '') => {
      const lu = u.toLowerCase();
      return /\.m3u8(\?|$|\/)/.test(lu)
        || /\.mpd(\?|$)/.test(lu)
        || /\.mp4(\?|$)/.test(lu)
        || /\.webm(\?|$)/.test(lu)
        || /\.ts(\?|$)/.test(lu)
        || ct.includes('mpegurl')
        || ct.includes('video/mp4')
        || ct.includes('video/webm')
        || ct.includes('application/dash');
    };

    const seen = new Set();
    const record = (u) => {
      if (seen.has(u)) return;
      seen.add(u);
      if (isDecoyVideoUrl(u)) return;
      captured.push(u);
    };

    page.on('request', (req) => {
      const u = req.url();
      if (isVideoUrl(u)) record(u);
    });
    page.on('response', (res) => {
      try {
        const u = res.url();
        const ct = res.headers()['content-type'] || '';
        if (isVideoUrl(u, ct)) record(u);
      } catch {}
    });

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({ Referer: new URL(url).origin + '/' }).catch(() => {});
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});

    // Wait up to 5s for the player to auto-load the manifest
    for (let i = 0; i < 10; i++) {
      if (captured.length > 0) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    // Trigger play to provoke manifest load (and try a second time to catch real URL after decoy)
    try {
      await page.evaluate(() => {
        const tryClick = (sel) => {
          const el = document.querySelector(sel);
          if (el) { try { el.click(); return true; } catch {} }
          return false;
        };
        tryClick('.jw-icon-display')
          || tryClick('.vjs-big-play-button')
          || tryClick('.plyr__control--overlaid')
          || tryClick('[class*="play"][class*="btn"]')
          || tryClick('button[aria-label*="lay" i]');
        document.querySelectorAll('video').forEach((v) => {
          try { v.muted = true; v.play(); } catch {}
        });
      });
    } catch {}

    // Wait another 5s after play interaction
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 500));
      // Stop early if we have a strong candidate (HLS manifest)
      if (captured.some((u) => /\.m3u8/i.test(u))) break;
    }

    if (captured.length > 0) {
      // Prefer master HLS manifest > any HLS > MP4 > others
      const master = captured.find((u) => /master\.m3u8|playlist\.m3u8|index\.m3u8/i.test(u));
      const m3u8 = captured.find((u) => /\.m3u8/i.test(u));
      const mp4 = captured.find((u) => /\.mp4/i.test(u));
      return master || m3u8 || mp4 || captured[0];
    }

    // Final fallback: scan rendered HTML
    const html = await page.content().catch(() => '');
    const found = extractJWPlayer(html) || extractPackedJS(html) || extractGeneric(html);
    if (found && !isDecoyVideoUrl(found)) return found;
    return null;
  } catch (e) {
    console.error('[resolve Chrome]', e.message);
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.disconnect().catch(() => {});
  }
}

async function extractVoe(url) {
  try {
    const resp = await httpClient.get(url, {
      responseType: 'text',
      headers: { Referer: new URL(url).origin + '/' },
    });
    const html = resp.data || '';
    // VOE sometimes returns redirect via window.location
    const redirMatch = html.match(/window\.location\.href\s*=\s*["']([^"']+)["']/i);
    if (redirMatch && redirMatch[1] !== url) {
      const next = redirMatch[1].startsWith('http') ? redirMatch[1] : new URL(redirMatch[1], url).href;
      const r2 = await httpClient.get(next, {
        responseType: 'text',
        headers: { Referer: url },
      }).catch(() => null);
      if (r2) {
        const v = extractJWPlayer(r2.data) || extractPackedJS(r2.data) || extractGeneric(r2.data);
        if (v) return v;
      }
    }
    // VOE inline sources array (newer obfuscation)
    const sourcesMatch = html.match(/sources\s*:\s*\[\s*\{[^}]*?(?:file|src)\s*:\s*["']([^"']+)["']/i);
    if (sourcesMatch) return sourcesMatch[1];
    const hlsMatch = html.match(/['"]([^'"]+\.m3u8[^'"]*)['"]/);
    if (hlsMatch) return hlsMatch[1];
    return extractJWPlayer(html) || extractPackedJS(html) || extractGeneric(html);
  } catch {
    return null;
  }
}

async function extractShare4max(url) {
  try {
    // Normalize /iframe/ID to /e/ID — embed endpoint exposes the player
    const normalized = url.replace('/iframe/', '/e/');
    const resp = await httpClient.get(normalized, {
      responseType: 'text',
      headers: { Referer: new URL(url).origin + '/' },
    });
    const html = resp.data || '';
    return extractJWPlayer(html) || extractPackedJS(html) || extractSourceTag(html) || extractGeneric(html);
  } catch {
    return null;
  }
}

module.exports = router;

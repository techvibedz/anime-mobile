const express = require('express');
const axios = require('axios');
const router = express.Router();

/**
 * GET /api/proxy-video?url=<encoded_video_url>
 *
 * Proxies the video stream from mp4upload CDN to the native player.
 * Solves non-standard port / TLS cert / Referer header issues.
 */
router.get('/', async (req, res) => {
  try {
    const url = (req.query.url || '').trim();
    if (!url) return res.status(400).json({ error: 'url is required' });

    // HEAD often times out for mp4upload's non-standard-port CDNs.
    // Skip it entirely — we only really need content-length when there's no Range header.
    const range = req.headers.range;
    let contentLength = null;
    let contentType = 'video/mp4';
    try {
      const headResp = await axios.head(url, {
        timeout: 4000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Referer: 'https://www.mp4upload.com/',
        },
        validateStatus: () => true,
      });
      contentLength = headResp.headers['content-length'];
      contentType = headResp.headers['content-type'] || 'video/mp4';
    } catch {
      // HEAD failed (port blocked, timeout) — proceed without it
    }

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : (contentLength ? contentLength - 1 : undefined);
      const chunkSize = end ? end - start + 1 : undefined;

      const resp = await axios.get(url, {
        timeout: 30000,
        responseType: 'stream',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Referer: 'https://www.mp4upload.com/',
          Range: `bytes=${start}-${end || ''}`,
        },
        validateStatus: (s) => s === 206 || s === 200,
      });

      res.status(206);
      res.set({
        'Content-Range': `bytes ${start}-${end || contentLength - 1}/${contentLength || '*'}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
      });
      resp.data.pipe(res);
    } else {
      const resp = await axios.get(url, {
        timeout: 60000,
        responseType: 'stream',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Referer: 'https://www.mp4upload.com/',
        },
        validateStatus: (s) => s === 200,
      });

      res.status(200);
      res.set({
        'Content-Length': contentLength,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
      });
      resp.data.pipe(res);
    }
  } catch (err) {
    console.error('[/api/proxy-video]', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Proxy failed' });
    }
  }
});

module.exports = router;

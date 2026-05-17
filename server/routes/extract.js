const express = require('express');
const cheerio = require('cheerio');
const { fetchHTML, BASE_URL } = require('../lib/scraper');
const { decodeVideoServers, decodeEpisodeUrl } = require('../lib/decoder');

const router = express.Router();

/**
 * GET /api/extract-video?url=<episode_page_url>
 *
 * CRITICAL ENDPOINT: Extracts video streaming links from an episode page.
 *
 * Strategy:
 *   1. Fetch the episode page HTML
 *   2. Extract `_zG` (resourceRegistry) and `_zH` (configRegistry) variables
 *   3. Reverse-engineer the JS decoding (from abz100.js):
 *      - Reverse each resource string
 *      - Remove non-base64 chars
 *      - Base64 decode
 *      - Trim trailing N bytes (offset from configRegistry[k])
 *   4. Return the decoded iframe URLs per server
 *   5. If the iframe is from a known provider (yonaplay, streamwish, mp4upload),
 *      flag it for secondary resolution to m3u8/mp4
 */
router.get('/', async (req, res) => {
  try {
    const url = (req.query.url || '').trim();
    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'Query parameter "url" (episode page URL) is required',
      });
    }

    const path = url.replace(BASE_URL, '');
    const html = await fetchHTML(path);
    const $ = cheerio.load(html);

    // Episode metadata
    const episodeTitle = $('.main-section h3').first().text().trim();

    const animeHref = $('.anime-page-link a').attr('href') || '';
    const animeTitle = $('.anime-page-link a').text().trim();

    // Extract server names from the visible tab buttons
    const serverNames = [];
    $('#episode-servers .server-link').each((_, el) => {
      serverNames.push($(el).find('.ser').text().trim());
    });

    // Decode the obfuscated video server URLs
    const decodedServers = decodeVideoServers(html);

    // Framework hash from abz100.js — required for yonaplay API auth
    const YONAPLAY_API_KEY = '23a97133-caf3-4eb4-9466-93d0a4ff8198';

    // Merge server names with decoded URLs
    const servers = decodedServers.map((server, i) => {
      let url = server.url;
      const provider = classifyProvider(url);

      // yonaplay requires the API key appended
      if (provider === 'yonaplay' && /^https:\/\/yonaplay\.net\/embed\.php\?id=\d+/.test(url)) {
        url += '&apiKey=' + YONAPLAY_API_KEY;
      }

      return {
        id: server.id,
        name: serverNames[i] || server.name,
        iframeUrl: url,
        provider,
      };
    });

    // Episode navigation (prev/next)
    const prevHref = $('.previous-episode a').attr('href') || null;
    const nextHref = $('.next-episode a').attr('href') || null;

    const resolutionNote = servers.length > 0
      ? 'Each server.iframeUrl is the direct embed page. To get raw m3u8/mp4, fetch that iframe URL and extract the video src from the embedded player HTML. For yonaplay: the URL pattern is /embed.php?id=X and the m3u8 is loaded via JW Player config. For streamwish/mp4upload: the video source is in a script tag or video element inside the iframe.'
      : 'No video servers could be decoded. The page may have changed its obfuscation.';

    res.json({
      success: true,
      data: {
        episodeTitle,
        animeTitle,
        animeHref,
        serverCount: servers.length,
        servers,
        navigation: {
          prev: prevHref,
          next: nextHref,
        },
        resolutionNote,
      },
    });
  } catch (err) {
    console.error('[/api/extract-video] Error:', err.message);
    res.status(502).json({
      success: false,
      error: 'Failed to extract video links',
      details: err.message,
    });
  }
});

function classifyProvider(url) {
  if (!url) return 'unknown';
  const lower = url.toLowerCase();
  if (lower.includes('yonaplay')) return 'yonaplay';
  if (lower.includes('streamwish') || lower.includes('wishembed') || lower.includes('wishfast') || lower.includes('hgcloud') || lower.includes('jwembed')) return 'streamwish';
  if (lower.includes('mp4upload')) return 'mp4upload';
  if (lower.includes('videa')) return 'videa';
  if (lower.includes('yourupload') || lower.includes('youtube')) return 'yourupload';
  if (lower.includes('vidstream') || lower.includes('vidcloud')) return 'vidstream';
  if (lower.includes('dood') || lower.includes('d000d')) return 'doodstream';
  return 'generic';
}

module.exports = router;

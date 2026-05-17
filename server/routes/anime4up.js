const express = require('express');
const puppeteer = require('../lib/puppeteer');
const cheerio = require('cheerio');
const chrome = require('../lib/chrome-manager');

const router = express.Router();
const BASE = 'https://w1.anime4up.rest';

const cache = new Map();

async function fetchPage(url, waitMs = 5000) {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.ts < 300000) return cached.html;

  await chrome.ensureReady();

  const browser = await puppeteer.connect({
    browserURL: `http://localhost:${chrome.DEBUG_PORT}`,
    defaultViewport: null,
  });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    // Wait for JS to render episodes/servers
    await new Promise((r) => setTimeout(r, waitMs));
    const html = await page.content();
    cache.set(url, { html, ts: Date.now() });
    return html;
  } finally {
    await browser.disconnect();
  }
}

/**
 * GET /api/4up/home
 */
router.get('/home', async (req, res) => {
  try {
    const html = await fetchPage(BASE + '/home8/');
    const $ = cheerio.load(html);

    const featured = [];
    $('.lucodeia-slider-slide-item').each((_, el) => {
      const $el = $(el);
      const bg = ($el.attr('style') || '').match(/url\(['"]?([^'"()]+)['"]?\)/);
      featured.push({
        title: $el.attr('title') || '',
        href: $el.attr('href') || '',
        image: bg ? bg[1] : null,
        description: null,
        genres: [],
      });
    });

    const animeItems = [];
    $('.anime-card-container').each((_, el) => {
      const $el = $(el);
      animeItems.push({
        title: $el.find('.anime-card-title h3 a').text().trim(),
        href: $el.find('.anime-card-poster a.overlay').attr('href') || '',
        image: $el.find('.anime-card-poster img').attr('src') || '',
        type: $el.find('.anime-card-type a').text().trim() || null,
        status: null,
        isNew: true,
        description: null,
        rating: null,
      });
    });

    res.json({
      success: true,
      data: {
        featured: featured.slice(0, 5),
        sections: [{ id: '4up_trending', title: 'anime4up Trending', type: 'anime', items: animeItems }],
      },
    });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/4up/search?q=<query>
 */
router.get('/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.status(400).json({ success: false, error: 'q is required' });
    const html = await fetchPage(BASE + '/home8/?s=' + encodeURIComponent(q) + '&search_param=animes');
    const $ = cheerio.load(html);
    const results = [];
    $('.anime-card-container').each((_, el) => {
      const $el = $(el);
      const t = $el.find('.anime-card-title h3 a').text().trim();
      const h = $el.find('.anime-card-poster a.overlay').attr('href') || '';
      if (t && h) results.push({ title: t, href: h, image: $el.find('.anime-card-poster img').attr('src') || '', type: null, status: null, synopsis: null });
    });
    res.json({ success: true, data: { query: q, totalResults: results.length, results } });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/4up/episodes?url=<anime_url>
 */
router.get('/episodes', async (req, res) => {
  try {
    const url = (req.query.url || '').trim();
    if (!url) return res.status(400).json({ success: false, error: 'url is required' });

    const html = await fetchPage(url, 6000);
    const $ = cheerio.load(html);

    const title = $('.anime-details-title').text().trim();
    const poster = $('.anime-thumbnail img').attr('src') || '';
    const synopsis = $('.anime-story').text().trim();
    const genres = [];
    $('.anime-genres a').each((_, el) => genres.push($(el).text().trim()));

    // Episodes are in the rendered DOM (not XOR-encoded)
    const episodes = [];
    $('a[href*="/episode/"]').each((_, el) => {
      const $el = $(el);
      const text = $el.text().trim();
      const href = $el.attr('href') || '';
      // Only capture episode links, not generic ones
      if (text && text.length > 3 && !episodes.find((e) => e.href === href)) {
        const num = text.match(/\d+/);
        episodes.push({
          title: text,
          number: num ? parseInt(num[0], 10) : null,
          type: '',
          screenshot: '',
          href: href.startsWith('http') ? href : BASE + href,
        });
      }
    });

    res.json({
      success: true,
      data: {
        title, poster, banner: poster, synopsis, genres,
        rating: null, metadata: {}, externalLinks: [],
        relatedAnime: [], totalEpisodes: episodes.length, episodes,
      },
    });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/4up/extract-video?url=<episode_url>
 */
router.get('/extract-video', async (req, res) => {
  try {
    const url = (req.query.url || '').trim();
    if (!url) return res.status(400).json({ success: false, error: 'url is required' });

    const html = await fetchPage(url, 6000);
    const $ = cheerio.load(html);

    const episodeTitle = $('.main-section h3').first().text().trim()
                      || $('h1').first().text().trim();
    const animeTitle = $('.anime-page-link a').text().trim();

    // Direct iframe extraction
    const servers = [];
    const seen = new Set();

    $('iframe').each((_, el) => {
      const src = ($(el).attr('src') || $(el).attr('data-src') || '').trim();
      if (src && src.startsWith('http') && !seen.has(src)) {
        seen.add(src);
        servers.push({
          id: servers.length.toString(),
          name: `Server ${servers.length + 1}`,
          iframeUrl: src,
          provider: classifyProvider(src),
        });
      }
    });

    res.json({
      success: true,
      data: {
        episodeTitle,
        animeTitle,
        animeHref: '',
        serverCount: servers.length,
        servers,
        navigation: { prev: null, next: null },
      },
    });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

function classifyProvider(url) {
  if (!url) return 'generic';
  const u = url.toLowerCase();
  if (u.includes('yonaplay')) return 'yonaplay';
  if (u.includes('streamwish') || u.includes('hgcloud') || u.includes('wishembed')) return 'streamwish';
  if (u.includes('mp4upload')) return 'mp4upload';
  if (u.includes('videa')) return 'videa';
  if (u.includes('dood') || u.includes('d000d')) return 'doodstream';
  if (u.includes('share4max')) return 'share4max';
  return 'generic';
}

module.exports = router;

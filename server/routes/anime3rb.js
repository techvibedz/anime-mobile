const express = require('express');
const cheerio = require('cheerio');
const { fetchHTML, BASE_URL } = require('../lib/scraper-3rb');

const router = express.Router();

/**
 * GET /api/3rb/home
 * Scrapes anime3rb homepage
 */
router.get('/home', async (req, res) => {
  try {
    const html = await fetchHTML('/');
    const $ = cheerio.load(html);

    const featured = [];
    const items = [];

    // Featured/slider items
    $('.swiper-slide, .slider-item, .carousel-item, .hero-item').each((_, el) => {
      const $el = $(el);
      const img = $el.find('img').first();
      const link = $el.find('a').first();
      const title = $el.find('h2, h3, .title').first();
      if (link.length && img.length) {
        featured.push({
          title: title.text().trim() || link.attr('title') || '',
          href: link.attr('href') || '',
          image: img.attr('src') || img.attr('data-src') || '',
          description: '',
          genres: [],
        });
      }
    });

    // Anime cards
    const cardSelectors = [
      '.anime-card', '.card', '.post-item', '.item', 'article',
      '.anime-item', '.movie-item', '.series-item',
    ];
    for (const sel of cardSelectors) {
      $(sel).each((_, el) => {
        const $el = $(el);
        const img = $el.find('img').first();
        const link = $el.find('a').first();
        const title = $el.find('h2, h3, .title, [class*="title"]').first();
        if (link.length && img.length) {
          items.push({
            title: title.text().trim() || link.attr('title') || '',
            href: link.attr('href') || '',
            image: img.attr('src') || img.attr('data-src') || img.attr('data-lazy-src') || '',
            type: $el.find('.type, .badge, [class*="type"]').first().text().trim() || null,
            status: $el.find('.status, [class*="status"]').first().text().trim() || null,
            isNew: true,
            description: null,
            rating: null,
          });
        }
      });
      if (items.length > 0) break;
    }

    // Deduplicate by href
    const seen = new Set();
    const uniqueItems = items.filter((i) => {
      if (!i.href || seen.has(i.href)) return false;
      seen.add(i.href);
      return true;
    });

    // Build sections
    const sections = [];
    if (uniqueItems.length > 0) {
      sections.push({
        id: '3rb_trending',
        title: 'anime3rb Trending',
        type: 'anime',
        items: uniqueItems,
      });
    }

    // Also add featured items to sections
    if (featured.length > 0 && uniqueItems.length > 0) {
      const featuredInSection = featured.slice(0, 3).map((f) => ({
        ...f,
        type: null,
        status: null,
        isNew: true,
        description: f.description,
        rating: null,
      }));
    }

    res.json({
      success: true,
      data: {
        featured: featured.slice(0, 5),
        sections,
      },
    });
  } catch (err) {
    console.error('[/api/3rb/home]', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/3rb/search?q=<query>
 */
router.get('/search', async (req, res) => {
  try {
    const query = (req.query.q || '').trim();
    if (!query) return res.status(400).json({ success: false, error: 'q is required' });

    const html = await fetchHTML(`/?s=${encodeURIComponent(query)}`);
    const $ = cheerio.load(html);

    const results = [];
    $('.anime-card, .card, .post-item, article, .item').each((_, el) => {
      const $el = $(el);
      const img = $el.find('img').first();
      const link = $el.find('a').first();
      const title = $el.find('h2, h3, .title').first();
      if (link.length && title.length) {
        results.push({
          title: title.text().trim(),
          href: link.attr('href') || '',
          image: img.attr('src') || img.attr('data-src') || '',
          type: $el.find('.type, .badge').first().text().trim() || null,
          status: null,
          synopsis: null,
        });
      }
    });

    res.json({ success: true, data: { query, totalResults: results.length, results } });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/3rb/episodes?url=<anime_url>
 */
router.get('/episodes', async (req, res) => {
  try {
    const url = (req.query.url || '').trim();
    if (!url) return res.status(400).json({ success: false, error: 'url is required' });

    const path = url.replace(BASE_URL, '');
    const html = await fetchHTML(path);
    const $ = cheerio.load(html);

    const title = $('h1, .anime-title, .entry-title, [class*="title"]').first().text().trim();
    const poster = $('.poster img, .thumbnail img, .anime-img img, img.poster').first().attr('src') || '';
    const synopsis = $('.synopsis, .description, .story, .anime-desc, [class*="desc"]').first().text().trim();

    const genres = [];
    $('.genres a, .categories a, .anime-genre a, [class*="genre"] a').each((_, el) => {
      const t = $(el).text().trim();
      if (t) genres.push(t);
    });

    // Episodes
    const episodes = [];
    $('.episodes a, .episode-list a, .eps a, [class*="episode"] a, a[href*="/episode/"], a[href*="/watch/"]').each((_, el) => {
      const $el = $(el);
      const href = $el.attr('href') || '';
      const num = $el.text().trim().match(/\d+/);
      episodes.push({
        title: $el.text().trim(),
        number: num ? parseInt(num[0], 10) : null,
        type: '',
        screenshot: '',
        href: href.startsWith('http') ? href : BASE_URL + href,
      });
    });

    res.json({
      success: true,
      data: {
        title,
        poster,
        banner: poster,
        synopsis,
        genres,
        rating: null,
        metadata: {},
        externalLinks: [],
        relatedAnime: [],
        totalEpisodes: episodes.length,
        episodes,
      },
    });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/3rb/extract-video?url=<episode_url>
 * Extracts video servers from an episode page on anime3rb
 */
router.get('/extract-video', async (req, res) => {
  try {
    const url = (req.query.url || '').trim();
    if (!url) return res.status(400).json({ success: false, error: 'url is required' });

    const path = url.replace(BASE_URL, '');
    const html = await fetchHTML(path);
    const $ = cheerio.load(html);

    const episodeTitle = $('h1, .episode-title, .entry-title').first().text().trim();
    const animeTitle = $('.anime-title a, .series-title a, .breadcrumb a').last().text().trim();
    const animeHref = $('.anime-title a, .series-title a').last().attr('href') || '';

    // Find video servers (iframe src, data attributes, etc.)
    const servers = [];
    const seen = new Set();

    // Look for iframes
    $('iframe').each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src') || '';
      if (src && !seen.has(src)) {
        seen.add(src);
        servers.push({
          id: servers.length.toString(),
          name: `Server ${servers.length + 1}`,
          iframeUrl: src,
          provider: classifyProvider(src),
        });
      }
    });

    // Look for server buttons/links
    $('.server, [class*="server"], [class*="player"] a, .download-links a').each((_, el) => {
      const $el = $(el);
      const href = $el.attr('href') || $el.attr('data-url') || '';
      if (href && href.startsWith('http') && !seen.has(href) && !href.includes(BASE_URL)) {
        seen.add(href);
        servers.push({
          id: servers.length.toString(),
          name: $el.text().trim() || `Server ${servers.length + 1}`,
          iframeUrl: href,
          provider: classifyProvider(href),
        });
      }
    });

    // Look for data attributes with video URLs
    $('[data-video], [data-url], [data-src], [data-server]').each((_, el) => {
      const $el = $(el);
      for (const attr of ['data-video', 'data-url', 'data-src', 'data-server']) {
        const val = $el.attr(attr);
        if (val && val.startsWith('http') && !seen.has(val)) {
          seen.add(val);
          servers.push({
            id: servers.length.toString(),
            name: `Server ${servers.length + 1}`,
            iframeUrl: val,
            provider: classifyProvider(val),
          });
        }
      }
    });

    res.json({
      success: true,
      data: {
        episodeTitle,
        animeTitle,
        animeHref,
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
  if (u.includes('streamwish') || u.includes('wishembed') || u.includes('hgcloud')) return 'streamwish';
  if (u.includes('mp4upload')) return 'mp4upload';
  if (u.includes('videa')) return 'videa';
  if (u.includes('dood') || u.includes('d000d')) return 'doodstream';
  if (u.includes('vidstream') || u.includes('vidcloud')) return 'vidstream';
  if (u.includes('yourupload')) return 'yourupload';
  return 'generic';
}

module.exports = router;

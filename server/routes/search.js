const express = require('express');
const cheerio = require('cheerio');
const { fetchHTML, BASE_URL } = require('../lib/scraper');

const router = express.Router();

/**
 * GET /api/search?q=<query>
 * Searches witanime.you anime directory.
 * The site requires search_param=animes in the query string.
 */
router.get('/', async (req, res) => {
  try {
    const query = (req.query.q || '').trim();
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Query parameter "q" is required',
      });
    }

    const html = await fetchHTML(
      `/?s=${encodeURIComponent(query)}&search_param=animes`
    );
    const $ = cheerio.load(html);

    const results = [];

    // Try anime-card-container (same as homepage pinned section)
    $('.anime-card-container').each((_, el) => {
      const $el = $(el);
      const title = $el.find('.anime-card-title h3 a').text().trim();
      const href = $el.find('.anime-card-poster a.overlay').attr('href') || '';
      const image = $el.find('.anime-card-poster img').attr('src') || '';
      if (title && href) {
        results.push({
          title,
          href,
          image,
          type: $el.find('.anime-card-type a').text().trim(),
          status: $el.find('.anime-card-status a').text().trim(),
          synopsis: $el.find('.anime-card-title a').attr('data-content') || '',
        });
      }
    });

    // Also try the alternative layout: category-posts with article items
    $('.category-posts article').each((_, el) => {
      const $el = $(el);
      const title = $el.find('h3 a').text().trim();
      const href = $el.find('h3 a').attr('href') || '';
      const image = $el.find('img').attr('src') || '';
      if (title && href) {
        results.push({
          title,
          href,
          image,
          synopsis: $el.find('p').first().text().trim(),
        });
      }
    });

    // Deduplicate by href
    const seen = new Set();
    const unique = results.filter((r) => {
      if (seen.has(r.href)) return false;
      seen.add(r.href);
      return true;
    });

    res.json({
      success: true,
      data: {
        query,
        totalResults: unique.length,
        results: unique,
      },
    });
  } catch (err) {
    console.error('[/api/search] Error:', err.message);
    res.status(502).json({
      success: false,
      error: 'Search failed',
      details: err.message,
    });
  }
});

module.exports = router;

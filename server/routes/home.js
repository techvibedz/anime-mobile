const express = require('express');
const cheerio = require('cheerio');
const { fetchHTML, BASE_URL } = require('../lib/scraper');

const router = express.Router();

/**
 * GET /api/home
 *
 * Returns a structured homepage with:
 *   - featured: top slider items with enriched metadata
 *   - sections: categorized shelves (Trending, Recently Updated)
 *
 * Each item includes the highest-quality image URL available,
 * short descriptions (from data-content attributes), and type/status tags.
 */
router.get('/', async (req, res) => {
  try {
    const html = await fetchHTML('/');
    const $ = cheerio.load(html);

    // ── Featured (slider) ──────────────────────────
    const featured = [];
    $('.lucodeia-slider-slide-item').each((_, el) => {
      const $el = $(el);
      const bgStyle = $el.attr('style') || '';
      const imgMatch = bgStyle.match(/url\(['"]?([^'"()]+)['"]?\)/);
      const image = imgMatch ? upgradeImageUrl(imgMatch[1]) : null;

      featured.push({
        title: $el.attr('title') || '',
        href: $el.attr('href') || '',
        image,
        description: $el.find('.slider-details p').text().trim() || null,
        genres: extractTexts($, $el, '.slider-genres a'),
      });
    });

    // ── Pinned Anime (trending) ────────────────────
    const trendingItems = [];
    $('.anime-card-container').each((_, el) => {
      const $el = $(el);
      const titleLink = $el.find('.anime-card-title a').first();
      const img = $el.find('.anime-card-poster img');

      trendingItems.push({
        title: $el.find('.anime-card-title h3 a').text().trim(),
        href: $el.find('.anime-card-poster a.overlay').attr('href') || '',
        image: upgradeImageUrl(
          img.attr('data-src') || img.attr('srcset')?.split(' ')[0] || img.attr('src') || ''
        ),
        type: $el.find('.anime-card-type a').text().trim() || null,
        status: $el.find('.anime-card-status a').text().trim() || null,
        description: titleLink.attr('data-content') || null,
        rating: $el.find('.anime-card-rating').text().trim() || null,
        isNew: ($el.find('.anime-card-status a').text().trim() || '').includes('مستمر'),
      });
    });

    // ── Pinned Episodes (recently updated) ─────────
    const recentItems = [];
    $('.episodes-card-container').each((_, el) => {
      const $el = $(el);
      const img = $el.find('.episodes-card img');

      recentItems.push({
        title: $el.find('.episodes-card-title h3 a').text().trim(),
        href: $el.find('.episodes-card a.overlay').attr('href') || '',
        image: upgradeImageUrl(
          img.attr('data-src') || img.attr('srcset')?.split(' ')[0] || img.attr('src') || ''
        ),
        animeTitle: $el.find('.ep-card-anime-title h3 a').text().trim(),
        animeHref: $el.find('.ep-card-anime-title h3 a').attr('href') || '',
        isNew: true,
      });
    });

    // ── Build sections ─────────────────────────────
    const sections = [];

    if (trendingItems.length > 0) {
      sections.push({
        id: 'trending',
        title: 'Trending Now',
        type: 'anime',
        items: trendingItems,
      });
    }

    if (recentItems.length > 0) {
      sections.push({
        id: 'recently_updated',
        title: 'Recently Updated',
        type: 'episode',
        items: recentItems,
      });
    }

    // Split trending by type if we have enough items
    const tvItems = trendingItems.filter(
      (a) => a.type && (a.type.includes('TV') || a.type.includes('مسلسل'))
    );
    const movieItems = trendingItems.filter(
      (a) => a.type && (a.type.includes('فيلم') || a.type.includes('Movie'))
    );

    if (tvItems.length >= 3) {
      sections.push({
        id: 'tv_series',
        title: 'TV Series',
        type: 'anime',
        items: tvItems,
      });
    }

    if (movieItems.length >= 2) {
      sections.push({
        id: 'movies',
        title: 'Movies',
        type: 'anime',
        items: movieItems,
      });
    }

    res.json({
      success: true,
      data: {
        featured: featured.slice(0, 5),
        sections,
      },
    });
  } catch (err) {
    console.error('[/api/home] Error:', err.message);
    res.status(502).json({
      success: false,
      error: 'Failed to fetch homepage data',
      details: err.message,
    });
  }
});

function extractTexts($, $parent, selector) {
  const texts = [];
  $parent.find(selector).each((_, el) => {
    const t = $(el).text().trim();
    if (t) texts.push(t);
  });
  return texts;
}

function upgradeImageUrl(url) {
  if (!url) return '';
  // Remove common thumbnail suffixes to get full-res image
  return url
    .replace(/-\d+x\d+(?=\.\w+$)/, '')
    .replace(/\?resize=\d+,\d+/, '')
    .replace(/\?w=\d+/, '');
}

module.exports = router;

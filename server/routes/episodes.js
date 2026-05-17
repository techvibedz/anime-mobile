const express = require('express');
const cheerio = require('cheerio');
const { fetchHTML, BASE_URL } = require('../lib/scraper');
const { decodeEpisodeData } = require('../lib/decoder');

const router = express.Router();

/**
 * GET /api/episodes?url=<anime_page_url>
 *
 * Scrapes an anime detail page and returns:
 *   - Full metadata (title, poster, banner, synopsis, genres, rating)
 *   - XOR-decoded episode list
 *   - Related anime from sidebar/footer
 *   - External links (MAL, AniList, etc.)
 */
router.get('/', async (req, res) => {
  try {
    const url = (req.query.url || '').trim();
    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'Query parameter "url" (anime page URL) is required',
      });
    }

    const path = url.replace(BASE_URL, '');
    const html = await fetchHTML(path);
    const $ = cheerio.load(html);

    // ── Anime metadata ────────────────────────────
    const title = $('.anime-details-title').text().trim();

    const posterImg = $('.anime-thumbnail img');
    const poster = upgradeImageUrl(
      posterImg.attr('data-src') || posterImg.attr('src') || ''
    );

    // Banner: try og:image meta, or the poster as fallback
    const ogImage = $('meta[property="og:image"]').attr('content') || '';
    const banner = upgradeImageUrl(ogImage) || poster;

    const synopsis = $('.anime-story').text().trim();

    const genres = [];
    $('.anime-genres a').each((_, el) => {
      genres.push($(el).text().trim());
    });

    // Rating: try multiple selectors
    let rating = null;
    const ratingEl = $('.anime-rating-score, .rating-value, .score').first();
    if (ratingEl.length) {
      rating = ratingEl.text().trim() || null;
    }
    // Also try extracting from metadata
    const ratingMeta = $('meta[itemprop="ratingValue"]').attr('content');
    if (!rating && ratingMeta) rating = ratingMeta;

    const metadata = {};
    $('.anime-info').each((_, el) => {
      const label = $(el).find('span').text().trim().replace(':', '');
      const value = $(el).clone().children().remove().end().text().trim();
      if (label) metadata[label] = value;
    });

    const externalLinks = [];
    $('.anime-external-links a').each((_, el) => {
      externalLinks.push({
        label: $(el).text().trim(),
        href: $(el).attr('href') || '',
      });
    });

    // ── Related anime ─────────────────────────────
    const relatedAnime = [];
    // Try common selectors for related/recommended sections
    const relatedSelectors = [
      '.related-anime .anime-card-container',
      '.related-posts .anime-card-container',
      '.widget-body .anime-card-container',
      '.anime-card-container',
    ];

    // The page's own anime cards (if any in sidebar/related section)
    // Use a different parent to avoid re-capturing the main content
    $('.sidebar .anime-card-container, .related-anime .anime-card-container, .related-section .anime-card-container').each(
      (_, el) => {
        const $el = $(el);
        const relTitle = $el.find('.anime-card-title h3 a').text().trim();
        const relHref =
          $el.find('.anime-card-poster a.overlay').attr('href') || '';
        const relImg = $el.find('.anime-card-poster img');

        if (relTitle && relHref && relHref !== url) {
          relatedAnime.push({
            title: relTitle,
            href: relHref,
            image: upgradeImageUrl(
              relImg.attr('data-src') || relImg.attr('src') || ''
            ),
            type: $el.find('.anime-card-type a').text().trim() || null,
          });
        }
      }
    );

    // ── Episode list ──────────────────────────────
    const rawData = extractProcessedEpisodeData(html);
    const decodedEpisodes = decodeEpisodeData(rawData);

    const episodes = decodedEpisodes.map((ep) => ({
      title: ep.type + ' ' + ep.number,
      number:
        typeof ep.number === 'string' ? parseInt(ep.number, 10) : ep.number,
      type: ep.type || '',
      screenshot: ep.screenshot ? upgradeImageUrl(ep.screenshot) : '',
      href: ep.url ? buildEpisodeUrl(ep.url) : null,
    }));

    res.json({
      success: true,
      data: {
        title,
        poster,
        banner,
        synopsis,
        genres,
        rating,
        metadata,
        externalLinks,
        relatedAnime,
        totalEpisodes: episodes.length,
        episodes,
      },
    });
  } catch (err) {
    console.error('[/api/episodes] Error:', err.message);
    res.status(502).json({
      success: false,
      error: 'Failed to fetch episodes',
      details: err.message,
    });
  }
});

function extractProcessedEpisodeData(html) {
  const match = html.match(
    /var\s+processedEpisodeData\s*=\s*['"]([^'"]+)['"]/
  );
  return match ? match[1] : null;
}

function buildEpisodeUrl(relativePath) {
  if (!relativePath) return null;
  if (relativePath.startsWith('http')) return relativePath;
  return BASE_URL + '/' + relativePath.replace(/^\//, '');
}

function upgradeImageUrl(url) {
  if (!url) return '';
  return url
    .replace(/-\d+x\d+(?=\.\w+$)/, '')
    .replace(/\?resize=\d+,\d+/, '')
    .replace(/\?w=\d+/, '');
}

module.exports = router;

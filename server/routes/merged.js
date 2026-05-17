const express = require('express');
const cheerio = require('cheerio');
const { decodeEpisodeData: decodeWitEpisodes } = require('../lib/decoder');
const puppeteer = require('../lib/puppeteer');
const chrome = require('../lib/chrome-manager');

const router = express.Router();
const BASE_WIT = 'https://witanime.you';
const BASE_4UP = 'https://w1.anime4up.rest';

const cache = new Map();

/* ── Chrome-based fetch (works for both sites) ── */

const CACHE_HOME = 600000;   // 10 minutes for home pages
const CACHE_PAGE = 1800000;  // 30 minutes for anime/episode pages
const CACHE_VIDEO = 86400000; // 24 hours for video extractions

function isCloudflareChallenge(html) {
  if (!html || html.length < 500) return true;
  const lower = html.toLowerCase();
  if (lower.includes('cf-browser-verification')) return true;
  if (lower.includes('cf_chl_opt')) return true;
  if (lower.includes('challenge-platform')) return true;
  if (lower.includes('<title>just a moment</title>')) return true;
  if (lower.includes('<title>لحظة</title>')) return true;
  if (lower.includes('turnstile') && !lower.includes('anime-card')) return true;
  return false;
}

async function fetchViaChrome(url, waitMs = 3000) {
  const key = 'chrome_' + url;
  const isHome = url.endsWith('/') || url.includes('/home');
  const ttl = isHome ? CACHE_HOME : CACHE_PAGE;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < ttl) {
    if (!isCloudflareChallenge(cached.html)) return cached.html;
    cache.delete(key);
  }

  await chrome.ensureReady();
  const browser = await puppeteer.connect({
    browserURL: `http://localhost:${chrome.DEBUG_PORT}`,
    defaultViewport: null,
  });
  let page = null;
  try {
    page = await browser.newPage();
    await page.setRequestInterception(false);

    // Long navigation timeout (45s) + non-fatal: even if goto() times out we keep
    // whatever HTML the page has loaded so far rather than killing the request.
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch (navErr) {
      console.warn('[fetchViaChrome] goto warning ' + url + ': ' + navErr.message);
      // Continue — page may still have usable partial content
    }

    // Wait for Cloudflare challenge to clear — up to 20s
    let cfPassed = false;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        const passed = await page.evaluate(() => {
          const t = (document.title || '').toLowerCase();
          if (t.includes('moment') || t.includes('لحظة') || t.includes('just a moment')) return false;
          if (document.querySelector('.cf-browser-verification, #challenge-form, #cf-please-wait')) return false;
          // require some body content
          return document.body && (document.body.innerText || '').length > 200;
        });
        if (passed) { cfPassed = true; break; }
      } catch {}
    }

    if (!cfPassed) {
      console.warn('[fetchViaChrome] CF not bypassed for: ' + url);
      const html = await page.content().catch(() => '');
      return html || '';
    }

    if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
    const html = await page.content().catch(() => '');

    if (html && html.length > 1000 && !isCloudflareChallenge(html)) {
      cache.set(key, { html, ts: Date.now() });
    }
    return html || '';
  } catch (err) {
    console.error('[fetchViaChrome] ' + url + ': ' + err.message);
    return '';
  } finally {
    if (page) await page.close().catch(() => {});
    await browser.disconnect().catch(() => {});
  }
}

function bestImg($el, $) {
  const img = $el.find('.anime-card-poster img');
  return upgradeImageUrl(
    img.attr('data-image') || img.attr('data-src') || (img.attr('srcset') || '').split(' ')[0] || img.attr('src') || ''
  );
}

function upgradeImageUrl(url) {
  if (!url) return '';
  return url
    .replace(/-\d+x\d+(?=\.\w+$)/, '')
    .replace(/\?resize=\d+,\d+/, '')
    .replace(/\?w=\d+/, '');
}

function norm(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

/** Returns the first N significant words (skip short words) */
function keyWords(str, n = 4) {
  return norm(str).split(' ').filter((w) => w.length > 2).slice(0, n).join(' ');
}

function fuzzyMatch(a, b) {
  const ka = keyWords(a, 4);
  const kb = keyWords(b, 4);
  if (!ka || !kb) return false;
  // Direct substring match
  if (ka.includes(kb) || kb.includes(ka)) return true;
  // At least 3 words match
  const wa = ka.split(' ');
  const wb = kb.split(' ');
  const common = wa.filter((w) => wb.includes(w));
  return common.length >= Math.min(3, Math.min(wa.length, wb.length));
}

/* ── 4up Chrome fetch ──────────────────────── */

async function fetch4up(url, waitMs = 3000) {
  const cached = cache.get('4up_' + url);
  if (cached && Date.now() - cached.ts < CACHE_PAGE) {
    if (!isCloudflareChallenge(cached.html)) return cached.html;
    cache.delete('4up_' + url);
  }
  await chrome.ensureReady();
  const browser = await puppeteer.connect({ browserURL: `http://localhost:${chrome.DEBUG_PORT}`, defaultViewport: null });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await new Promise((r) => setTimeout(r, waitMs));
    const html = await page.content();
    if (html && !isCloudflareChallenge(html)) {
      cache.set('4up_' + url, { html, ts: Date.now() });
    }
    return html || '';
  } finally {
    await browser.disconnect();
  }
}

/* ── Episode page fetch — waits for JS to inject server data ── */

async function fetchEpisodePage(url) {
  const key = 'ep_' + url;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_PAGE) {
    if (!isCloudflareChallenge(cached.html)) return cached.html;
    cache.delete(key);
  }

  await chrome.ensureReady();
  const browser = await puppeteer.connect({
    browserURL: `http://localhost:${chrome.DEBUG_PORT}`,
    defaultViewport: null,
  });
  try {
    const page = await browser.newPage();

    // Use networkidle2 to ensure all JS resources finish loading
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});

    // Wait for CF bypass — check that page has real content, not just site title
    let cfPassed = false;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        cfPassed = await page.evaluate(() => {
          const t = document.title || '';
          if (t.toLowerCase().includes('moment') || t.includes('لحظة')) return false;
          if (document.querySelector('.cf-browser-verification, #challenge-form')) return false;
          // Must have actual content — not just site chrome
          if (document.querySelector('.anime-page-link, .main-section, #episode-servers, iframe')) return true;
          // Also accept if the body has substantial text
          return document.body && document.body.innerText.length > 500;
        });
        if (cfPassed) break;
      } catch {}
    }

    if (!cfPassed) {
      console.warn('[fetchEpisodePage] CF not bypassed or no content: ' + url);
      const html = await page.content();
      await page.close().catch(() => {});
      return html || '';
    }

    // Wait for server data: _zG variable, server tabs, or iframes
    let hasServers = false;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        hasServers = await page.evaluate(() => {
          if (typeof _zG !== 'undefined' && _zG) return true;
          const links = document.querySelectorAll('#episode-servers .server-link, .server-btn, [data-server]');
          if (links.length > 0) return true;
          const iframes = document.querySelectorAll('iframe[src*="mp4upload"], iframe[src*="streamwish"], iframe[src*="dailymotion"], iframe[src*="ok.ru"], iframe[src*="hgcloud"], iframe[src*="dood"]');
          if (iframes.length > 0) return true;
          return false;
        });
        if (hasServers) break;
      } catch {}
    }

    const html = await page.content();
    await page.close().catch(() => {});

    if (html && html.length > 2000 && !isCloudflareChallenge(html)) {
      cache.set(key, { html, ts: Date.now() });
    }
    return html || '';
  } catch (err) {
    console.error('[fetchEpisodePage] ' + url + ': ' + err.message);
    return '';
  } finally {
    await browser.disconnect();
  }
}

/**
 * Click-through extraction: navigates to the episode page, clicks each server
 * tab button and captures the iframe URL that loads after each click.
 * Used as a final fallback when decodeWitServers + static iframe parsing fails.
 */
async function extractServersViaClicks(url) {
  await chrome.ensureReady();
  const browser = await puppeteer.connect({
    browserURL: `http://localhost:${chrome.DEBUG_PORT}`,
    defaultViewport: null,
  });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});

    // Wait for CF + page content
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const ok = await page.evaluate(() => {
        const t = document.title || '';
        if (t.toLowerCase().includes('moment') || t.includes('لحظة')) return false;
        return document.body && document.body.innerText.length > 500;
      }).catch(() => false);
      if (ok) break;
    }

    await new Promise((r) => setTimeout(r, 2000));

    // Click server tabs and capture iframe URLs
    const servers = await page.evaluate(async () => {
      const results = [];
      const seen = new Set();

      const tabs = document.querySelectorAll('#episode-servers .server-link, .server-btn, [data-server], .servers-list a, ul.servers li a, .episode-servers a');

      for (let i = 0; i < tabs.length; i++) {
        const tab = tabs[i];
        const name = (tab.textContent || '').trim() || ('Server ' + (i + 1));
        tab.click();
        await new Promise(r => setTimeout(r, 1000));

        document.querySelectorAll('iframe').forEach(iframe => {
          const src = (iframe.src || iframe.getAttribute('data-src') || '').trim();
          if (src && src.startsWith('http') && !seen.has(src) && !src.includes('google') && !src.includes('facebook') && !src.includes('pyppo')) {
            seen.add(src);
            results.push({ name, iframeUrl: src });
          }
        });
      }

      // Also grab any currently visible iframes not yet captured
      document.querySelectorAll('iframe').forEach(iframe => {
        const src = (iframe.src || '').trim();
        if (src && src.startsWith('http') && !seen.has(src) && !src.includes('google') && !src.includes('facebook') && !src.includes('pyppo')) {
          seen.add(src);
          results.push({ name: 'Server', iframeUrl: src });
        }
      });

      return results;
    });

    await page.close().catch(() => {});
    return servers;
  } catch (err) {
    console.error('[extractServersViaClicks] ' + err.message);
    return [];
  } finally {
    await browser.disconnect();
  }
}

/* ── GET /api/merged/clear-cache ─────────────── */

router.get('/clear-cache', (req, res) => {
  const size = cache.size + epsResponseCache.size + titleMatchCache.size;
  cache.clear();
  epsResponseCache.clear();
  titleMatchCache.clear();
  homeResponseCache = null;
  homeResponseCacheTs = 0;
  console.log('[cache] Cleared ' + size + ' entries');
  res.json({ success: true, cleared: size });
});

/* ── GET /api/merged/home ──────────────────── */

let homeResponseCache = null;
let homeResponseCacheTs = 0;
const HOME_RESPONSE_TTL = 300000; // 5 minutes

router.get('/home', async (req, res) => {
  try {
    if (homeResponseCache && Date.now() - homeResponseCacheTs < HOME_RESPONSE_TTL) {
      return res.json(homeResponseCache);
    }
    // Fetch both sources in parallel
    const [witHtml, up4Html] = await Promise.all([
      fetchViaChrome(BASE_WIT + '/'),
      fetchViaChrome(BASE_4UP + '/home8/'),
    ]);

    const $wit = cheerio.load(witHtml);
    const $up4 = cheerio.load(up4Html);

    // Dedup within witanime itself
    const witSeen = new Set();
    const witItems = [];
    $wit('.anime-card-container').each((_, el) => {
      const $el = $wit(el);
      const href = $el.find('.anime-card-poster a.overlay').attr('href') || '';
      if (witSeen.has(href) || !href) return;
      witSeen.add(href);
      const titleLink = $el.find('.anime-card-title a').first();
      witItems.push({
        title: $el.find('.anime-card-title h3 a').text().trim(),
        href: $el.find('.anime-card-poster a.overlay').attr('href') || '',
        image: bestImg($el, $wit),
        type: $el.find('.anime-card-type a').text().trim() || null,
        status: $el.find('.anime-card-status a').text().trim() || null,
        description: titleLink.attr('data-content') || null,
        isNew: ($el.find('.anime-card-status a').text().trim() || '').includes('مستمر'),
        rating: $el.find('.anime-card-rating').text().trim() || null,
        sources: ['witanime'],
        sourceHrefs: { witanime: $el.find('.anime-card-poster a.overlay').attr('href') || '' },
      });
    });

    // Extract anime4up anime items (deduped within source)
    const up4Seen = new Set();
    const up4Items = [];
    $up4('.anime-card-container').each((_, el) => {
      const $el = $up4(el);
      const href = $el.find('.anime-card-poster a.overlay').attr('href') || '';
      if (up4Seen.has(href) || !href) return;
      up4Seen.add(href);
      up4Items.push({
        title: $el.find('.anime-card-title h3 a').text().trim(),
        href: $el.find('.anime-card-poster a.overlay').attr('href') || '',
        image: bestImg($el, $up4),
        type: $el.find('.anime-card-type a').text().trim() || null,
        isNew: true,
        rating: null,
        source: 'anime4up',
      });
    });

    // Dedup + merge
    const merged = [];
    const used4up = new Set();

    for (const w of witItems) {
      if (!w.title || !w.href) continue;
      // Find matching anime4up item
      const match = up4Items.find((u) => {
        if (used4up.has(u.href)) return false;
        return fuzzyMatch(w.title, u.title);
      });
      if (match) {
        used4up.add(match.href);
        w.sources.push('anime4up');
        w.sourceHrefs.anime4up = match.href;
        // Use better image if available
        if (!w.image && match.image) w.image = match.image;
      }
      merged.push(w);
    }

    // Add unmatched anime4up items (dedup against already-merged)
    const mergedHrefs = new Set(merged.map((m) => m.href));
    for (const u of up4Items) {
      if (!used4up.has(u.href) && u.title && u.href && !mergedHrefs.has(u.href)) {
        merged.push({
          title: u.title,
          href: u.href,
          image: u.image,
          type: u.type,
          status: null,
          isNew: u.isNew,
          rating: null,
          sources: ['anime4up'],
          sourceHrefs: { anime4up: u.href },
        });
      }
    }

    // Featured slider from witanime
    const featured = [];
    $wit('.lucodeia-slider-slide-item').each((_, el) => {
      const $el = $wit(el);
      let href = $el.attr('href') || $el.find('a').first().attr('href') || '';
      if (href && !href.startsWith('http')) href = BASE_WIT + href;
      if (!href) return;
      const bg = ($el.attr('style') || '').match(/url\(['"]?([^'"()]+)['"]?\)/);
      const genres = [];
      $el.find('.slider-genres a').each((_, g) => genres.push($wit(g).text().trim()));
      featured.push({
        title: $el.attr('title') || $el.find('.slider-title').text().trim() || '',
        href,
        image: bg ? upgradeImageUrl(bg[1]) : null,
        description: $el.find('.slider-details p').text().trim() || null,
        genres,
      });
    });

    // ── Recent episodes from witanime ───────────
    const recentEpisodes = [];
    $wit('.episodes-card-container').each((_, el) => {
      const $el = $wit(el);
      const img = $el.find('.episodes-card img');
      recentEpisodes.push({
        title: $el.find('.episodes-card-title h3 a').text().trim(),
        href: $el.find('.episodes-card a.overlay').attr('href') || '',
        image: upgradeImageUrl(
          img.attr('data-image') || img.attr('data-src') || (img.attr('srcset') || '').split(' ')[0] || img.attr('src') || ''
        ),
        animeTitle: $el.find('.ep-card-anime-title h3 a').text().trim(),
        animeHref: $el.find('.ep-card-anime-title h3 a').attr('href') || '',
        isNew: true,
      });
    });

    // ── Build sections ───────────────────────────
    const sections = [];

    if (merged.length > 0) {
      sections.push({
        id: 'trending',
        title: 'Trending Now',
        type: 'anime',
        items: merged,
      });
    }

    if (recentEpisodes.length > 0) {
      sections.push({
        id: 'recently_updated',
        title: 'Recently Updated',
        type: 'episode',
        items: recentEpisodes,
      });
    }

    // Split by type
    const tvItems = merged.filter(
      (a) => a.type && (a.type.includes('TV') || a.type.includes('مسلسل'))
    );
    const movieItems = merged.filter(
      (a) => a.type && (a.type.includes('فيلم') || a.type.includes('Movie'))
    );

    if (tvItems.length >= 3) {
      sections.push({ id: 'tv_series', title: 'TV Series', type: 'anime', items: tvItems });
    }
    if (movieItems.length >= 2) {
      sections.push({ id: 'movies', title: 'Movies', type: 'anime', items: movieItems });
    }

    const response = { success: true, data: { featured: featured.slice(0, 5), sections } };
    if (sections.length > 0) {
      homeResponseCache = response;
      homeResponseCacheTs = Date.now();
    }
    res.json(response);
  } catch (err) {
    console.error('[/api/merged/home]', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

/* ── GET /api/merged/search?q=<query> ──────── */

const SEARCH_CACHE_TTL = 300000; // 5 minutes

router.get('/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.status(400).json({ success: false, error: 'q is required' });

    const searchKey = 'search_' + q.toLowerCase();
    const cached = cache.get(searchKey);
    if (cached && Date.now() - cached.ts < SEARCH_CACHE_TTL) {
      return res.json(cached.data);
    }

    const [witHtml, up4Html] = await Promise.all([
      fetchViaChrome(BASE_WIT + '/?s=' + encodeURIComponent(q) + '&search_param=animes', 1500),
      fetchViaChrome(BASE_4UP + '/home8/?s=' + encodeURIComponent(q) + '&search_param=animes', 1500),
    ]);

    const results = [];
    const seen = new Set();

    function extract($) {
      $('.anime-card-container').each((_, el) => {
        const $el = $(el);
        const t = $el.find('.anime-card-title h3 a').text().trim();
        const h = $el.find('.anime-card-poster a.overlay').attr('href') || '';
        if (t && h && !seen.has(h)) {
          seen.add(h);
          results.push({
            title: t,
            href: h,
            image: bestImg($el, $),
            type: null,
            status: null,
            synopsis: null,
          });
        }
      });
    }

    extract(cheerio.load(witHtml));
    extract(cheerio.load(up4Html));

    const response = { success: true, data: { query: q, totalResults: results.length, results } };
    cache.set(searchKey, { data: response, ts: Date.now() });
    res.json(response);
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

/* ── GET /api/merged/episodes?url=<anime_url> ── */

/**
 * Response-level cache for /episodes — keyed by full URL. 15-minute TTL so users get
 * near-instant loads when re-opening an anime. Cross-source title → URL matches stay
 * cached for 24h since anime URLs are stable.
 */
const epsResponseCache = new Map();
const EPS_CACHE_TTL = 15 * 60 * 1000;
const titleMatchCache = new Map();
const TITLE_MATCH_TTL = 24 * 60 * 60 * 1000;

/** Normalize a title for fuzzy matching across sources (strips quality/season suffixes). */
function normTitle(t) {
  return (t || '')
    .toLowerCase()
    .replace(/[؀-ۿ]+/g, ' ')           // strip Arabic
    .replace(/\b(season|s|part|cour|الموسم|الجزء)\s*\d+\b/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Find the matching anime URL on the OTHER source by searching by title. Cached. */
async function findCrossSourceUrl(title, currentSource) {
  if (!title) return null;
  const key = `${currentSource}:${normTitle(title)}`;
  const cached = titleMatchCache.get(key);
  if (cached && Date.now() - cached.ts < TITLE_MATCH_TTL) return cached.url;

  try {
    const wantTarget = currentSource === 'witanime' ? 'anime4up' : 'witanime';
    const searchBase = wantTarget === 'anime4up' ? BASE_4UP : BASE_WIT;
    // anime4up search lives at the ROOT path, not /home8/ — /home8/?s= returns no results.
    const searchUrl = searchBase + '/?search_param=animes&s=' + encodeURIComponent(title);
    const html = await fetchViaChrome(searchUrl, 1500);
    const $ = cheerio.load(html);
    const want = normTitle(title);
    let bestUrl = null;
    let bestScore = 0;
    $('.anime-card-container').each((_, el) => {
      const $el = $(el);
      const cardTitle = $el.find('.anime-card-title h3 a').text().trim();
      const cardHref = $el.find('.anime-card-poster a.overlay').attr('href') || '';
      if (!cardHref) return;
      const got = normTitle(cardTitle);
      if (!got) return;
      // Score: 100 = exact, otherwise count common word prefix length
      let score = 0;
      if (got === want) score = 100;
      else if (got.startsWith(want) || want.startsWith(got)) score = 80;
      else {
        const wantWords = new Set(want.split(' ').filter((w) => w.length > 2));
        const gotWords = got.split(' ').filter((w) => w.length > 2);
        for (const w of gotWords) if (wantWords.has(w)) score += 10;
      }
      if (score > bestScore) { bestScore = score; bestUrl = cardHref; }
    });
    if (bestScore < 30) bestUrl = null; // require minimum confidence
    titleMatchCache.set(key, { url: bestUrl, ts: Date.now() });
    return bestUrl;
  } catch {
    titleMatchCache.set(key, { url: null, ts: Date.now() });
    return null;
  }
}

/**
 * Extracts the episode number from an anime4up episode URL.
 * Pattern: .../episode/<anime-slug>-الحلقة-N[-suffix]/ where الحلقة is URL-encoded.
 * Decodes the slug and matches the digit sequence that follows the word "الحلقة".
 */
function up4EpisodeNumber(href) {
  if (!href) return null;
  try {
    const decoded = decodeURIComponent(href);
    // Match: الحلقة-NUMBER (anywhere in the URL)
    const m = decoded.match(/الحلقة[\s-]*(\d+)/);
    if (m) return parseInt(m[1], 10);
    // Fallback: last numeric segment in the slug before the trailing slash
    const slug = decoded.replace(/\/$/, '').split('/').pop() || '';
    const tail = slug.match(/-(\d+)(?:[-/].*)?$/);
    if (tail) return parseInt(tail[1], 10);
  } catch {}
  return null;
}

/** Parse anime4up episodes from already-fetched HTML. */
function parseUp4Episodes($) {
  const eps = [];
  const seen = new Set();
  $('a[href*="/episode/"]').each((_, el) => {
    const $el = $(el);
    const t = $el.text().trim();
    const h = $el.attr('href') || '';
    if (!h || seen.has(h)) return;
    seen.add(h);
    const num = up4EpisodeNumber(h);
    if (num == null) return; // skip non-episode links (e.g. "watch and download")
    eps.push({
      title: t || `الحلقة ${num}`,
      number: num,
      type: '',
      screenshot: '',
      href: h.startsWith('http') ? h : BASE_4UP + h,
    });
  });
  return eps;
}

/** Derives a fuzzy title from an anime URL slug for parallel cross-source searches. */
function titleFromSlug(url) {
  try {
    const slug = decodeURIComponent(new URL(url).pathname.replace(/\/$/, '').split('/').pop() || '');
    return slug.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

router.get('/episodes', async (req, res) => {
  try {
    const url = (req.query.url || '').trim();
    if (!url) return res.status(400).json({ success: false, error: 'url is required' });

    // Response-level cache — instant on re-open
    const cached = epsResponseCache.get(url);
    if (cached && Date.now() - cached.ts < EPS_CACHE_TTL) {
      return res.json(cached.payload);
    }

    const isAnime4up = url.includes('anime4up');
    const primarySource = isAnime4up ? 'anime4up' : 'witanime';
    const guessTitle = titleFromSlug(url);

    // Fire primary fetch AND cross-source search in PARALLEL.
    // Cross-source uses the URL-derived title; if that fails we retry below with the real one.
    const [primaryHtml, initialCrossUrl] = await Promise.all([
      fetchViaChrome(url, 1500),
      guessTitle ? findCrossSourceUrl(guessTitle, primarySource).catch(() => null) : Promise.resolve(null),
    ]);

    const $p = cheerio.load(primaryHtml);
    const title = $p('.anime-details-title').text().trim() || $p('h1').first().text().trim() || guessTitle;
    const posterImg = $p('.anime-thumbnail img');
    const poster = posterImg.attr('data-image') || posterImg.attr('src') || '';
    const synopsis = $p('.anime-story').text().trim();
    const genres = [];
    $p('.anime-genres a').each((_, el) => genres.push($p(el).text().trim()));

    let witEps = [];
    let up4Eps = [];
    if (isAnime4up) up4Eps = parseUp4Episodes($p);
    else {
      const witRaw = extractEpisodeData(primaryHtml);
      witEps = decodeWitEpisodes(witRaw).map((ep) => ({
        title: (ep.type || '') + ' ' + ep.number,
        number: typeof ep.number === 'string' ? parseInt(ep.number, 10) : ep.number,
        type: ep.type || '',
        screenshot: ep.screenshot || '',
        href: ep.url ? (ep.url.startsWith('http') ? ep.url : BASE_WIT + '/' + ep.url.replace(/^\//, '')) : null,
      }));
    }

    // Resolve cross-source URL: prefer the parallel lookup result; retry once with real title.
    let crossUrl = initialCrossUrl;
    if (!crossUrl && title && title !== guessTitle) {
      try { crossUrl = await findCrossSourceUrl(title, primarySource); } catch {}
    }

    if (crossUrl) {
      try {
        const crossHtml = await fetchViaChrome(crossUrl, 1500);
        const $c = cheerio.load(crossHtml);
        if (isAnime4up) {
          const witRaw = extractEpisodeData(crossHtml);
          witEps = decodeWitEpisodes(witRaw).map((ep) => ({
            title: (ep.type || '') + ' ' + ep.number,
            number: typeof ep.number === 'string' ? parseInt(ep.number, 10) : ep.number,
            type: ep.type || '',
            screenshot: ep.screenshot || '',
            href: ep.url ? (ep.url.startsWith('http') ? ep.url : BASE_WIT + '/' + ep.url.replace(/^\//, '')) : null,
          }));
        } else {
          up4Eps = parseUp4Episodes($c);
        }
      } catch (err) {
        console.warn('[/episodes cross-source] ' + (err.message || ''));
      }
    }

    // Always present witanime episodes as primary (richer metadata: screenshots, types).
    // Fall back to anime4up if no witanime episodes found.
    const primaryEps = witEps.length > 0 ? witEps : up4Eps;
    const up4AnimeUrl = isAnime4up ? url : crossUrl;

    const payload = {
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
        totalEpisodes: primaryEps.length,
        episodes: primaryEps,
        episodes4up: up4Eps,
        merged: up4AnimeUrl ? { anime4up: up4AnimeUrl } : null,
      },
    };

    if (primaryEps.length > 0) {
      epsResponseCache.set(url, { payload, ts: Date.now() });
    }
    res.json(payload);
  } catch (err) {
    console.error('[/api/merged/episodes]', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

/* ── GET /api/merged/recent?page=<num> ─────── */

router.get('/recent', async (req, res) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    // /episode/page/N/ archive page works for ALL pages (1, 2, 3, ...) — ~48 cards each.
    // The site has thousands of pages so hasNext can default to true.
    const pageUrl = BASE_WIT + '/episode/page/' + page + '/';

    const html = await fetchViaChrome(pageUrl, 2000);
    const $ = cheerio.load(html);

    const episodes = [];
    const seen = new Set();

    // Episode-archive pages use .anime-card-container with episode hrefs.
    $('.anime-card-container').each((_, el) => {
      const $el = $(el);
      const href = $el.find('.anime-card-poster a.overlay').attr('href') || '';
      if (!href || seen.has(href)) return;
      seen.add(href);
      const img = $el.find('.anime-card-poster img');
      const animeTitle = $el.find('.anime-card-title h3 a, .anime-card-title a').first().text().trim();
      const badge = $el.find('.anime-card-status, [class*="episode"]').first().text().trim();
      episodes.push({
        title: badge ? `${animeTitle} - ${badge}` : animeTitle,
        href,
        image: upgradeImageUrl(
          img.attr('data-image') || img.attr('data-src') || (img.attr('srcset') || '').split(' ')[0] || img.attr('src') || ''
        ),
        animeTitle,
        animeHref: href, // archive cards link directly to the episode
        isNew: true,
      });
    });

    // Fallback for page 1: also try home page format (.episodes-card-container)
    if (episodes.length === 0 && page === 1) {
      const homeHtml = await fetchViaChrome(BASE_WIT + '/', 2000);
      const $h = cheerio.load(homeHtml);
      $h('.episodes-card-container').each((_, el) => {
        const $el = $h(el);
        const href = $el.find('.episodes-card a.overlay').attr('href') || '';
        if (!href || seen.has(href)) return;
        seen.add(href);
        const img = $el.find('.episodes-card img');
        episodes.push({
          title: $el.find('.episodes-card-title h3 a').text().trim(),
          href,
          image: upgradeImageUrl(
            img.attr('data-image') || img.attr('data-src') || (img.attr('srcset') || '').split(' ')[0] || img.attr('src') || ''
          ),
          animeTitle: $el.find('.ep-card-anime-title h3 a').text().trim(),
          animeHref: $el.find('.ep-card-anime-title h3 a').attr('href') || '',
          isNew: true,
        });
      });
    }

    // The site reports thousands of pages — there's always more unless this page came back empty.
    const hasNext = episodes.length > 0;
    res.json({ success: true, data: { page, episodes, hasNext } });
  } catch (err) {
    console.error('[/api/merged/recent]', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

/* ── GET /api/merged/all-anime?page=<num> ──── */

const ALL_ANIME_PATH = encodeURIComponent('قائمة-الانمي');

router.get('/all-anime', async (req, res) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const pageUrl = page === 1
      ? `${BASE_WIT}/${ALL_ANIME_PATH}/`
      : `${BASE_WIT}/${ALL_ANIME_PATH}/page/${page}/`;

    const html = await fetchViaChrome(pageUrl, 1500);
    const $ = cheerio.load(html);
    const items = [];
    const seen = new Set();
    $('.anime-card-container').each((_, el) => {
      const $el = $(el);
      const href = $el.find('.anime-card-poster a.overlay').attr('href') || '';
      if (!href || seen.has(href) || !href.includes('/anime/')) return;
      seen.add(href);
      const img = $el.find('.anime-card-poster img');
      items.push({
        title: $el.find('.anime-card-title h3 a, .anime-card-title a').first().text().trim(),
        href,
        image: upgradeImageUrl(
          img.attr('data-image') || img.attr('data-src') || (img.attr('srcset') || '').split(' ')[0] || img.attr('src') || ''
        ),
        type: $el.find('.anime-card-type a').text().trim() || null,
        status: $el.find('.anime-card-status a').text().trim() || null,
        synopsis: null,
      });
    });
    res.json({ success: true, data: { page, items, hasNext: items.length > 0 } });
  } catch (err) {
    console.error('[/api/merged/all-anime]', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

/* ── GET /api/merged/extract-video?url=<wit_url>&url4up=<up4_url> ─ */

router.get('/extract-video', async (req, res) => {
  try {
    const url = (req.query.url || '').trim();
    const url4up = (req.query.url4up || '').trim();
    if (!url) return res.status(400).json({ success: false, error: 'url is required' });

    // Check video extraction cache
    const videoKey = `video_${url}_${url4up || ''}`;
    const videoCached = cache.get(videoKey);
    if (videoCached && Date.now() - videoCached.ts < CACHE_VIDEO) {
      return res.json({ success: true, data: videoCached.data });
    }

    const isAnime4up = url.includes('anime4up');
    const servers = [];
    let episodeTitle = '';
    let animeTitle = '';

    if (isAnime4up) {
      // Primary is anime4up
      const up4Html = await fetch4up(url, 4000);
      const $ = cheerio.load(up4Html);
      episodeTitle = $('h1').first().text().trim() || $('.episode-title').text().trim();
      animeTitle = $('.anime-page-link a').text().trim() || $('h1').first().text().trim();
      const up4Servers = extract4upServers(up4Html);
      for (const s of up4Servers) {
        servers.push({
          id: servers.length.toString(),
          name: s.name,
          iframeUrl: s.iframeUrl,
          provider: classifyProvider(s.iframeUrl),
          source: 'anime4up',
        });
      }
    } else {
      // Primary is witanime — use deep fetch that waits for JS-injected server data
      const witHtml = await fetchEpisodePage(url);
      const $wit = cheerio.load(witHtml);
      episodeTitle = $wit('.main-section h3').first().text().trim() || $wit('h1').first().text().trim();
      animeTitle = $wit('.anime-page-link a').text().trim();

      // Try encrypted server decode first
      const witServers = decodeWitServers(witHtml).map((s) => ({
        ...s,
        source: 'witanime',
      }));
      servers.push(...witServers);

      // Fallback 1: extract iframes from static HTML
      if (servers.length === 0) {
        const seen = new Set();
        $wit('iframe').each((_, el) => {
          const src = ($wit(el).attr('src') || '').trim();
          if (src && src.startsWith('http') && !seen.has(src)) {
            seen.add(src);
            servers.push({
              id: servers.length.toString(),
              name: 'Server ' + (servers.length + 1),
              iframeUrl: src,
              provider: classifyProvider(src),
              source: 'witanime',
            });
          }
        });
        $wit('a[href*="mp4upload"], a[href*="streamwish"], a[href*="dailymotion"], a[href*="ok.ru"]').each((_, el) => {
          const href = ($wit(el).attr('href') || '').trim();
          if (href && !seen.has(href)) {
            seen.add(href);
            servers.push({
              id: servers.length.toString(),
              name: $wit(el).text().trim() || 'Server ' + (servers.length + 1),
              iframeUrl: href,
              provider: classifyProvider(href),
              source: 'witanime',
            });
          }
        });
      }

      // Fallback 2: click server tabs in browser to reveal hidden iframes
      if (servers.length <= 1) {
        console.log('[extract-video] Using click-through extraction for: ' + url);
        const clickResults = await extractServersViaClicks(url);
        if (clickResults.length > 0) {
          const existingUrls = new Set(servers.map((s) => s.iframeUrl));
          for (const cr of clickResults) {
            if (!existingUrls.has(cr.iframeUrl)) {
              existingUrls.add(cr.iframeUrl);
              servers.push({
                id: servers.length.toString(),
                name: cr.name,
                iframeUrl: cr.iframeUrl,
                provider: classifyProvider(cr.iframeUrl),
                source: 'witanime',
              });
            }
          }
        }
      }
    }

    // Fetch additional servers from the other source
    const extraUrl = isAnime4up ? null : url4up;
    if (extraUrl) {
      const up4Html = await fetch4up(extraUrl, 4000);
      const up4Servers = extract4upServers(up4Html);
      const seen = new Set(servers.map((s) => s.iframeUrl));
      for (const s of up4Servers) {
        if (!seen.has(s.iframeUrl)) {
          seen.add(s.iframeUrl);
          servers.push({
            id: servers.length.toString(),
            name: s.name,
            iframeUrl: s.iframeUrl,
            provider: classifyProvider(s.iframeUrl),
            source: 'anime4up',
          });
        }
      }
    }

    const filtered = filterServers(servers);
    const data = {
      episodeTitle,
      animeTitle,
      animeHref: '',
      serverCount: filtered.length,
      servers: filtered,
      navigation: { prev: null, next: null },
    };
    // Only cache if we actually found servers
    if (filtered.length > 0) {
      cache.set(videoKey, { data, ts: Date.now() });
    }
    res.json({ success: true, data });
  } catch (err) {
    console.error('[/api/merged/extract-video]', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

/* ── Helpers ────────────────────────────────── */

function decodeWitServers(html) {
  const zG = extractVar(html, '_zG');
  const zH = extractVar(html, '_zH');
  if (!zG || !zH) return [];

  try {
    const rr = JSON.parse(Buffer.from(zG, 'base64').toString('utf8'));
    const cr = JSON.parse(Buffer.from(zH, 'base64').toString('utf8'));
    const $ = cheerio.load(html);
    const names = [];
    $('#episode-servers .server-link').each((_, el) => names.push($(el).find('.ser').text().trim()));

    const servers = [];
    for (let i = 0; i < rr.length; i++) {
      let r = rr[i].split('').reverse().join('');
      r = r.replace(/[^A-Za-z0-9+/=]/g, '');
      const off = cr[i].d[parseInt(Buffer.from(cr[i].k, 'base64').toString('utf8'), 10)];
      const d = Buffer.from(r, 'base64').toString('utf8').slice(0, -off || undefined);
      const name = names[i] || Buffer.from(cr[i].v, 'base64').toString('utf8');
      servers.push({ id: i.toString(), name, iframeUrl: d.trim(), provider: classifyProvider(d) });
    }

    // Append yonaplay API key
    const KEY = '23a97133-caf3-4eb4-9466-93d0a4ff8198';
    return servers.map((s) => {
      if (s.provider === 'yonaplay' && /yonaplay\.net\/embed\.php\?id=\d+/.test(s.iframeUrl)) {
        s.iframeUrl += '&apiKey=' + KEY;
      }
      return s;
    });
  } catch {
    return [];
  }
}

/**
 * Extracts all video servers from an anime4up episode page.
 * Servers are in #episode-servers li[data-watch] elements.
 * Each LI's text starts with the human-readable server name (e.g. "megamax [HD]").
 */
function extract4upServers(html) {
  if (!html) return [];
  const $ = cheerio.load(html);
  const out = [];
  const seen = new Set();

  // Primary: #episode-servers li[data-watch]
  $('#episode-servers li[data-watch], li[data-watch]').each((_, el) => {
    const $el = $(el);
    const url = ($el.attr('data-watch') || '').trim();
    if (!url || !url.startsWith('http') || seen.has(url)) return;
    seen.add(url);

    // Extract name from the LI's inner HTML BEFORE the nested <iframe>.
    // anime4up renders each tab as: <li data-watch="url">Name [QUAL]<iframe ...></iframe></li>
    // Strip any HTML tags from the prefix to get the clean human-readable name.
    const rawHtml = $el.html() || '';
    const before = rawHtml.split(/<iframe/i)[0];
    let name = before.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
    if (!name) name = 'Server ' + (out.length + 1);

    out.push({ name, iframeUrl: url });
  });

  // Fallback: visible iframes (when no data-watch elements present)
  if (out.length === 0) {
    $('iframe').each((_, el) => {
      const src = ($(el).attr('src') || $(el).attr('data-src') || '').trim();
      if (src && src.startsWith('http') && !seen.has(src)) {
        seen.add(src);
        out.push({ name: 'Server ' + (out.length + 1), iframeUrl: src });
      }
    });
  }

  return out;
}

function extractVar(html, name) {
  const m = html.match(new RegExp(name + '\\s*=\\s*"([^"]*)"', 's'))
         || html.match(new RegExp(name + "\\s*=\\s*'([^']*)'", 's'));
  return m ? m[1] : null;
}

function extractEpisodeData(html) {
  const m = html.match(/var\s+processedEpisodeData\s*=\s*['"]([^'"]+)['"]/);
  return m ? m[1] : null;
}

const BLOCKED_PROVIDERS = ['yonaplay'];

function classifyProvider(url) {
  if (!url) return 'generic';
  const u = url.toLowerCase();
  if (u.includes('yonaplay')) return 'yonaplay';
  if (u.includes('streamwish') || u.includes('hgcloud') || u.includes('wishembed') || u.includes('wishfast') || u.includes('jwembed') || u.includes('hlswish')) return 'streamwish';
  if (u.includes('mp4upload')) return 'mp4upload';
  if (u.includes('videa')) return 'videa';
  if (u.includes('dailymotion') || u.includes('dai.ly')) return 'dailymotion';
  if (u.includes('dood') || u.includes('d000d') || u.includes('dsvplay') || u.includes('ds2play') || u.includes('dsvideo')) return 'doodstream';
  if (u.includes('uqload') || u.includes('upstream.to')) return 'uqload';
  if (u.includes('ok.ru') || u.includes('odnoklassniki')) return 'okru';
  if (u.includes('share4max') || u.includes('megamax')) return 'share4max';
  if (u.includes('mega.nz') || u.includes('mega.co.nz')) return 'mega';
  if (u.includes('voe.sx') || u.includes('voe-network') || u.includes('voe.')) return 'voe';
  if (u.includes('vkvideo') || u.includes('vk.com/video') || u.includes('vk.ru/video')) return 'vk';
  if (u.includes('larhu')) return 'larhu';
  return 'generic';
}

function filterServers(servers) {
  return servers.filter((s) => !BLOCKED_PROVIDERS.includes(s.provider));
}

/* ── GET /api/merged/genre?name=<genre>&page=<num> ── */

const GENRE_URL_MAP = {
  'Action': 'أكشن', 'Adventure': 'مغامرات', 'Comedy': 'كوميدي',
  'Drama': 'دراما', 'Fantasy': 'خيال', 'Horror': 'رعب',
  'Mystery': 'غموض', 'Romance': 'رومانسي', 'Sci-Fi': 'خيال-علمي',
  'Slice of Life': 'حياة-يومية', 'Sports': 'رياضي',
  'Supernatural': 'خارق-للطبيعة', 'Thriller': 'إثارة',
  'Mecha': 'ميكا', 'Shounen': 'شونين', 'Seinen': 'سينين',
};

router.get('/genre', async (req, res) => {
  try {
    const name = (req.query.name || '').trim();
    const page = parseInt(req.query.page || '1', 10);
    if (!name) return res.status(400).json({ success: false, error: 'name is required' });

    const arabicSlug = GENRE_URL_MAP[name] || encodeURIComponent(name);
    const pageUrl = page === 1
      ? `${BASE_WIT}/anime-genre/${arabicSlug}/`
      : `${BASE_WIT}/anime-genre/${arabicSlug}/page/${page}/`;

    const html = await fetchViaChrome(pageUrl, 2000);
    const $ = cheerio.load(html);

    const items = [];
    $('.anime-card-container').each((_, el) => {
      const $el = $(el);
      items.push({
        title: $el.find('.anime-card-title h3 a').text().trim(),
        href: $el.find('.anime-card-poster a.overlay').attr('href') || '',
        image: bestImg($el, $),
        type: $el.find('.anime-card-type a').text().trim() || null,
      });
    });

    const hasNext = page === 1 ? items.length >= 50 && $('a.next, .pagination .next, .page-numbers .next').length > 0 : items.length >= 10;
    res.json({ success: true, data: { genre: name, page, items, hasNext } });
  } catch (err) {
    console.error('[/api/merged/genre]', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

module.exports = router;

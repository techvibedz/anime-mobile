// JavaScript injected into hidden WebView. All extractors are self-contained
// IIFEs that postMessage results back to RN. Communication contract:
//   { type: 'result', data: <any> }   — final answer
//   { type: 'error',  message: string } — failure
//
// Common pattern: wait for Cloudflare to clear + selector to appear, then
// scrape DOM. All selectors mirror the cheerio queries from
// server/routes/merged.js.

const HELPERS = `
function _send(type, payload) {
  try { window.ReactNativeWebView.postMessage(JSON.stringify(Object.assign({type:type}, payload))); } catch (e) {}
}
function _upgradeImg(u) {
  if (!u) return null;
  return String(u).replace(/-\\d+x\\d+(\\.\\w+)$/, '$1').replace(/\\?resize=\\d+,\\d+/, '').replace(/\\?w=\\d+/, '');
}
function _bestImg(el) {
  var img = el.querySelector('img');
  if (!img) return null;
  var src = img.getAttribute('data-image') || img.getAttribute('data-src')
         || (img.getAttribute('srcset') || '').split(' ')[0]
         || img.getAttribute('src') || '';
  return _upgradeImg(src);
}
function _absUrl(href, base) {
  if (!href) return '';
  if (/^https?:/.test(href)) return href;
  if (href.indexOf('//') === 0) return 'https:' + href;
  return base + (href.charAt(0) === '/' ? '' : '/') + href;
}
function _waitFor(checkFn, doneFn, timeoutMs, intervalMs) {
  intervalMs = intervalMs || 500;
  timeoutMs = timeoutMs || 25000;
  var start = Date.now();
  var iv = setInterval(function () {
    var cfActive = !!document.querySelector('#challenge-running, .cf-browser-verification, #challenge-stage, #cf-challenge-running, #cf-please-wait');
    var t = (document.title || '').toLowerCase();
    if (t.indexOf('moment') >= 0 || t.indexOf('لحظة') >= 0) cfActive = true;
    if (!cfActive) {
      try {
        if (checkFn()) {
          clearInterval(iv);
          doneFn(true);
          return;
        }
      } catch (e) {}
    }
    if (Date.now() - start > timeoutMs) {
      clearInterval(iv);
      doneFn(false, cfActive ? 'cf-still-active' : 'timeout');
    }
  }, intervalMs);
}
`;

const WIT_BASE = "https://witanime.you";
const UP4_BASE = "https://w1.anime4up.rest";

// ──────────────────────────────────────────────────────────────
// HOME (witanime) — featured slider + anime cards + recent episodes
// ──────────────────────────────────────────────────────────────
export const EXTRACT_HOME_WIT = `(function(){${HELPERS}
function scrape() {
  var featured = [];
  document.querySelectorAll('.lucodeia-slider-slide-item').forEach(function (el) {
    var href = el.getAttribute('href') || (el.querySelector('a') && el.querySelector('a').getAttribute('href')) || '';
    if (!href) return;
    href = _absUrl(href, '${WIT_BASE}');
    var bgMatch = (el.getAttribute('style') || '').match(/url\\(['"]?([^'"()]+)['"]?\\)/);
    var genres = [];
    el.querySelectorAll('.slider-genres a').forEach(function (g) { genres.push(g.textContent.trim()); });
    featured.push({
      title: el.getAttribute('title') || (el.querySelector('.slider-title') && el.querySelector('.slider-title').textContent.trim()) || '',
      href: href,
      image: bgMatch ? _upgradeImg(bgMatch[1]) : null,
      description: (el.querySelector('.slider-details p') && el.querySelector('.slider-details p').textContent.trim()) || null,
      genres: genres,
    });
  });

  var seen = {};
  var animes = [];
  document.querySelectorAll('.anime-card-container').forEach(function (el) {
    var hrefEl = el.querySelector('.anime-card-poster a.overlay');
    var href = (hrefEl && hrefEl.getAttribute('href')) || '';
    if (!href || seen[href]) return;
    seen[href] = true;
    var titleEl = el.querySelector('.anime-card-title h3 a');
    var typeEl = el.querySelector('.anime-card-type a');
    var statusEl = el.querySelector('.anime-card-status a');
    var ratingEl = el.querySelector('.anime-card-rating');
    var titleLink = el.querySelector('.anime-card-title a');
    animes.push({
      title: (titleEl && titleEl.textContent.trim()) || '',
      href: href,
      image: _bestImg(el),
      type: (typeEl && typeEl.textContent.trim()) || null,
      status: (statusEl && statusEl.textContent.trim()) || null,
      description: (titleLink && titleLink.getAttribute('data-content')) || null,
      isNew: ((statusEl && statusEl.textContent.trim()) || '').indexOf('مستمر') >= 0,
      rating: (ratingEl && ratingEl.textContent.trim()) || null,
    });
  });

  var episodes = [];
  document.querySelectorAll('.episodes-card-container').forEach(function (el) {
    var hrefEl = el.querySelector('.episodes-card a.overlay');
    var titleEl = el.querySelector('.episodes-card-title h3 a');
    var animeEl = el.querySelector('.ep-card-anime-title h3 a');
    episodes.push({
      title: (titleEl && titleEl.textContent.trim()) || '',
      href: (hrefEl && hrefEl.getAttribute('href')) || '',
      image: _bestImg(el),
      animeTitle: (animeEl && animeEl.textContent.trim()) || '',
      animeHref: (animeEl && animeEl.getAttribute('href')) || '',
      isNew: true,
    });
  });

  return { featured: featured.slice(0, 5), animes: animes, episodes: episodes };
}
_waitFor(
  function(){ return !!document.querySelector('.anime-card-container, .lucodeia-slider-slide-item, .episodes-card-container'); },
  function(ok, reason){ if (ok) _send('result', { data: scrape() }); else _send('error', { message: reason }); },
  25000
);
})();true;`;

// ──────────────────────────────────────────────────────────────
// HOME (anime4up) — anime cards only
// ──────────────────────────────────────────────────────────────
export const EXTRACT_HOME_4UP = `(function(){${HELPERS}
function scrape() {
  var seen = {};
  var animes = [];
  document.querySelectorAll('.anime-card-container').forEach(function (el) {
    var hrefEl = el.querySelector('.anime-card-poster a.overlay');
    var href = (hrefEl && hrefEl.getAttribute('href')) || '';
    if (!href || seen[href]) return;
    seen[href] = true;
    var titleEl = el.querySelector('.anime-card-title h3 a');
    var typeEl = el.querySelector('.anime-card-type a');
    animes.push({
      title: (titleEl && titleEl.textContent.trim()) || '',
      href: href,
      image: _bestImg(el),
      type: (typeEl && typeEl.textContent.trim()) || null,
    });
  });
  return { animes: animes };
}
_waitFor(
  function(){ return !!document.querySelector('.anime-card-container'); },
  function(ok, reason){ if (ok) _send('result', { data: scrape() }); else _send('error', { message: reason }); },
  20000
);
})();true;`;

// ──────────────────────────────────────────────────────────────
// EPISODES — anime detail + episode list (witanime).
// Episodes are stored in window.processedEpisodeData as
// '<base64_encrypted>.<base64_key>' and decoded via XOR. We replicate
// that decoder client-side instead of trying to scrape rendered DOM
// (which uses onclick handlers, not anchors, and is unreliable).
// ──────────────────────────────────────────────────────────────
export const EXTRACT_EPISODES_WIT = `(function(){${HELPERS}
function decodeEpisodeData(raw) {
  if (!raw) return [];
  try {
    var parts = String(raw).split('.');
    if (parts.length !== 2) return [];
    var encBin = atob(parts[0]);
    var keyBin = atob(parts[1]);
    var bytes = new Uint8Array(encBin.length);
    for (var i = 0; i < encBin.length; i++) {
      bytes[i] = encBin.charCodeAt(i) ^ keyBin.charCodeAt(i % keyBin.length);
    }
    var json = (typeof TextDecoder !== 'undefined')
      ? new TextDecoder('utf-8').decode(bytes)
      : String.fromCharCode.apply(null, bytes);
    return JSON.parse(json);
  } catch (e) { return []; }
}
function findProcessedData() {
  // 1) Live JS variable set by the site's own scripts
  try { if (typeof window.processedEpisodeData === 'string') return window.processedEpisodeData; } catch (e) {}
  // 2) Fallback: scan inline <script> tags for the raw assignment
  var scripts = document.querySelectorAll('script');
  for (var i = 0; i < scripts.length; i++) {
    var t = scripts[i].textContent || '';
    var m = t.match(/processedEpisodeData\\s*=\\s*['"]([^'"]+)['"]/);
    if (m) return m[1];
  }
  return null;
}
function scrape() {
  var titleEl = document.querySelector('.anime-details-title') || document.querySelector('h1');
  var posterImg = document.querySelector('.anime-thumbnail img');
  var synopsisEl = document.querySelector('.anime-story');
  var genres = [];
  document.querySelectorAll('.anime-genres a').forEach(function (a) { genres.push(a.textContent.trim()); });

  var raw = findProcessedData();
  var decoded = decodeEpisodeData(raw);
  var episodes = decoded.map(function (ep) {
    var url = ep.url || '';
    if (url && url.indexOf('http') !== 0) url = 'https://witanime.you/' + url.replace(/^\\//, '');
    var num = typeof ep.number === 'string' ? parseInt(ep.number, 10) : (ep.number || 0);
    return {
      title: ((ep.type || '') + ' ' + (ep.number != null ? ep.number : '')).trim() || ('Episode ' + num),
      number: num,
      type: ep.type || '',
      screenshot: ep.screenshot || '',
      href: url || null,
    };
  }).filter(function (e) { return e.href; });
  episodes.sort(function (a, b) { return a.number - b.number; });

  // DOM fallback if decoder yielded nothing
  if (episodes.length === 0) {
    var seen = {};
    document.querySelectorAll('a[href*="/episode/"]').forEach(function (a) {
      var href = a.getAttribute('href') || '';
      if (!href || seen[href] || !/\\/episode\\//.test(href)) return;
      seen[href] = true;
      var label = (a.textContent || '').trim();
      var numMatch = label.match(/(\\d+)/) || href.match(/(\\d+)\\/?$/);
      var num = numMatch ? parseInt(numMatch[1], 10) : episodes.length + 1;
      episodes.push({ title: label || ('Episode ' + num), number: num, type: '', screenshot: '', href: href });
    });
    episodes.sort(function (a, b) { return a.number - b.number; });
  }

  return {
    title: (titleEl && titleEl.textContent.trim()) || '',
    poster: (posterImg && (posterImg.getAttribute('data-image') || posterImg.getAttribute('src'))) || '',
    synopsis: (synopsisEl && synopsisEl.textContent.trim()) || '',
    genres: genres,
    episodes: episodes,
    _debug: { hasProcessedData: !!raw, decodedCount: decoded.length },
  };
}
// Wait for either processedEpisodeData OR detail-title to appear (CF passed).
_waitFor(
  function(){
    return !!findProcessedData()
        || !!document.querySelector('.anime-details-title, .anime-page-link, .anime-thumbnail');
  },
  function(ok, reason){
    if (ok) {
      // Give the site's own JS up to 2.5s to populate processedEpisodeData
      // if it wasn't there at the wait check.
      setTimeout(function(){ _send('result', { data: scrape() }); }, 2500);
    } else {
      _send('error', { message: reason });
    }
  },
  25000
);
})();true;`;

// ──────────────────────────────────────────────────────────────
// EPISODES (anime4up) — list page with episode anchors
// ──────────────────────────────────────────────────────────────
export const EXTRACT_EPISODES_4UP = `(function(){${HELPERS}
function up4EpisodeNumber(href) {
  if (!href) return null;
  try {
    var decoded = decodeURIComponent(href);
    var m = decoded.match(/الحلقة[\\s-]*(\\d+)/);
    if (m) return parseInt(m[1], 10);
    var slug = decoded.replace(/\\/$/, '').split('/').pop() || '';
    var tail = slug.match(/-(\\d+)(?:[-/].*)?$/);
    if (tail) return parseInt(tail[1], 10);
  } catch(e) {}
  return null;
}
function scrape() {
  var titleEl = document.querySelector('.anime-details-title') || document.querySelector('h1');
  var posterImg = document.querySelector('.anime-thumbnail img');
  var synopsisEl = document.querySelector('.anime-story');
  var genres = [];
  document.querySelectorAll('.anime-genres a').forEach(function (a) { genres.push(a.textContent.trim()); });

  var seen = {};
  var episodes = [];
  document.querySelectorAll('a[href*="/episode/"]').forEach(function (a) {
    var href = a.getAttribute('href') || '';
    if (!href || seen[href]) return;
    var num = up4EpisodeNumber(href);
    if (num == null) return;
    seen[href] = true;
    var t = (a.textContent || '').trim();
    episodes.push({
      title: t || ('الحلقة ' + num),
      number: num,
      type: '',
      screenshot: '',
      href: _absUrl(href, '${UP4_BASE}'),
    });
  });
  episodes.sort(function (a, b) { return a.number - b.number; });

  return {
    title: (titleEl && titleEl.textContent.trim()) || '',
    poster: (posterImg && (posterImg.getAttribute('data-image') || posterImg.getAttribute('src'))) || '',
    synopsis: (synopsisEl && synopsisEl.textContent.trim()) || '',
    genres: genres,
    episodes: episodes,
  };
}
_waitFor(
  function(){ return !!document.querySelector('a[href*="/episode/"], .anime-details-title'); },
  function(ok, reason){
    if (ok) setTimeout(function(){ _send('result', { data: scrape() }); }, 1500);
    else _send('error', { message: reason });
  },
  25000
);
})();true;`;

// ──────────────────────────────────────────────────────────────
// SEARCH — anime card grid
// ──────────────────────────────────────────────────────────────
export const EXTRACT_SEARCH = `(function(){${HELPERS}
function scrape() {
  var seen = {};
  var results = [];
  document.querySelectorAll('.anime-card-container').forEach(function (el) {
    var hrefEl = el.querySelector('.anime-card-poster a.overlay');
    var titleEl = el.querySelector('.anime-card-title h3 a');
    var href = (hrefEl && hrefEl.getAttribute('href')) || '';
    var title = (titleEl && titleEl.textContent.trim()) || '';
    if (!href || !title || seen[href]) return;
    seen[href] = true;
    results.push({ title: title, href: href, image: _bestImg(el), type: null, status: null, synopsis: null });
  });
  return { results: results };
}
_waitFor(
  function(){ return !!document.querySelector('.anime-card-container, .search-results, .no-results'); },
  function(ok, reason){
    // For search, empty results page is also a valid outcome
    if (ok || document.querySelector('.no-results, .search-empty')) _send('result', { data: scrape() });
    else _send('error', { message: reason });
  },
  20000
);
})();true;`;

// ──────────────────────────────────────────────────────────────
// RECENT — paginated episode archive (.anime-card-container with episode hrefs)
// ──────────────────────────────────────────────────────────────
export const EXTRACT_RECENT = `(function(){${HELPERS}
function scrape() {
  var seen = {};
  var episodes = [];
  document.querySelectorAll('.anime-card-container').forEach(function (el) {
    var hrefEl = el.querySelector('.anime-card-poster a.overlay');
    var href = (hrefEl && hrefEl.getAttribute('href')) || '';
    if (!href || seen[href]) return;
    seen[href] = true;
    var titleEl = el.querySelector('.anime-card-title h3 a, .anime-card-title a');
    var animeTitle = (titleEl && titleEl.textContent.trim()) || '';
    var badge = (el.querySelector('.anime-card-status, [class*="episode"]') && el.querySelector('.anime-card-status, [class*="episode"]').textContent.trim()) || '';
    episodes.push({
      title: badge ? (animeTitle + ' - ' + badge) : animeTitle,
      href: href,
      image: _bestImg(el),
      animeTitle: animeTitle,
      animeHref: href,
      isNew: true,
    });
  });
  return { episodes: episodes };
}
_waitFor(
  function(){ return !!document.querySelector('.anime-card-container, .episodes-card-container'); },
  function(ok, reason){ if (ok) _send('result', { data: scrape() }); else _send('error', { message: reason }); },
  25000
);
})();true;`;

// ──────────────────────────────────────────────────────────────
// GENRE / ALL-ANIME — paginated anime card grid
// ──────────────────────────────────────────────────────────────
export const EXTRACT_LISTING = `(function(){${HELPERS}
function scrape() {
  var seen = {};
  var items = [];
  document.querySelectorAll('.anime-card-container').forEach(function (el) {
    var hrefEl = el.querySelector('.anime-card-poster a.overlay');
    var href = (hrefEl && hrefEl.getAttribute('href')) || '';
    if (!href || seen[href] || href.indexOf('/anime/') < 0) return;
    seen[href] = true;
    var titleEl = el.querySelector('.anime-card-title h3 a, .anime-card-title a');
    var typeEl = el.querySelector('.anime-card-type a');
    var statusEl = el.querySelector('.anime-card-status a');
    items.push({
      title: (titleEl && titleEl.textContent.trim()) || '',
      href: href,
      image: _bestImg(el),
      type: (typeEl && typeEl.textContent.trim()) || null,
      status: (statusEl && statusEl.textContent.trim()) || null,
      synopsis: null,
    });
  });
  return { items: items };
}
_waitFor(
  function(){ return !!document.querySelector('.anime-card-container'); },
  function(ok, reason){ if (ok) _send('result', { data: scrape() }); else _send('error', { message: reason }); },
  25000
);
})();true;`;

// ──────────────────────────────────────────────────────────────
// VIDEO SERVERS — load episode page, click each server tab, collect iframes.
// The site's own JS decodes the obfuscated server data into iframes on demand.
// ──────────────────────────────────────────────────────────────
export const EXTRACT_VIDEO_SERVERS = `(function(){${HELPERS}
function provider(url) {
  url = (url || '').toLowerCase();
  if (/mp4upload/.test(url)) return 'mp4upload';
  if (/dailymotion|dai\\.ly/.test(url)) return 'dailymotion';
  if (/streamwish|hlswish|wishembed|wishfast|hgcloud|jwembed/.test(url)) return 'streamwish';
  if (/voe\\./.test(url)) return 'voe';
  if (/share4max|megamax/.test(url)) return 'share4max';
  if (/doodstream|dood\\./.test(url)) return 'doodstream';
  if (/uqload/.test(url)) return 'uqload';
  if (/ok\\.ru/.test(url)) return 'okru';
  if (/videa\\./.test(url)) return 'videa';
  if (/vk\\.com/.test(url)) return 'vk';
  if (/mega\\.nz/.test(url)) return 'mega';
  return 'generic';
}
function badIframe(src) {
  if (!src || src.indexOf('http') !== 0) return true;
  if (/google|facebook|pyppo|popads|disqus/.test(src)) return true;
  return false;
}
function collectIframes(seen, out) {
  document.querySelectorAll('iframe').forEach(function (f) {
    var src = (f.src || f.getAttribute('data-src') || '').trim();
    if (badIframe(src) || seen[src]) return;
    seen[src] = true;
    out.push({ id: String(out.length), name: 'Server ' + (out.length + 1), iframeUrl: src, provider: provider(src) });
  });
}
function extractTitles() {
  var ep = document.querySelector('.main-section h3') || document.querySelector('h1') || document.querySelector('.episode-title');
  var anime = document.querySelector('.anime-page-link a') || document.querySelector('h1');
  return {
    episodeTitle: (ep && ep.textContent.trim()) || '',
    animeTitle: (anime && anime.textContent.trim()) || '',
  };
}
async function runClicks() {
  var seen = {};
  var out = [];
  var titles = extractTitles();
  // Initial iframes
  collectIframes(seen, out);

  // Click each server tab
  var tabs = document.querySelectorAll('#episode-servers .server-link, .server-btn, [data-server], .servers-list a, ul.servers li a, .episode-servers a, .server-tabs li, .servers-tabs a');
  for (var i = 0; i < tabs.length && i < 25; i++) {
    var t = tabs[i];
    var name = (t.textContent || '').trim() || ('Server ' + (i + 1));
    try { t.click(); } catch (e) {}
    // wait
    await new Promise(function (r) { setTimeout(r, 900); });
    var before = out.length;
    collectIframes(seen, out);
    // Rename just-added entries with the tab name
    for (var j = before; j < out.length; j++) out[j].name = name;
  }

  _send('result', { data: { servers: out, episodeTitle: titles.episodeTitle, animeTitle: titles.animeTitle } });
}
_waitFor(
  function(){ return !!document.querySelector('iframe, #episode-servers, .server-btn, .anime-page-link, .main-section'); },
  function(ok, reason){
    if (ok) { setTimeout(runClicks, 1500); }
    else _send('error', { message: reason });
  },
  30000
);
})();true;`;

// ──────────────────────────────────────────────────────────────
// VIDEO URL hook — injected BEFORE the embed page loads.
// Captures the first m3u8/mp4 URL the player tries to load via
// fetch/XHR/<video> — used as a fallback when HTML extraction fails.
// ──────────────────────────────────────────────────────────────
export const HOOK_VIDEO_BEFORE = `
(function () {
  if (window.__videoHookInstalled) return true;
  window.__videoHookInstalled = true;
  window.__hookedUrls = [];

  function isVideoUrl(u) {
    if (typeof u !== 'string') return false;
    return /\\.(m3u8|mp4)(\\?|$)/i.test(u);
  }
  function isDecoy(u) {
    var lu = (u || '').toLowerCase();
    return /test-videos\\.co\\.uk|bigbuckbunny|sample[-_.]|placeholder|tos\\.mp4|googleapis\\.com\\/.*oggtheora|\\/lol\\/file\\.mp4/.test(lu);
  }
  function maybeReport(u) {
    if (!isVideoUrl(u) || isDecoy(u)) return;
    if (window.__hookedUrls.indexOf(u) !== -1) return;
    window.__hookedUrls.push(u);
  }
  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input, init) {
      try {
        var u = typeof input === 'string' ? input : (input && input.url);
        maybeReport(u);
      } catch (e) {}
      return origFetch.apply(this, arguments);
    };
  }
  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try { maybeReport(url); } catch (e) {}
    return origOpen.apply(this, arguments);
  };
  setInterval(function () {
    document.querySelectorAll('video').forEach(function (v) {
      if (v.src) maybeReport(v.src);
      v.querySelectorAll('source').forEach(function (s) { if (s.src) maybeReport(s.src); });
    });
  }, 500);
  return true;
})();
true;
`;

// ──────────────────────────────────────────────────────────────
// VIDEO URL extraction — injected AFTER the embed page loads.
// Strategy (highest reliability first):
//   1) Provider-specific (dailymotion metadata API)
//   2) Packed-JS unpacker (mp4upload, streamwish, hgcloud, …)
//   3) JWPlayer / source-tag / generic m3u8/mp4 regex on HTML
//   4) Wait for fetch/XHR hook from HOOK_VIDEO_BEFORE (auto-clicks play)
//
// The URLs from packed JS have all tokens baked in → playable in native
// player without cookies (just Referer/Origin headers which the player
// already sets).
// ──────────────────────────────────────────────────────────────
export const COLLECT_VIDEO_AFTER = `
(function () {
  function send(type, payload) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify(Object.assign({type:type}, payload))); } catch (e) {}
  }
  function isDecoy(u) {
    var lu = (u || '').toLowerCase();
    if (!lu || lu.indexOf('http') !== 0) return true;
    return /test-videos\\.co\\.uk|bigbuckbunny|sample[-_.]|placeholder|tos\\.mp4|googleapis\\.com\\/.*oggtheora|\\/lol\\/file\\.mp4/.test(lu);
  }
  function isEmbedPage(u) {
    var lu = (u || '').toLowerCase();
    return /\\/embed|mp4upload\\.com\\/e|hgcloud\\.to\\/e\\/|yonaplay\\.net\\/embed/.test(lu);
  }
  function isTracker(u) {
    var lu = (u || '').toLowerCase();
    return /google|facebook|cloudflare|analytics|tracker/.test(lu);
  }

  // ── packed-JS unpacker ──
  function unpack(p, a, c, k) {
    var chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    function baseN(n, r) {
      var s = '';
      while (n > 0) { s = chars[n % r] + s; n = Math.floor(n / r); }
      return s || '0';
    }
    while (c--) {
      if (k[c]) p = p.replace(new RegExp('\\\\b' + baseN(c, a) + '\\\\b', 'g'), k[c]);
    }
    return p;
  }
  function extractPackedJS(html) {
    var re = /eval\\s*\\(\\s*function\\s*\\(\\s*p\\s*,\\s*a\\s*,\\s*c\\s*,\\s*k\\s*,\\s*e\\s*,\\s*d\\s*\\)\\s*\\{[^}]+?\\}\\s*\\(\\s*'((?:[^'\\\\]|\\\\.)*)'\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*'(.*?)'\\s*\\.\\s*split\\s*\\(\\s*'\\|'\\s*\\)/;
    var m = html.match(re);
    if (!m) return null;
    try {
      var unpacked = unpack(m[1].replace(/\\\\(.)/g, '$1'), +m[2], +m[3], m[4].split('|'));
      return extractJWPlayer(unpacked) || extractGeneric(unpacked);
    } catch (e) { return null; }
  }
  function extractJWPlayer(html) {
    var res = [
      /file\\s*:\\s*["']([^"']+\\.m3u8[^"']*)["']/i,
      /file\\s*:\\s*["']([^"']+\\.mp4[^"']*)["']/i,
      /sources\\s*:\\s*\\[\\s*\\{\\s*(?:type\\s*:\\s*["'][^"']*["']\\s*,\\s*)?file\\s*:\\s*["']([^"']+)["']/i,
      /src\\s*:\\s*["']([^"']+\\.m3u8[^"']*)["']/i,
      /src\\s*:\\s*["']([^"']+\\.mp4[^"']*)["']/i,
      /player\\.src\\(\\{[^}]*?src\\s*:\\s*["']([^"']+)["']/i,
      /source\\s*:\\s*["']([^"']+\\.m3u8[^"']*)["']/i,
      /source\\s*:\\s*["']([^"']+\\.mp4[^"']*)["']/i,
    ];
    for (var i = 0; i < res.length; i++) {
      var m = html.match(res[i]);
      if (m && !isEmbedPage(m[1])) return m[1];
    }
    return null;
  }
  function extractSourceTag(html) {
    var m = html.match(/<source[^>]*?src\\s*=\\s*["']([^"']+\\.(?:mp4|m3u8|webm)[^"']*)["']/i)
         || html.match(/<video[^>]*?src\\s*=\\s*["']([^"']+\\.(?:mp4|m3u8|webm)[^"']*)["']/i);
    return m ? m[1] : null;
  }
  function extractGeneric(text) {
    var patterns = [/https?:\\/\\/[^"'\\s<>]+\\.m3u8[^"'\\s<>]*/gi, /https?:\\/\\/[^"'\\s<>]+\\.mp4[^"'\\s<>]*/gi];
    for (var i = 0; i < patterns.length; i++) {
      var ms = text.match(patterns[i]);
      if (ms) {
        for (var j = 0; j < ms.length; j++) {
          if (!isEmbedPage(ms[j]) && !isTracker(ms[j]) && !isDecoy(ms[j])) return ms[j];
        }
      }
    }
    return null;
  }
  function pickHooked() {
    if (!window.__hookedUrls || !window.__hookedUrls.length) return null;
    var us = window.__hookedUrls.filter(function (u) { return !isDecoy(u); });
    if (!us.length) return null;
    var master = us.find(function (u) { return /master\\.m3u8|playlist\\.m3u8|index\\.m3u8/i.test(u); });
    var m3u8 = us.find(function (u) { return /\\.m3u8/i.test(u); });
    var mp4 = us.find(function (u) { return /\\.mp4/i.test(u); });
    return master || m3u8 || mp4 || us[0];
  }

  // ── Provider routing ──
  function extractFromHtml(html) {
    return extractPackedJS(html) || extractJWPlayer(html) || extractSourceTag(html) || extractGeneric(html);
  }
  async function tryDailymotion() {
    try {
      var m = location.href.match(/(?:dailymotion\\.com\\/(?:embed\\/)?video\\/|dai\\.ly\\/)([a-zA-Z0-9]+)/);
      if (!m) return null;
      var resp = await fetch('https://www.dailymotion.com/player/metadata/video/' + m[1], { credentials: 'omit' });
      var data = await resp.json();
      if (!data || !data.qualities) return null;
      var order = ['1080','720','480','380','240'];
      for (var i = 0; i < order.length; i++) {
        var arr = data.qualities[order[i]];
        if (arr && arr.length) {
          var mp4 = arr.find(function (v) { return v.type === 'video/mp4'; });
          if (mp4 && mp4.url) return mp4.url;
        }
      }
      if (data.qualities.auto && data.qualities.auto.length) {
        var hls = data.qualities.auto.find(function (q) { return q.type === 'application/x-mpegURL'; });
        if (hls && hls.url) return hls.url;
        if (data.qualities.auto[0].url) return data.qualities.auto[0].url;
      }
      var s = JSON.stringify(data);
      var m2 = s.match(/https?:\\/\\/[^"'\\\\]+\\.m3u8[^"'\\\\]*/);
      return m2 ? m2[0] : null;
    } catch (e) { return null; }
  }
  function triggerPlay() {
    try {
      var sels = ['.jw-icon-display', '.vjs-big-play-button', '.plyr__control--overlaid', '[class*="play"][class*="btn"]', 'button[aria-label*="lay" i]', '.play', 'button'];
      for (var i = 0; i < sels.length; i++) {
        var el = document.querySelector(sels[i]);
        if (el) { try { el.click(); return; } catch (e) {} }
      }
    } catch (e) {}
    try {
      document.querySelectorAll('video').forEach(function (v) {
        try { v.muted = true; v.play().catch(function(){}); } catch (e) {}
      });
    } catch (e) {}
  }

  // ── Main loop ──
  var sent = false;
  function done(url) {
    if (sent) return;
    sent = true;
    send('result', { data: { url: url } });
  }
  function fail(reason) {
    if (sent) return;
    sent = true;
    send('error', { message: reason });
  }

  (async function run() {
    var start = Date.now();

    // 1) Dailymotion metadata API (fast path)
    var dm = await tryDailymotion();
    if (dm) return done(dm);

    // 2) Try HTML extractors immediately, then every 1s for 6s
    for (var i = 0; i < 7; i++) {
      var html = document.documentElement.outerHTML || '';
      var found = extractFromHtml(html);
      if (found && !isDecoy(found)) return done(found);
      // Also check hook captures
      var hooked = pickHooked();
      if (hooked) return done(hooked);
      if (i === 1) triggerPlay();
      await new Promise(function (r) { setTimeout(r, 1000); });
    }

    // 3) Click play and keep watching for hooked URLs up to 30s total
    triggerPlay();
    var elapsed = Date.now() - start;
    while (elapsed < 30000) {
      var h = pickHooked();
      if (h) return done(h);
      await new Promise(function (r) { setTimeout(r, 700); });
      elapsed = Date.now() - start;
    }

    fail('no-video-url-after-30s');
  })();
  return true;
})();
true;
`;

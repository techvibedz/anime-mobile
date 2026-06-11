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
  intervalMs = intervalMs || 250;
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
  15000
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
    if (!ok) { _send('error', { message: reason }); return; }
    // If the episode payload is already present, scrape and return at once —
    // no need to burn 2.5s waiting. Only wait when we matched on the detail
    // DOM and the site's JS may not have populated the data yet.
    if (findProcessedData()) {
      _send('result', { data: scrape() });
    } else {
      // Short grace for the site's JS to populate the episode payload; poll
      // every 200ms so we return the moment it lands instead of a fixed wait.
      var waited = 0;
      var iv = setInterval(function(){
        waited += 200;
        if (findProcessedData() || waited >= 1600) {
          clearInterval(iv);
          _send('result', { data: scrape() });
        }
      }, 200);
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
    if (ok) setTimeout(function(){ _send('result', { data: scrape() }); }, 600);
    else _send('error', { message: reason });
  },
  25000
);
})();true;`;

// ──────────────────────────────────────────────────────────────
// CROSS-SOURCE TITLE MATCH — used to find an anime's anime4up URL by
// searching anime4up by witanime title (and vice versa). Returns the
// best-scoring card URL.
// ──────────────────────────────────────────────────────────────
export const EXTRACT_TITLE_MATCH = (want: string) => `(function(){${HELPERS}
// Convert spelled-out / arabic-digit season words to a number so we can
// compare seasons across the two sites (which name them differently).
function seasonNum(s) {
  var t = String(s || '').toLowerCase();
  // arabic-indic digits → latin
  t = t.replace(/[\\u0660-\\u0669]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); });
  var m = t.match(/(?:season|s|part|cour|الجزء|الموسم)\\s*([0-9]+)/);
  if (m) return parseInt(m[1], 10);
  var words = { 'first': 1, 'second': 2, 'third': 3, 'fourth': 4, 'fifth': 5,
                'الاول': 1, 'الأول': 1, 'الثاني': 2, 'الثالث': 3, 'الرابع': 4, 'الخامس': 5 };
  for (var k in words) { if (t.indexOf(k) !== -1) return words[k]; }
  return 0; // 0 = unspecified (treated as season 1-ish, never penalised hard)
}
// Latin-only normalisation: lowercase, drop Arabic, strip season/format
// noise, keep alphanumerics.
function normLatin(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\\u0600-\\u06FF]+/g, ' ')
    .replace(/\\b(the\\s+movie|movie|ova|ona|special|tv|season|part|cour|final)\\b/g, ' ')
    .replace(/\\bs\\s*\\d+\\b/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\\s+/g, ' ')
    .trim();
}
// Arabic-only normalisation: strip tashkeel, keep arabic letters.
function normArabic(s) {
  return String(s || '')
    .replace(/[\\u064B-\\u0652]/g, '')
    .replace(/[^\\u0600-\\u06FF ]+/g, ' ')
    .replace(/\\s+/g, ' ')
    .trim();
}
function toks(s) { return s.split(' ').filter(function (w) { return w.length > 1; }); }
// Token overlap as a ratio of the smaller set (0..1) — lets short and
// partial titles match without needing many shared words.
function overlap(a, b) {
  if (!a.length || !b.length) return 0;
  var set = {}; a.forEach(function (w) { set[w] = true; });
  var shared = 0;
  b.forEach(function (w) { if (set[w]) { shared++; set[w] = false; } });
  return shared / Math.min(a.length, b.length);
}
function scrape() {
  var rawWant = ${JSON.stringify(want)};
  var wantL = normLatin(rawWant), wantA = normArabic(rawWant);
  var wantLT = toks(wantL), wantAT = toks(wantA);
  var wantSeason = seasonNum(rawWant);
  var best = { url: null, score: 0 };
  document.querySelectorAll('.anime-card-container').forEach(function (el) {
    var titleEl = el.querySelector('.anime-card-title h3 a');
    var hrefEl = el.querySelector('.anime-card-poster a.overlay');
    var rawT = titleEl && titleEl.textContent;
    var h = hrefEl && hrefEl.getAttribute('href');
    if (!h || !rawT) return;
    var gotL = normLatin(rawT), gotA = normArabic(rawT);
    var score = 0;
    if (wantL && gotL && gotL === wantL) score = 100;
    else if (wantL && gotL && (gotL.indexOf(wantL) === 0 || wantL.indexOf(gotL) === 0)) score = 85;
    else if (wantA && gotA && gotA === wantA) score = 95;
    else {
      var r = Math.max(overlap(wantLT, toks(gotL)), overlap(wantAT, toks(gotA)));
      score = Math.round(r * 75); // up to 75 for a perfect token overlap
    }
    // Season tiebreaker: when several seasons of the same show appear in the
    // results, nudge toward the one matching the requested season so the
    // episode-number lookup later hits the right list.
    var gotSeason = seasonNum(rawT);
    if (score > 0 && wantSeason && gotSeason) {
      if (wantSeason === gotSeason) score += 8;
      else score -= 12;
    }
    if (score > best.score) { best = { url: h, score: score }; }
  });
  // Permissive threshold: a ~0.5 token-overlap ratio (≈37) is enough.
  return { url: best.score >= 34 ? best.url : null, score: best.score };
}
_waitFor(
  function(){ return !!document.querySelector('.anime-card-container, .no-results, .search-empty'); },
  function(ok){ _send('result', { data: ok ? scrape() : { url: null, score: 0 } }); },
  18000
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
function toAnimeUrl(href) {
  if (!href) return null;
  if (href.indexOf('/anime/') >= 0) return href;
  if (href.indexOf('/episode/') < 0) return null;
  try {
    var d = decodeURIComponent(href);
    var stripped = d.replace(/-?الحلقة[-\\s]*\\d+[^/]*/, '');
    var converted = stripped.replace('/episode/', '/anime/');
    if (converted !== d && converted.indexOf('/anime/') >= 0) {
      var u = new URL(converted);
      return u.origin + u.pathname.split('/').map(function (seg, i) {
        return i === 0 ? seg : encodeURIComponent(decodeURIComponent(seg));
      }).join('/');
    }
  } catch (e) {}
  return null;
}
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
    // Prefer an explicit anime-page link in the card; fall back to the
    // slug-derived URL so this still works on episode-only listings.
    var animePageEl = el.querySelector('.anime-card-title a[href*="/anime/"], .ep-card-anime-title a[href*="/anime/"], a[href*="/anime/"]');
    var animeHref = (animePageEl && animePageEl.getAttribute('href')) || toAnimeUrl(href) || href;
    episodes.push({
      title: badge ? (animeTitle + ' - ' + badge) : animeTitle,
      href: href,
      image: _bestImg(el),
      animeTitle: animeTitle,
      animeHref: animeHref,
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
  if (/streamwish|hlswish|wishembed|wishfast|hgcloud|jwembed|vibuxer|audinifer|masukestin|hanerix/.test(url)) return 'streamwish';
  if (/voe\\./.test(url)) return 'voe';
  if (/share4max|megamax/.test(url)) return 'share4max';
  if (/rubyvidhub|streamruby|rubystm|ruby/.test(url)) return 'streamruby';
  if (/doodstream|dood\\.|dsvplay|d-s\\.io|vidply/.test(url)) return 'doodstream';
  if (/uqload/.test(url)) return 'uqload';
  if (/ok\\.ru/.test(url)) return 'okru';
  if (/videa\\.|vidvaita|vidit/.test(url)) return 'videa';
  if (/vk\\.com/.test(url)) return 'vk';
  if (/mega\\.nz/.test(url)) return 'mega';
  return 'generic';
}
function badIframe(src) {
  if (!src || src.indexOf('http') !== 0) return true;
  if (/google|facebook|pyppo|popads|disqus/.test(src)) return true;
  // Reject malformed hosts. witanime's loadIframe() decode occasionally
  // produces 'https://undefined/<encoded>' which dies with ERR_NAME_NOT_RESOLVED.
  try {
    var h = new URL(src).hostname.toLowerCase();
    if (!h || h === 'undefined' || h === 'null' || h.indexOf('.') < 0) return true;
  } catch (e) { return true; }
  return false;
}
function collectIframes(seen, out) {
  // anime4up servers: the embed URL lives in a data-watch attribute on each
  // tab <li>; the live iframe is only injected by JS on click and the markup
  // also hides copies inside inert <noscript> tags. Read the attribute
  // directly so we capture every server without depending on click handlers.
  document.querySelectorAll('#episode-servers li[data-watch], #watch-servers li[data-watch], li[data-watch]').forEach(function (li) {
    var src = (li.getAttribute('data-watch') || '').trim();
    if (badIframe(src) || seen[src]) return;
    seen[src] = true;
    // The label sits in the <a> alongside a <noscript><iframe></noscript>
    // copy of the embed; reading textContent directly drags the whole iframe
    // URL into the name, so strip those inert nodes off a clone first.
    var a = li.querySelector('a');
    var name = '';
    if (a) {
      var labelEl = a.cloneNode(true);
      labelEl.querySelectorAll('noscript, iframe, script').forEach(function (n) {
        if (n.parentNode) n.parentNode.removeChild(n);
      });
      name = (labelEl.textContent || '').replace(/\\s+/g, ' ').trim();
    }
    if (!name) name = 'Server ' + (out.length + 1);
    out.push({ id: String(out.length), name: name, iframeUrl: src, provider: provider(src) });
  });
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

  // Continuously collect as the DOM mutates. Server iframes are injected
  // asynchronously after a tab is clicked (sometimes hundreds of ms later),
  // so a fixed wait can miss them intermittently. A MutationObserver catches
  // every iframe / data-watch tab the moment it appears, regardless of timing.
  var observer = null;
  try {
    observer = new MutationObserver(function () { collectIframes(seen, out); });
    observer.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['data-watch', 'src'],
    });
  } catch (e) {}

  // 1st pass: harvest data-watch attributes + any iframes already rendered.
  // Both anime4up and witanime keep embed URLs in li[data-watch].
  collectIframes(seen, out);
  await new Promise(function (r) { setTimeout(r, 100); });
  collectIframes(seen, out);

  // 2nd pass: click through every server tab so witanime's lazy-injected
  // iframes get created. The observer above collects whatever each click
  // produces, even if it renders after the per-click wait.
  var tabs = document.querySelectorAll('#episode-servers .server-link, .server-btn, [data-server], .servers-list a, ul.servers li a, .episode-servers a, .server-tabs li, .servers-tabs a');
  for (var i = 0; i < tabs.length && i < 20; i++) {
    var t = tabs[i];
    var name = (t.textContent || '').trim() || ('Server ' + (i + 1));
    var before = out.length;
    try { t.click(); } catch (e) {}
    await new Promise(function (r) { setTimeout(r, 120); });
    collectIframes(seen, out);
    // Rename just-added entries with the tab name
    for (var j = before; j < out.length; j++) out[j].name = name;
  }

  // Final settle: catch any iframe that injected after its tab's window.
  await new Promise(function (r) { setTimeout(r, 350); });
  collectIframes(seen, out);
  if (observer) { try { observer.disconnect(); } catch (e) {} }

  // Harvest a direct anime4up link if witanime embeds one on this page — an
  // exact episode URL lets us pull the anime4up servers with zero title/
  // episode-number guessing. Prefer an episode link over an anime-page link.
  var up4EpisodeUrl = null, up4AnimeUrl = null;
  document.querySelectorAll('a[href*="anime4up"]').forEach(function (a) {
    var h = (a.getAttribute('href') || '').trim();
    if (!h) return;
    if (h.indexOf('http') !== 0) h = (h.indexOf('//') === 0 ? 'https:' : 'https://') + h.replace(/^\\/+/, '');
    var dh = h;
    try { dh = decodeURIComponent(h); } catch (e) {}
    if (/\\/episode\\/|الحلقة/.test(dh)) { if (!up4EpisodeUrl) up4EpisodeUrl = h; }
    else if (/anime4up/.test(h) && !up4AnimeUrl) { up4AnimeUrl = h; }
  });

  _send('result', { data: { servers: out, episodeTitle: titles.episodeTitle, animeTitle: titles.animeTitle, up4EpisodeUrl: up4EpisodeUrl, up4AnimeUrl: up4AnimeUrl } });
}
_waitFor(
  function(){ return !!document.querySelector('iframe, #episode-servers, .server-btn, .anime-page-link, .main-section'); },
  function(ok, reason){
    if (ok) { setTimeout(runClicks, 200); }
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

  // ── Provider-specific extractors ──
  // voe: sources object with base64-encoded 'hls'/'mp4' URLs (page may have
  // redirected from voe.sx to a random mirror domain first).
  function tryVoe(html) {
    var keys = ['hls', 'mp4', 'video_src'];
    for (var i = 0; i < keys.length; i++) {
      var m = html.match(new RegExp("['\\"]" + keys[i] + "['\\"]\\\\s*:\\\\s*['\\"]([^'\\"]+)['\\"]"));
      if (!m) continue;
      var u = m[1];
      if (u.indexOf('http') !== 0) { try { u = atob(u); } catch (e) { continue; } }
      if (u.indexOf('http') === 0 && !isDecoy(u)) return u;
    }
    return null;
  }
  // ok.ru: player options live in a data-options JSON attribute.
  function tryOkru() {
    var el = document.querySelector('[data-options]');
    if (!el) return null;
    try {
      var opts = JSON.parse(el.getAttribute('data-options'));
      var fv = opts && opts.flashvars;
      var meta = fv && fv.metadata ? JSON.parse(fv.metadata) : null;
      if (meta) {
        if (meta.hlsManifestUrl) return meta.hlsManifestUrl;
        if (meta.videos && meta.videos.length) return meta.videos[meta.videos.length - 1].url;
      }
    } catch (e) {}
    return null;
  }
  // doodstream family: GET the /pass_md5/ endpoint, then append a random
  // tail + the page token. The result is a direct progressive stream.
  async function tryDood() {
    try {
      var html = document.documentElement.outerHTML || '';
      var m = html.match(/['"]([^'"]*\\/pass_md5\\/[^'"]+)['"]/);
      if (!m) return null;
      var passUrl = m[1].indexOf('http') === 0 ? m[1] : location.origin + m[1];
      var tk = html.match(/token=([a-zA-Z0-9]+)/);
      var resp = await fetch(passUrl, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      var base = (await resp.text()).trim();
      if (!base || base.indexOf('http') !== 0) return null;
      var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      var rand = '';
      for (var i = 0; i < 10; i++) rand += chars.charAt(Math.floor(Math.random() * chars.length));
      return base + rand + '?token=' + (tk ? tk[1] : '') + '&expiry=' + Date.now();
    } catch (e) { return null; }
  }

  // ── Provider routing ──
  function extractFromHtml(html) {
    return tryVoe(html) || extractPackedJS(html) || extractJWPlayer(html) || extractSourceTag(html) || extractGeneric(html);
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
  // For providers whose CDN ties URLs to per-session tokens (mp4upload,
  // streamwish, voe, …), the LIVE URL the player actually fetches is
  // far more reliable than the packed-JS one — by the time the native
  // player makes its request, the packed URL may have expired tokens or
  // missing cookies. So we wait for the fetch/XHR hook to fire before
  // falling back to HTML extractors.
  var isTokenizedHost = /mp4upload|streamwish|hgcloud|wishfast|wishembed|jwembed|voe\\.sx|voe\\./i.test(location.host);
  var isDoodHost = /dood|ds2play|ds2video|d0o0d|do0od|d000d|vidply|all3do|doply|dsvplay|d-s\\.io/i.test(location.host);
  var isOkruHost = /ok\\.ru|odnoklassniki/i.test(location.host);

  (async function run() {
    var start = Date.now();

    // 1) Provider metadata fast paths
    var dm = await tryDailymotion();
    if (dm) return done(dm);
    if (isOkruHost) {
      var ok = tryOkru();
      if (ok) return done(ok);
    }
    if (isDoodHost) {
      var dd = await tryDood();
      if (dd) return done(dd);
    }

    // 2) Kick the player so it issues its real media fetches.
    triggerPlay();
    await new Promise(function (r) { setTimeout(r, 350); });
    triggerPlay();

    // 3) Unified fast poll. The hook (the URL the player actually fetches)
    //    is the most reliable for tokenized CDNs, but waiting only on it is
    //    slow — so we run the HTML extractors on every tick too and use
    //    whichever lands first. Non-tokenized hosts commit to the HTML URL
    //    instantly; tokenized hosts give the live hook a short (~3.5s) head
    //    start before falling back to the HTML-extracted URL.
    var htmlUrl = null;
    var lastTrigger = Date.now();
    var doodRetried = false;
    while (Date.now() - start < 28000) {
      var h = pickHooked();
      if (h) return done(h);

      if (isOkruHost) {
        var ok2 = tryOkru();
        if (ok2) return done(ok2);
      }
      if (isDoodHost && !doodRetried && Date.now() - start > 3000) {
        doodRetried = true;
        var dd2 = await tryDood();
        if (dd2) return done(dd2);
      }

      if (!htmlUrl) {
        var found = extractFromHtml(document.documentElement.outerHTML || '');
        if (found && !isDecoy(found)) {
          if (!isTokenizedHost) return done(found);
          htmlUrl = found;
        }
      }
      if (htmlUrl && Date.now() - start > 3500) return done(htmlUrl);

      if (Date.now() - lastTrigger > 1600) { triggerPlay(); lastTrigger = Date.now(); }
      await new Promise(function (r) { setTimeout(r, 250); });
    }

    if (htmlUrl) return done(htmlUrl);
    var hLast = pickHooked();
    if (hLast) return done(hLast);
    fail('no-video-url');
  })();
  return true;
})();
true;
`;

// Strings of JavaScript injected into the WebView. Keep these self-contained
// — they cannot reference imports or RN code. They communicate via
// window.ReactNativeWebView.postMessage(JSON.stringify({type, ...}))

// ──────────────────────────────────────────────────────────────
// Home page extractor (witanime).
// Waits up to 25s for Cloudflare to clear + DOM to populate, then scrapes
// featured slider + anime cards + recent episodes.
// ──────────────────────────────────────────────────────────────
export const EXTRACT_HOME_WIT = `
(function () {
  function send(type, payload) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify(Object.assign({type:type}, payload))); } catch (e) {}
  }

  function upgradeImg(u) {
    if (!u) return null;
    return u.replace(/-\\d+x\\d+(\\.[a-z]+)$/i, '$1');
  }

  function bestImg(el) {
    var img = el.querySelector('img');
    if (!img) return null;
    var src = img.getAttribute('data-image') || img.getAttribute('data-src')
           || (img.getAttribute('srcset') || '').split(' ')[0]
           || img.getAttribute('src') || '';
    return upgradeImg(src);
  }

  function scrape() {
    var featured = [];
    var slides = document.querySelectorAll('.lucodeia-slider-slide-item');
    slides.forEach(function (el) {
      var href = el.getAttribute('href') || (el.querySelector('a') && el.querySelector('a').getAttribute('href')) || '';
      if (!href) return;
      if (href.indexOf('http') !== 0) href = 'https://witanime.you' + href;
      var bgMatch = (el.getAttribute('style') || '').match(/url\\(['"]?([^'"()]+)['"]?\\)/);
      var genres = [];
      el.querySelectorAll('.slider-genres a').forEach(function (g) { genres.push(g.textContent.trim()); });
      featured.push({
        title: el.getAttribute('title') || (el.querySelector('.slider-title') && el.querySelector('.slider-title').textContent.trim()) || '',
        href: href,
        image: bgMatch ? upgradeImg(bgMatch[1]) : null,
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
        image: bestImg(el),
        type: (typeEl && typeEl.textContent.trim()) || null,
        status: (statusEl && statusEl.textContent.trim()) || null,
        description: (titleLink && titleLink.getAttribute('data-content')) || null,
        isNew: ((statusEl && statusEl.textContent.trim()) || '').indexOf('مستمر') >= 0,
        rating: (ratingEl && ratingEl.textContent.trim()) || null,
        sources: ['witanime'],
        sourceHrefs: { witanime: href },
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
        image: bestImg(el),
        animeTitle: (animeEl && animeEl.textContent.trim()) || '',
        animeHref: (animeEl && animeEl.getAttribute('href')) || '',
        isNew: true,
      });
    });

    return { featured: featured.slice(0, 5), animes: animes, episodes: episodes };
  }

  // Poll until CF clears (no challenge selectors) AND content appears (or 25s elapse).
  var start = Date.now();
  var iv = setInterval(function () {
    var cfActive = !!document.querySelector('#challenge-running, .cf-browser-verification, #challenge-stage, #cf-challenge-running');
    var hasContent = !!document.querySelector('.anime-card-container, .lucodeia-slider-slide-item, .episodes-card-container');
    var elapsed = Date.now() - start;
    if (!cfActive && hasContent) {
      clearInterval(iv);
      send('result', { data: scrape() });
    } else if (elapsed > 25000) {
      clearInterval(iv);
      send('error', { message: cfActive ? 'cf-still-active-after-25s' : 'no-content-after-25s' });
    }
  }, 1000);

  return true;
})();
true;
`;

// ──────────────────────────────────────────────────────────────
// Video URL hook — injected BEFORE the embed page loads.
// Patches window.fetch + XMLHttpRequest.open to capture the first m3u8/mp4 URL
// the player tries to load.
// ──────────────────────────────────────────────────────────────
export const HOOK_VIDEO_BEFORE = `
(function () {
  if (window.__videoHookInstalled) return true;
  window.__videoHookInstalled = true;
  var seenUrls = [];

  function send(type, payload) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify(Object.assign({type:type}, payload))); } catch (e) {}
  }

  function isVideoUrl(u) {
    if (typeof u !== 'string') return false;
    return /\\.(m3u8|mp4)(\\?|$)/i.test(u);
  }

  function maybeReport(u) {
    if (!isVideoUrl(u)) return;
    if (seenUrls.indexOf(u) !== -1) return;
    seenUrls.push(u);
    // First match resolves the scrape; later matches are silent.
    if (seenUrls.length === 1) {
      send('result', { data: { url: u } });
    }
  }

  // Patch fetch
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

  // Patch XMLHttpRequest.open
  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try { maybeReport(url); } catch (e) {}
    return origOpen.apply(this, arguments);
  };

  // Also watch <video src> in case the player sets it directly.
  setInterval(function () {
    var videos = document.querySelectorAll('video');
    videos.forEach(function (v) {
      if (v.src) maybeReport(v.src);
      var srcEls = v.querySelectorAll('source');
      srcEls.forEach(function (s) { if (s.src) maybeReport(s.src); });
    });
  }, 500);

  return true;
})();
true;
`;

// AFTER hook for video pages — waits up to 30s for the first video URL,
// then reports it as 'result'. Partials are still being sent by the BEFORE hook.
export const COLLECT_VIDEO_AFTER = `
(function () {
  var start = Date.now();
  var iv = setInterval(function () {
    // Try to autoplay if there's a play button blocking the player.
    var playBtns = document.querySelectorAll('button, .play, .vjs-big-play-button, [class*="play"]');
    if (playBtns.length && Date.now() - start < 5000) {
      try { playBtns[0].click(); } catch (e) {}
    }
    // Trigger video elements to start.
    document.querySelectorAll('video').forEach(function (v) {
      try { v.play().catch(function(){}); } catch (e) {}
    });
    if (Date.now() - start > 30000) {
      clearInterval(iv);
      try { window.ReactNativeWebView.postMessage(JSON.stringify({type:'error', message:'no-video-url-after-30s'})); } catch (e) {}
    }
  }, 1000);
  return true;
})();
true;
`;

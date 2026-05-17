const puppeteer = require('puppeteer-core');
const cheerio = require('cheerio');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222', defaultViewport: null });
  const page = await browser.newPage();

  console.log('Fetching homepage...');
  await page.goto('https://w1.anime4up.rest/home8/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  const html = await page.content();
  const $ = cheerio.load(html);

  // Featured
  const featured = [];
  $('.lucodeia-slider-slide-item').each((_, el) => {
    const $el = $(el);
    const bgStyle = $el.attr('style') || '';
    const imgMatch = bgStyle.match(/url\(['"]?([^'"()]+)['"]?\)/);
    featured.push({
      title: $el.attr('title') || '',
      href: $el.attr('href') || '',
      image: imgMatch ? imgMatch[1] : null,
    });
  });
  console.log('Featured:', featured.length);

  // Anime cards
  const animeItems = [];
  $('.anime-card-container').each((_, el) => {
    const $el = $(el);
    animeItems.push({
      title: $el.find('.anime-card-title h3 a').text().trim(),
      href: $el.find('.anime-card-poster a.overlay').attr('href') || '',
      image: $el.find('.anime-card-poster img').attr('src') || '',
    });
  });
  console.log('Anime items:', animeItems.length);
  animeItems.slice(0, 5).forEach(a => console.log('  -', a.title, '|', a.href));

  // Test an anime page
  if (animeItems.length > 0) {
    const first = animeItems[0];
    console.log('\nFetching anime page:', first.href);
    await page.goto(first.href, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const animeHtml = await page.content();
    const $$ = cheerio.load(animeHtml);

    const title = $$('.anime-details-title').text().trim();
    console.log('Anime title:', title);

    // Episodes
    const raw = extractEpisodeData(animeHtml);
    const eps = decodeEpisodeData(raw);
    console.log('Episodes:', eps.length);
    eps.slice(0, 3).forEach(e => console.log('  -', e.type, e.number, e.url));

    // Click first episode to get servers
    if (eps.length > 0) {
      const epUrl = eps[0].url;
      const fullEpUrl = epUrl.startsWith('http') ? epUrl : 'https://w1.anime4up.rest/' + epUrl.replace(/^\//, '');
      console.log('\nFetching episode:', fullEpUrl);
      await page.goto(fullEpUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      const epHtml = await page.content();
      const zG = extractVar(epHtml, '_zG');
      const zH = extractVar(epHtml, '_zH');
      console.log('Has _zG:', !!zG, 'Has _zH:', !!zH);
      if (zG && zH) {
        const rr = JSON.parse(Buffer.from(zG, 'base64').toString('utf8'));
        const cr = JSON.parse(Buffer.from(zH, 'base64').toString('utf8'));
        console.log('Video servers:', rr.length);
        for (let i = 0; i < Math.min(rr.length, 5); i++) {
          let r = rr[i].split('').reverse().join('');
          r = r.replace(/[^A-Za-z0-9+/=]/g, '');
          const off = cr[i].d[parseInt(Buffer.from(cr[i].k, 'base64').toString('utf8'), 10)];
          const d = Buffer.from(r, 'base64').toString('utf8').slice(0, -off || undefined);
          const n = Buffer.from(cr[i].v, 'base64').toString('utf8');
          console.log('  [' + n + ']', d);
        }
      }
    }
  }

  await browser.disconnect();

  function extractVar(html, name) {
    const m = html.match(new RegExp(name + '\\s*=\\s*"([^"]*)"', 's'))
           || html.match(new RegExp(name + "\\s*=\\s*'([^']*)'", 's'));
    return m ? m[1] : null;
  }
  function extractEpisodeData(html) {
    const m = html.match(/var\s+processedEpisodeData\s*=\s*['"]([^'"]+)['"]/);
    return m ? m[1] : null;
  }
  function decodeEpisodeData(raw) {
    if (!raw) return [];
    try {
      const parts = raw.split('.');
      if (parts.length !== 2) return [];
      const enc = Buffer.from(parts[0], 'base64');
      const key = Buffer.from(parts[1], 'base64');
      const dec = Buffer.alloc(enc.length);
      for (let i = 0; i < enc.length; i++) dec[i] = enc[i] ^ key[i % key.length];
      return JSON.parse(dec.toString('utf8'));
    } catch { return []; }
  }
})();

const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222' });
  const page = await browser.newPage();

  // Go to episode 6
  console.log('Loading episode...');
  await page.goto('https://w1.anime4up.rest/episode/%d8%a7%d9%86%d9%85%d9%8a-rezero-kara-hajimeru-isekai-seikatsu-4th-season-%d8%a7%d9%84%d8%ad%d9%84%d9%82%d8%a9-6/', {
    waitUntil: 'domcontentloaded', timeout: 20000,
  });
  await new Promise(r => setTimeout(r, 5000));
  const html = await page.content();

  // Check video server variables
  const hasZG = html.includes('_zG');
  const hasZH = html.includes('_zH');
  console.log('Has _zG:', hasZG, 'Has _zH:', hasZH);

  // Extract video servers if available
  if (hasZG && hasZH) {
    const zGMatch = html.match(/_zG\s*=\s*"([^"]+)"/);
    const zHMatch = html.match(/_zH\s*=\s*"([^"]+)"/);
    if (zGMatch && zHMatch) {
      const rr = JSON.parse(Buffer.from(zGMatch[1], 'base64').toString('utf8'));
      const cr = JSON.parse(Buffer.from(zHMatch[1], 'base64').toString('utf8'));
      console.log('Video servers:', rr.length);
      for (let i = 0; i < Math.min(rr.length, 5); i++) {
        let r = rr[i].split('').reverse().join('');
        r = r.replace(/[^A-Za-z0-9+/=]/g, '');
        const off = cr[i].d[parseInt(Buffer.from(cr[i].k, 'base64').toString('utf8'), 10)];
        const decoded = Buffer.from(r, 'base64').toString('utf8').slice(0, -off || undefined);
        const name = Buffer.from(cr[i].v, 'base64').toString('utf8');
        console.log('  [' + name + ']', decoded);
      }
    }
  } else {
    // Look for iframes directly
    const iframes = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('iframe')).map(f => f.src);
    });
    console.log('Direct iframes:', iframes.length);
    iframes.forEach(f => console.log(' ', f));
  }

  // Check episode server tab names
  const serverNames = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.server-link .ser')).map(s => s.textContent.trim());
  });
  console.log('Server names:', serverNames);

  await browser.disconnect();
})();

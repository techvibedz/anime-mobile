const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
    ],
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  });

  const page = await browser.newPage();
  const cookies = require('./cookies-3rb.json');
  await page.setCookie(...cookies);

  console.log('Opening anime3rb with cookies...');
  await page.goto('https://anime3rb.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  // Wait for challenge
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const title = await page.title();
    if (!title.includes('لحظة') && !title.includes('moment') && !title.includes('Just')) {
      console.log('PASSED! Title:', title);
      break;
    }
    console.log('  Waiting... (' + ((i+1)*2) + 's) title:', title);
  }

  const html = await page.content();
  console.log('HTML length:', html.length);

  // Extract anime items with broad selectors
  const items = await page.evaluate(() => {
    const results = [];
    // Try many common patterns
    document.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href') || '';
      if (!href.startsWith('http') || !href.includes('anime3rb')) return;
      const img = a.querySelector('img');
      const h = a.querySelector('h2, h3, h1');
      const text = (h?.textContent || a.textContent || '').trim();
      if (img && text && text.length > 2) {
        results.push({
          title: text.substring(0, 80),
          href,
          image: img.src || img.getAttribute('data-src') || '',
        });
      }
    });
    return results;
  });
  console.log('Found links:', items.length);
  items.slice(0, 10).forEach(it => console.log(' -', it.title, '|', it.href.substring(0, 70)));

  await browser.close();
})();

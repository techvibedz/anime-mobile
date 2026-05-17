const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

(async () => {
  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
      ],
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    });
    console.log('Browser launched');

    const page = await browser.newPage();
    const videoUrls = [];

    page.on('request', (req) => {
      const u = req.url();
      if (u.includes('.m3u8') || u.includes('.mp4')) {
        console.log('REQ:', u.substring(0, 120));
        videoUrls.push(u);
      }
    });
    page.on('response', (res) => {
      const u = res.url();
      const ct = res.headers()['content-type'] || '';
      if (u.includes('.m3u8') || u.includes('.mp4') || ct.includes('mpegurl')) {
        console.log('RES:', u.substring(0, 120));
        videoUrls.push(u);
      }
    });

    try {
      console.log('Loading mp4upload...');
      await page.goto('https://www.mp4upload.com/embed-ckixfthipmdl.html', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      console.log('MP4Upload loaded, waiting 6s...');
      await new Promise((r) => setTimeout(r, 6000));
    } catch { console.log('mp4upload timeout'); }

    if (videoUrls.length === 0) {
      try {
        console.log('Loading streamwish...');
        await page.goto('https://hgcloud.to/e/p4vrcgok0f5l', {
          waitUntil: 'domcontentloaded',
          timeout: 15000,
        });
        console.log('Streamwish loaded, waiting 6s...');
        await new Promise((r) => setTimeout(r, 6000));
      } catch { console.log('streamwish timeout'); }
    }

    console.log('Total video URLs:', videoUrls.length);
    videoUrls.forEach((u) => console.log(' ', u.substring(0, 150)));

    await browser.close();
  } catch (e) {
    console.log('Error:', e.message);
  }
})();

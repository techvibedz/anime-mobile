const axios = require('axios');
const https = require('https');
const dns = require('dns');
const { getCookieHeader } = require('./cookie-manager');

const BASE_URL = 'https://anime3rb.com';

// Custom DNS resolver using Google DNS (bypasses ISP blocks)
const resolver = new dns.Resolver();
resolver.setServers(['8.8.8.8', '8.8.4.4']);

const lookup = (hostname, opts, callback) => {
  resolver.resolve4(hostname, (err, addrs) => {
    if (err) return callback(err);
    if (opts.all) {
      callback(null, addrs.map((a) => ({ address: a, family: 4 })));
    } else {
      callback(null, addrs[0], 4);
    }
  });
};

const agent = new https.Agent({ lookup });

const client = axios.create({
  baseURL: BASE_URL,
  timeout: 20000,
  httpsAgent: agent,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
  },
});

async function fetchHTML(urlPath, retries = 3) {
  const cookie = getCookieHeader();
  const headers = cookie ? { Cookie: cookie } : {};

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await client.get(urlPath, {
        responseType: 'text',
        maxRedirects: 5,
        headers,
      });
      return response.data;
    } catch (err) {
      if (attempt < retries - 1) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      } else {
        throw err;
      }
    }
  }
}

module.exports = { fetchHTML, BASE_URL };

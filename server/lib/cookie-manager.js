const fs = require('fs');
const path = require('path');

const COOKIE_FILE = path.join(__dirname, '..', 'cookies-3rb.json');

function loadCookies() {
  try {
    return JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveCookies(cookies) {
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2));
}

function getCookieHeader() {
  const cookies = loadCookies();
  if (cookies.length === 0) return '';
  return cookies
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

function hasValidCookie() {
  const cookies = loadCookies();
  const cf = cookies.find((c) => c.name === 'cf_clearance');
  if (!cf) return false;
  // Check expiry with 1min buffer
  if (cf.expires && Date.now() > (cf.expires * 1000) - 60000) return false;
  return true;
}

function setCookie(rawCookieString) {
  // Parse "name=value; name2=value2" format
  const cookies = rawCookieString.split(';').map((pair) => {
    const [name, ...rest] = pair.trim().split('=');
    return {
      name: name.trim(),
      value: rest.join('=').trim(),
      domain: '.anime3rb.com',
      path: '/',
      expires: Math.floor(Date.now() / 1000) + 3600, // guess 1h
    };
  });
  saveCookies(cookies);
  return cookies;
}

module.exports = { loadCookies, saveCookies, getCookieHeader, hasValidCookie, setCookie };

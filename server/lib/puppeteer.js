// Single source of truth for the Puppeteer instance.
// Wraps puppeteer-core with puppeteer-extra + stealth plugin to evade common
// Cloudflare/bot detection fingerprint checks (navigator.webdriver, headless
// chrome user-agent, missing plugins, WebGL vendor, etc.).
//
// Does NOT fix IP-reputation blocking — datacenter IPs may still be challenged
// regardless of fingerprint.
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

module.exports = puppeteer;

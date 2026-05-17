const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9222;
const USER_DATA = path.join(process.env.TEMP || '/tmp', 'anime-chrome');
const START_URL = 'https://witanime.you/';

// Second site to pre-warm
const SECOND_URL = 'https://w1.anime4up.rest/home8/';

let chromeProcess = null;
let isConnected = false;

async function checkConnection() {
  try {
    const resp = await fetch(`http://localhost:${DEBUG_PORT}/json/version`);
    return resp.ok;
  } catch {
    return false;
  }
}

async function start() {
  if (await checkConnection()) {
    console.log('[Chrome] Already connected');
    isConnected = true;
    return true;
  }

  // Kill any existing Chrome processes that might interfere
  try { require('child_process').execSync('taskkill /F /IM chrome.exe 2>nul', { stdio: 'ignore' }); } catch {}
  await new Promise((r) => setTimeout(r, 2000));

  // Clean profile
  try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch {}

  console.log('[Chrome] Launching...');
  chromeProcess = spawn(CHROME_PATH, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${USER_DATA}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--disable-extensions',
    '--disable-background-networking',
    '--window-size=1024,768',
    '--window-position=-32000,-32000',
    START_URL,
  ], {
    stdio: 'ignore',
    detached: true,
  });
  chromeProcess.unref();

  // Wait for Chrome to be ready
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    if (await checkConnection()) {
      console.log('[Chrome] Ready, pre-warming sites...');
      // Pre-warm second site
      try {
        const puppeteer = require('puppeteer-core');
        const browser = await puppeteer.connect({
          browserURL: `http://localhost:${DEBUG_PORT}`,
          defaultViewport: null,
        });
        const page = await browser.newPage();
        await page.goto(SECOND_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await new Promise((r) => setTimeout(r, 8000));
        await browser.disconnect();
        console.log('[Chrome] Sites pre-warmed');
      } catch (e) {
        console.log('[Chrome] Pre-warm failed:', e.message);
      }
      isConnected = true;
      return true;
    }
  }

  console.log('[Chrome] Failed to start');
  return false;
}

function stop() {
  if (chromeProcess) {
    try { chromeProcess.kill(); } catch {}
    chromeProcess = null;
  }
  isConnected = false;
}

async function ensureReady() {
  if (isConnected && (await checkConnection())) return true;
  return start();
}

module.exports = { start, stop, ensureReady, DEBUG_PORT };

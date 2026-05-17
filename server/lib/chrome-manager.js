const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Cross-platform Chrome resolution.
// Order: CHROME_BIN env var → common Linux paths → Windows default → fail.
function resolveChromePath() {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) {
    return process.env.CHROME_BIN;
  }
  const candidates = process.platform === 'win32'
    ? [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      ]
    : [
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/snap/bin/chromium',
      ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch {}
  }
  throw new Error('Chrome/Chromium not found. Set CHROME_BIN env var.');
}

const CHROME_PATH = resolveChromePath();
const DEBUG_PORT = Number(process.env.CHROME_DEBUG_PORT || 9222);
const USER_DATA = path.join(process.env.TEMP || os.tmpdir(), 'anime-chrome');
const START_URL = 'https://witanime.you/';
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
  try {
    if (process.platform === 'win32') {
      require('child_process').execSync('taskkill /F /IM chrome.exe 2>nul', { stdio: 'ignore' });
    } else {
      require('child_process').execSync('pkill -f -- "(chrome|chromium)" 2>/dev/null || true', { stdio: 'ignore', shell: '/bin/sh' });
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 2000));

  // Clean profile
  try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch {}

  console.log(`[Chrome] Launching ${CHROME_PATH}...`);
  const args = [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${USER_DATA}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--disable-extensions',
    '--disable-background-networking',
    '--window-size=1024,768',
  ];

  if (process.platform === 'win32') {
    args.push('--window-position=-32000,-32000');
  } else {
    // Headless + sandbox flags for Linux containers
    args.push('--headless=new');
    args.push('--no-sandbox');
    args.push('--disable-setuid-sandbox');
    args.push('--disable-dev-shm-usage');
    args.push('--disable-gpu');
  }
  args.push(START_URL);

  chromeProcess = spawn(CHROME_PATH, args, {
    stdio: 'ignore',
    detached: true,
  });
  chromeProcess.unref();

  // Wait for Chrome to be ready
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    if (await checkConnection()) {
      // Skip pre-warm on low-RAM hosts (Render free tier etc.)
      if (process.env.SKIP_PREWARM === '1') {
        console.log('[Chrome] Ready (pre-warm skipped via SKIP_PREWARM)');
      } else {
        console.log('[Chrome] Ready, pre-warming sites...');
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

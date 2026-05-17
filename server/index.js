const express = require('express');
const cors = require('cors');

const homeRouter = require('./routes/home');
const searchRouter = require('./routes/search');
const episodesRouter = require('./routes/episodes');
const extractRouter = require('./routes/extract');
const resolveRouter = require('./routes/resolve');
const anime3rbRouter = require('./routes/anime3rb');
const anime4upRouter = require('./routes/anime4up');
const mergedRouter = require('./routes/merged');
const proxyVideoRouter = require('./routes/proxy-video');
const { setCookie, hasValidCookie } = require('./lib/cookie-manager');
const chrome = require('./lib/chrome-manager');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/home', homeRouter);
app.use('/api/search', searchRouter);
app.use('/api/episodes', episodesRouter);
app.use('/api/extract-video', extractRouter);
app.use('/api/resolve-video', resolveRouter);
app.use('/api/3rb', anime3rbRouter);
app.use('/api/4up', anime4upRouter);
app.use('/api/merged', mergedRouter);
app.use('/api/proxy-video', proxyVideoRouter);

// Cookie management for anime3rb
app.get('/api/3rb-cookie/status', (req, res) => {
  res.json({ valid: hasValidCookie() });
});

app.post('/api/3rb-cookie', express.json(), (req, res) => {
  const { cookie } = req.body || {};
  if (!cookie) return res.status(400).json({ success: false, error: 'cookie is required' });
  setCookie(cookie);
  res.json({ success: true, valid: hasValidCookie() });
});

// 404 catch-all
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route ${req.method} ${req.path} not found`,
  });
});

// Global error handler
app.use((err, req, res, _next) => {
  console.error('[GlobalError]', err.stack || err.message);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    details: err.message,
  });
});

app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Endpoints:');
  console.log('  GET /api/health');
  console.log('  GET /api/home');
  console.log('  GET /api/search?q=<query>');
  console.log('  GET /api/episodes?url=<anime_page_url>');
  console.log('  GET /api/extract-video?url=<episode_page_url>');
  console.log('  GET /api/4up/home');
  console.log('  GET /api/4up/search?q=<query>');
  console.log('  GET /api/4up/episodes?url=<anime_url>');
  console.log('  GET /api/4up/extract-video?url=<episode_url>');

  // Auto-launch Chrome for anime4up scraping
  chrome.start().then((ok) => {
    if (ok) console.log('[Server] Chrome ready for anime4up scraping');
    else console.log('[Server] Chrome failed - anime4up routes will error');
  });
});

// Graceful shutdown
process.on('SIGINT', () => { chrome.stop(); process.exit(); });
process.on('SIGTERM', () => { chrome.stop(); process.exit(); });

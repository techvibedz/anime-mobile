/**
 * Generates app icons + splash from inline SVG sources.
 * Run: node scripts/generate-icons.js
 * Outputs to: assets/
 *   - icon.png          (1024x1024) main app icon
 *   - adaptive-icon.png (1024x1024) Android adaptive foreground
 *   - splash.png        (1242x2436) launch splash
 *   - favicon.png       (48x48) web favicon
 */
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const ASSETS = path.join(__dirname, '..', 'assets');
fs.mkdirSync(ASSETS, { recursive: true });

// Pantoufa brand: hot pink → violet gradient on deep space black.
// Icon mark is a rounded play triangle, hinting at video playback.
const iconSvg = (size, padding = 0.18) => {
  const r = size * 0.22;                    // corner radius
  const pad = size * padding;
  const innerSize = size - pad * 2;
  const cx = size / 2;
  const cy = size / 2;
  // Play triangle geometry — visually centered (optical alignment)
  const triW = innerSize * 0.42;
  const triH = innerSize * 0.50;
  const triX = cx - triW * 0.35;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FF2D55"/>
      <stop offset="100%" stop-color="#7C5CFC"/>
    </linearGradient>
    <linearGradient id="glow" x1="50%" y1="0%" x2="50%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.30"/>
      <stop offset="60%" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="${size * 0.012}"/>
      <feOffset dx="0" dy="${size * 0.008}" result="offsetblur"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.35"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="url(#bg)"/>
  <rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="url(#glow)"/>
  <g filter="url(#shadow)">
    <path d="M ${triX} ${cy - triH / 2}
             L ${triX + triW} ${cy}
             L ${triX} ${cy + triH / 2}
             Z"
          fill="#FFFFFF"
          stroke="#FFFFFF"
          stroke-width="${size * 0.008}"
          stroke-linejoin="round"/>
  </g>
</svg>`;
};

// Splash uses solid bg + centered logo (small relative to canvas).
const splashSvg = (w, h) => {
  const size = Math.min(w, h) * 0.32;
  const x = (w - size) / 2;
  const y = (h - size) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <radialGradient id="rg" cx="50%" cy="42%" r="55%">
      <stop offset="0%" stop-color="#1B0A2A"/>
      <stop offset="100%" stop-color="#06071A"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#rg)"/>
  <g transform="translate(${x} ${y})">
    ${iconSvg(size).replace(/^<svg[^>]*>|<\/svg>$/g, '')}
  </g>
</svg>`;
};

// Adaptive icon foreground: just the play mark on transparent — Android composes it
// onto the background color set in app.json (#06071A).
const adaptiveSvg = (size) => {
  const inner = size * 0.55;
  const off = (size - inner) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <g transform="translate(${off} ${off})">
    ${iconSvg(inner).replace(/^<svg[^>]*>|<\/svg>$/g, '')}
  </g>
</svg>`;
};

async function generate() {
  const tasks = [
    { name: 'icon.png',          svg: iconSvg(1024),         out: 'icon.png' },
    { name: 'adaptive-icon.png', svg: adaptiveSvg(1024),     out: 'adaptive-icon.png' },
    { name: 'splash.png',        svg: splashSvg(1242, 2436), out: 'splash.png' },
    { name: 'favicon.png',       svg: iconSvg(48),           out: 'favicon.png' },
  ];

  for (const t of tasks) {
    const target = path.join(ASSETS, t.out);
    await sharp(Buffer.from(t.svg)).png().toFile(target);
    const stat = fs.statSync(target);
    console.log(`  ✓ ${t.out.padEnd(22)} ${(stat.size / 1024).toFixed(1)} KB`);
  }
  console.log('Done.');
}

generate().catch((err) => { console.error(err); process.exit(1); });

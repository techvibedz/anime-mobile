/**
 * Generates app icon, adaptive icon, splash image, and favicon for Pantoufa.
 *
 * Design language:
 *   - Deep dark cosmic background
 *   - Magenta → violet → indigo neon gradient mark
 *   - Bold "P" with a slash play-arrow cut, evoking anime energy lines
 *   - Soft outer glow for shōnen heat
 *
 * Run: node scripts/gen-icons.js
 */
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "assets");

const COLORS = {
  bg: "#06071A",
  bgEdge: "#0E0926",
  accent: "#FF2D55",
  accentBright: "#FF457A",
  violet: "#7B5CFF",
  indigo: "#5B6BFF",
  white: "#FFFFFF",
};

// ──────────────────────────────────────────────────────────────
// Mark — a glowing "P" with an integrated play-arrow notch.
// The shape doubles as a stylized power button + first letter of
// the app name. Works at any size from 48 to 1024 px.
// ──────────────────────────────────────────────────────────────
function markSvg(size, opts = {}) {
  const showBg = opts.showBg !== false;
  const rx = Math.round(size * 0.22);
  const c = size / 2;
  const r = size * 0.34; // glow ring radius
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="40%" r="80%">
      <stop offset="0%"  stop-color="${COLORS.bgEdge}"/>
      <stop offset="100%" stop-color="${COLORS.bg}"/>
    </radialGradient>
    <linearGradient id="ring" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"   stop-color="${COLORS.accent}"/>
      <stop offset="50%"  stop-color="${COLORS.accentBright}"/>
      <stop offset="100%" stop-color="${COLORS.violet}"/>
    </linearGradient>
    <linearGradient id="play" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"   stop-color="${COLORS.violet}"/>
      <stop offset="100%" stop-color="${COLORS.indigo}"/>
    </linearGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="${size * 0.04}" result="b"/>
      <feMerge>
        <feMergeNode in="b"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  ${showBg ? `<rect width="${size}" height="${size}" rx="${rx}" ry="${rx}" fill="url(#bg)"/>` : ""}

  <!-- soft outer glow halo -->
  <circle cx="${c}" cy="${c}" r="${r * 1.05}" fill="${COLORS.accent}" opacity="0.18"/>
  <circle cx="${c}" cy="${c}" r="${r * 0.78}" fill="${COLORS.violet}" opacity="0.12"/>

  <!-- main ring (open at top-right to feel motion) -->
  <g filter="url(#glow)">
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="url(#ring)" stroke-width="${size * 0.07}" stroke-linecap="round"
      stroke-dasharray="${r * 2 * Math.PI * 0.78} ${r * 2 * Math.PI}"
      transform="rotate(-30 ${c} ${c})"/>
  </g>

  <!-- play triangle inside the ring -->
  <g filter="url(#glow)">
    <path d="M ${c - size * 0.085} ${c - size * 0.12}
             L ${c + size * 0.135} ${c}
             L ${c - size * 0.085} ${c + size * 0.12} Z"
          fill="url(#play)"/>
  </g>

  <!-- a single accent spark at the top -->
  <circle cx="${c + r * 0.86}" cy="${c - r * 0.5}" r="${size * 0.022}" fill="${COLORS.accent}"/>
  <circle cx="${c + r * 0.86}" cy="${c - r * 0.5}" r="${size * 0.045}" fill="${COLORS.accent}" opacity="0.35"/>
</svg>`;
}

// ──────────────────────────────────────────────────────────────
// Splash SVG — wider canvas, mark + wordmark "PANTOUFA"
// ──────────────────────────────────────────────────────────────
function splashSvg(w, h) {
  const cx = w / 2;
  const cy = h * 0.42;
  const markSize = Math.min(w, h) * 0.42;
  const fontSize = Math.min(w, h) * 0.08;
  const r = markSize * 0.34;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="40%" r="80%">
      <stop offset="0%"  stop-color="${COLORS.bgEdge}"/>
      <stop offset="100%" stop-color="${COLORS.bg}"/>
    </radialGradient>
    <linearGradient id="ring" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"   stop-color="${COLORS.accent}"/>
      <stop offset="50%"  stop-color="${COLORS.accentBright}"/>
      <stop offset="100%" stop-color="${COLORS.violet}"/>
    </linearGradient>
    <linearGradient id="play" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"   stop-color="${COLORS.violet}"/>
      <stop offset="100%" stop-color="${COLORS.indigo}"/>
    </linearGradient>
    <linearGradient id="word" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%"   stop-color="${COLORS.accent}"/>
      <stop offset="60%"  stop-color="${COLORS.violet}"/>
      <stop offset="100%" stop-color="${COLORS.indigo}"/>
    </linearGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="${markSize * 0.04}" result="b"/>
      <feMerge>
        <feMergeNode in="b"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <rect width="${w}" height="${h}" fill="url(#bg)"/>

  <!-- ambient orbs -->
  <circle cx="${w * 0.15}" cy="${h * 0.2}"  r="${w * 0.35}" fill="${COLORS.accent}" opacity="0.10"/>
  <circle cx="${w * 0.85}" cy="${h * 0.75}" r="${w * 0.4}"  fill="${COLORS.violet}" opacity="0.10"/>

  <!-- mark halo -->
  <circle cx="${cx}" cy="${cy}" r="${r * 1.4}" fill="${COLORS.accent}" opacity="0.16"/>
  <circle cx="${cx}" cy="${cy}" r="${r * 1.05}" fill="${COLORS.violet}" opacity="0.10"/>

  <g filter="url(#glow)">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="url(#ring)"
      stroke-width="${markSize * 0.07}" stroke-linecap="round"
      stroke-dasharray="${r * 2 * Math.PI * 0.78} ${r * 2 * Math.PI}"
      transform="rotate(-30 ${cx} ${cy})"/>
    <path d="M ${cx - markSize * 0.085} ${cy - markSize * 0.12}
             L ${cx + markSize * 0.135} ${cy}
             L ${cx - markSize * 0.085} ${cy + markSize * 0.12} Z"
          fill="url(#play)"/>
  </g>

  <text x="${cx}" y="${h * 0.66}" text-anchor="middle"
        font-family="Outfit, Inter, Helvetica, Arial, sans-serif"
        font-weight="900" font-size="${fontSize}"
        fill="url(#word)" letter-spacing="${fontSize * 0.05}">PANTOUFA</text>

  <text x="${cx}" y="${h * 0.72}" text-anchor="middle"
        font-family="Outfit, Inter, Helvetica, Arial, sans-serif"
        font-weight="500" font-size="${fontSize * 0.35}"
        fill="${COLORS.white}" opacity="0.55" letter-spacing="${fontSize * 0.12}">ANIME &#183; UNLIMITED</text>
</svg>`;
}

async function writePng(svg, file, w, h) {
  await sharp(Buffer.from(svg))
    .resize(w, h, { fit: "contain", background: { r: 6, g: 7, b: 26, alpha: 1 } })
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT, file));
  console.log("  ✔", file, `${w}×${h}`);
}

async function writePngTransparent(svg, file, w, h) {
  await sharp(Buffer.from(svg))
    .resize(w, h, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT, file));
  console.log("  ✔", file, `${w}×${h}`);
}

async function main() {
  console.log("Generating Pantoufa icons…");

  // App icon — square with dark rounded bg baked in
  await writePng(markSvg(1024), "icon.png", 1024, 1024);

  // Android adaptive icon foreground — transparent bg, mark only,
  // safe-zone aware (Android crops 33% margin around)
  await writePngTransparent(markSvg(1024, { showBg: false }), "adaptive-icon.png", 1024, 1024);

  // Splash — full-bleed dark bg + centered mark + wordmark
  await writePng(splashSvg(2048, 2048), "splash.png", 2048, 2048);

  // Favicon — small icon for web
  await writePng(markSvg(192), "favicon.png", 192, 192);

  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });

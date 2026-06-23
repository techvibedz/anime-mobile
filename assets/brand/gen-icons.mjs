// Pantoufa — SUMI "Ink & Ember" brand mark generator.
// Renders icon / adaptive-icon / splash / favicon from a single vector source.
// The mark: a geometric "P" whose counter is a play ▶ triangle (Pantoufa = play).
//   run:  node assets/brand/gen-icons.mjs
import sharp from "sharp";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const out = (p) => resolve(root, "assets", p);

const INK = "#0A0A0B";

// --- the glyph, drawn in a 360 x 620 box -----------------------------------
// Outer "P": rounded stem on the left + a right-bulging semicircular bowl.
// Counter: a play triangle (carved as a hole via fill-rule:evenodd).
const P_OUTER =
  "M0 30 Q0 0 30 0 L160 0 " +          // top-left round + top edge to bowl
  "A200 200 0 0 1 160 400 " +          // bowl outer, right semicircle
  "L160 590 Q160 620 130 620 " +       // down stem right + bottom-right round
  "L30 620 Q0 620 0 590 Z";            // bottom edge + bottom-left round
const P_HOLE = "M176 122 L176 278 L308 200 Z"; // play triangle counter
const P_PATH = P_OUTER + " " + P_HOLE;

const GW = 360, GH = 620;

// Place the glyph at a target height inside a square canvas.
function glyph(canvas, targetH, { shadow = true } = {}) {
  const s = targetH / GH;
  const gw = GW * s, gh = GH * s;
  const tx = (canvas - gw) / 2;
  const ty = (canvas - gh) / 2;
  const shadowEl = shadow
    ? `<g transform="translate(${tx},${ty}) scale(${s})" filter="url(#shadow)">
         <path d="${P_PATH}" fill="#000" fill-opacity="0.45" fill-rule="evenodd" transform="translate(0,18)"/>
       </g>`
    : "";
  return `${shadowEl}
    <g transform="translate(${tx},${ty}) scale(${s})">
      <path d="${P_PATH}" fill="url(#ember)" fill-rule="evenodd"/>
      <path d="${P_OUTER}" fill="none" stroke="url(#sheen)" stroke-width="3" stroke-opacity="0.5"/>
    </g>`;
}

const DEFS = (glowR = 0.55, glowO = 0.32) => `
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#111114"/>
      <stop offset="1" stop-color="#050506"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.34" r="${glowR}">
      <stop offset="0"   stop-color="#FF5A2C" stop-opacity="${glowO}"/>
      <stop offset="0.55" stop-color="#FF5A2C" stop-opacity="0.07"/>
      <stop offset="1"   stop-color="#FF5A2C" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="ember" x1="0.15" y1="0" x2="0.35" y2="1">
      <stop offset="0"    stop-color="#FF9159"/>
      <stop offset="0.45" stop-color="#FF5A2C"/>
      <stop offset="1"    stop-color="#D6431D"/>
    </linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0"   stop-color="#FFD2B8" stop-opacity="0.9"/>
      <stop offset="0.4" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
    <filter id="shadow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="20"/>
    </filter>
  </defs>`;

// Full square tile (iOS icon / favicon): gradient ink + ember glow + mark.
function tileSVG(size, targetH) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
    ${DEFS()}
    <rect width="${size}" height="${size}" fill="${INK}"/>
    <rect width="${size}" height="${size}" fill="url(#tile)"/>
    <rect width="${size}" height="${size}" fill="url(#glow)"/>
    ${glyph(size, targetH)}
  </svg>`;
}

// Transparent mark (splash / Android adaptive foreground): glow halo + mark.
function markSVG(size, targetH, glowR, glowO) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
    ${DEFS(glowR, glowO)}
    <rect width="${size}" height="${size}" fill="url(#glow)"/>
    ${glyph(size, targetH)}
  </svg>`;
}

const png = (svg, size) =>
  sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

const jobs = [
  // iOS / store icon — full-bleed tile, confident mark
  ["icon.png", () => png(tileSVG(1024, 560), 1024)],
  // Android adaptive foreground — mark inside the 66% safe zone, transparent
  ["adaptive-icon.png", () => png(markSVG(1024, 470, 0.42, 0.26), 1024)],
  // Splash — logo sized for the expo-splash-screen plugin (imageWidth), glow
  // fades to transparent before the edges so the ink backgroundColor fills the
  // rest of the screen seamlessly (true full-screen, no visible seam).
  ["splash.png", () => png(markSVG(1024, 600, 0.5, 0.16), 1024)],
  // Web favicon — small tile
  ["favicon.png", () => png(tileSVG(256, 150), 256)],
];

for (const [name, make] of jobs) {
  const buf = await make();
  writeFileSync(out(name), buf);
  console.log("wrote", name, (buf.length / 1024).toFixed(0) + "KB");
}
console.log("done");

/* ============================================================
   Pantoufa landing — interactions + LIVE auto-update
   ============================================================ */

// Where the always-current release info lives. The app already bumps
// version.json on every release, so the page stays in sync with zero redeploys.
const VERSION_JSON_URL =
  'https://raw.githubusercontent.com/techvibedz/anime-mobile/master/version.json';
// Fallback if raw is rate-limited / cached: latest GitHub release page.
const RELEASES_FALLBACK =
  'https://github.com/techvibedz/anime-mobile/releases/latest';

/* ---------- LIVE: pull latest version + APK url ---------- */
async function loadLatestRelease() {
  const btns = [
    document.getElementById('downloadBtn'),
    document.getElementById('downloadBtn2'),
  ].filter(Boolean);

  // sensible default so buttons are never dead
  btns.forEach((b) => (b.href = RELEASES_FALLBACK));

  try {
    const res = await fetch(VERSION_JSON_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('bad status ' + res.status);
    const data = await res.json();

    const apkUrl = data.apk_url || RELEASES_FALLBACK;
    const version = data.version ? 'v' + data.version : '';

    btns.forEach((b) => {
      b.href = apkUrl;
      // hint the browser to download the .apk rather than navigate
      if (apkUrl.endsWith('.apk')) b.setAttribute('download', '');
    });

    // version chip
    const chip = document.getElementById('versionChip');
    if (chip && version) {
      chip.innerHTML = `<span class="chip__pulse"></span> الإصدار ${version}`;
    }
    // download button meta
    const meta = document.getElementById('downloadMeta');
    if (meta && version) meta.textContent = `APK · ${version} · أندرويد`;

    const label2 = document.getElementById('downloadBtn2Label');
    if (label2 && version) label2.textContent = `تحميل ${version}`;

    // release notes (Arabic)
    const notes = document.getElementById('releaseNotes');
    if (notes && data.release_notes) notes.textContent = data.release_notes;
  } catch (err) {
    console.warn('[pantoufa] could not load version.json, using fallback link.', err);
  }
}
loadLatestRelease();

/* ---------- year ---------- */
const y = document.getElementById('year');
if (y) y.textContent = new Date().getFullYear();

/* ---------- nav scroll state ---------- */
const nav = document.getElementById('nav');
const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 24);
onScroll();
window.addEventListener('scroll', onScroll, { passive: true });

/* ---------- scroll reveal ---------- */
const io = new IntersectionObserver(
  (entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    });
  },
  { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
);
document.querySelectorAll('.reveal').forEach((el) => io.observe(el));

/* ---------- 3D tilt on the hero phone ---------- */
const tiltWrap = document.querySelector('[data-tilt]');
const frame = document.querySelector('.device--hero');
if (tiltWrap && frame && window.matchMedia('(pointer:fine)').matches) {
  tiltWrap.addEventListener('mousemove', (e) => {
    const r = tiltWrap.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    frame.style.animation = 'none';
    frame.style.transform = `rotateY(${px * 10}deg) rotateX(${-py * 10}deg) translateY(-6px)`;
  });
  tiltWrap.addEventListener('mouseleave', () => {
    frame.style.transform = '';
    frame.style.animation = '';
  });
}

/* ---------- hero phone auto-scroll (measured, never over-scrolls) ---------- */
function animateHeroScroll() {
  const screen = document.querySelector('.device--hero .device__screen');
  const content = document.querySelector('.device--hero .app--scroll');
  if (!screen || !content) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // distance = exactly how far we can scroll so the last section rests above the nav
  const dist = Math.max(0, content.scrollHeight - screen.clientHeight + 8);

  content.style.animation = 'none'; // disable the CSS fallback
  content.getAnimations?.().forEach((a) => a.cancel());
  content.animate(
    [
      { transform: 'translateY(0)', offset: 0 },
      { transform: 'translateY(0)', offset: 0.08 },
      { transform: `translateY(${-dist}px)`, offset: 0.5 },
      { transform: `translateY(${-dist}px)`, offset: 0.6 },
      { transform: 'translateY(0)', offset: 1 },
    ],
    { duration: 16000, iterations: Infinity, easing: 'ease-in-out' }
  );
}
// measure after layout + fonts/images settle, and on resize
window.addEventListener('load', () => setTimeout(animateHeroScroll, 300));
let heroResizeT;
addEventListener('resize', () => {
  clearTimeout(heroResizeT);
  heroResizeT = setTimeout(animateHeroScroll, 250);
}, { passive: true });

/* ---------- particle field (cheap, GPU-friendly) ---------- */
(function particles() {
  const canvas = document.getElementById('particles');
  if (!canvas || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ctx = canvas.getContext('2d');
  let w, h, dots, dpr;
  // SUMI is hairlines, not glow: faint bone dust + a rare ember ember-spark.
  // Most motes are bone; ~1 in 7 carries a quiet ember to echo the accent.
  const BONE = 'rgba(244,241,234,0.9)';
  const EMBER = '#FF5A2C';

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.width = innerWidth * dpr;
    h = canvas.height = innerHeight * dpr;
    canvas.style.width = innerWidth + 'px';
    canvas.style.height = innerHeight + 'px';
    const count = Math.min(64, Math.floor((innerWidth * innerHeight) / 24000));
    dots = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: (Math.random() * 1.4 + 0.3) * dpr,
      vx: (Math.random() - 0.5) * 0.18 * dpr,
      vy: (Math.random() - 0.5) * 0.18 * dpr,
      c: Math.random() < 0.14 ? EMBER : BONE,
      a: Math.random() * 0.28 + 0.06,
    }));
  }

  function tick() {
    ctx.clearRect(0, 0, w, h);
    for (const d of dots) {
      d.x += d.vx;
      d.y += d.vy;
      if (d.x < 0 || d.x > w) d.vx *= -1;
      if (d.y < 0 || d.y > h) d.vy *= -1;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fillStyle = d.c;
      ctx.globalAlpha = d.a;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(tick);
  }

  resize();
  addEventListener('resize', resize, { passive: true });
  tick();
})();

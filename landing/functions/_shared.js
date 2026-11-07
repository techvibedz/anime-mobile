// Shared helpers for the Pages Functions (moment + Wrapped share pages).
// The anon key is the app's public client key (RLS limits it to the public
// read policies on shared_moments / wrapped_cards).

export const SUPABASE_URL = "https://iwrphgttbjqifstqttqm.supabase.co";
export const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml3cnBoZ3R0YmpxaWZzdHF0dHFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwMTQ1NTgsImV4cCI6MjA5NDU5MDU1OH0.eKooQPiqXAdBvnjvVCWW837pFbXjVdQ_xywinm82EUE";
export const FALLBACK = "https://github.com/techvibedz/anime-mobile/releases/latest";
export const ID_RE = /^[A-Za-z0-9]{6,12}$/;

export function esc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function httpsUrl(v) {
  return typeof v === "string" && /^https:\/\/[^\s"'<>]+$/.test(v) ? v : "";
}

export async function fetchRow(table, id) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&select=*&limit=1`,
    { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, Accept: "application/json" } },
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

export function intentUrl(path) {
  return `intent://${path}#Intent;scheme=anime-mobile;package=com.anime.mobile;S.browser_fallback_url=${encodeURIComponent(FALLBACK)};end`;
}

export function clock(total) {
  const s = Math.max(0, Math.floor(Number(total) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${m}:${p(sec)}`;
}

export function page({ title, description, image, url, body, autoOpen }) {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
  <meta name="robots" content="noindex" />
  <meta name="theme-color" content="#08090C" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="بانتوفة" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  ${image ? `<meta property="og:image" content="${esc(image)}" />` : ""}
  <meta property="og:url" content="${esc(url)}" />
  <meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}" />
  <link rel="icon" href="/assets/favicon.png" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@500;600;700;900&family=Outfit:wght@600;700;800;900&display=swap" rel="stylesheet" />
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#08090C;color:#F4F4F8;font-family:Cairo,system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:28px 16px}
    .wrap{width:100%;max-width:440px;display:flex;flex-direction:column;align-items:center;gap:16px;text-align:center}
    .logo{width:64px;height:64px;border-radius:18px}
    .kicker{font-family:Outfit,sans-serif;font-weight:700;letter-spacing:2px;color:#5EEAD4;font-size:12px;text-transform:uppercase}
    .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-width:260px;padding:14px 22px;border-radius:16px;font-weight:700;font-size:16px;text-decoration:none}
    .btn--primary{background:#8B93FF;color:#08090C}
    .btn--ghost{background:rgba(255,255,255,.06);color:#F4F4F8;border:1px solid rgba(255,255,255,.12)}
    .hint{color:rgba(244,244,248,.6);font-size:13px;line-height:1.9;max-width:380px}
    .err{color:#FF8A8A;font-size:16px}
  </style>
</head>
<body>
  <main class="wrap">
    <img src="/assets/logo.png" alt="بانتوفة" class="logo" />
    ${body}
  </main>
  ${autoOpen ? `<script>
    if (/Android/i.test(navigator.userAgent)) {
      setTimeout(function () { if (!document.hidden) location.href = ${JSON.stringify(autoOpen)}; }, 900);
    }
  </script>` : ""}
</body>
</html>`;
}

export function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": status === 200 ? "public, max-age=300" : "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export function notFound(what) {
  return html(page({
    title: "بانتوفة",
    description: "",
    image: "",
    url: "",
    body: `<p class="err">${esc(what)}</p><a class="btn btn--ghost" href="${FALLBACK}">تحميل بانتوفة</a>`,
  }), 404);
}

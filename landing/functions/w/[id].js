// /w/<id> — public Pantoufa Wrapped card (mirrors components/WrappedCard.tsx).
import { ID_RE, FALLBACK, esc, fetchRow, html, httpsUrl, notFound, page } from "../_shared.js";

const PERSONA = {
  night_owl: ["🦉", "بومة الليل"],
  marathoner: ["🏃", "ماراثوني"],
  completer: ["🏆", "المُكمِل"],
  explorer: ["🧭", "المستكشف"],
  loyal: ["💞", "المخلص"],
  weekend: ["🎉", "بطل العطلة"],
  fan: ["✨", "عاشق الأنمي"],
};
const GENRE_AR = {
  Action: "أكشن", Adventure: "مغامرة", Comedy: "كوميدي", Drama: "دراما", Fantasy: "خيال", Horror: "رعب",
  Mecha: "ميكا", Music: "موسيقى", Mystery: "غموض", Psychological: "نفسي", Romance: "رومانسي",
  "Sci-Fi": "خيال علمي", "Slice of Life": "حياة يومية", Sports: "رياضي", Supernatural: "خارق", Thriller: "إثارة",
};

function personaDesc(p) {
  switch (p.personality) {
    case "night_owl": return `${p.nightPct}% من الحلقات بعد منتصف الليل`;
    case "marathoner": return `${p.bestDay?.episodes ?? 0} حلقات في يوم واحد`;
    case "completer": return `أنهى ${p.completedAnime} أنمي هذا العام`;
    case "explorer": return `جرّب ${p.animeCount} أنمي مختلفًا`;
    case "loyal": return `قلبه مع ${p.top?.[0]?.title ?? "أنميه المفضل"}`;
    case "weekend": return "العطلة = أنمي";
    default: return "كل حلقة خطوة في الرحلة";
  }
}

const n = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0);

export async function onRequestGet({ params, request }) {
  const id = String(params.id || "");
  if (!ID_RE.test(id)) return notFound("الرابط غير صالح.");
  let row = null;
  try {
    row = await fetchRow("wrapped_cards", id);
  } catch {}
  const p = row?.payload;
  if (!p || typeof p !== "object") return notFound("هذا الملخص غير موجود.");

  const year = n(p.year);
  const minutes = n(p.minutes);
  const hours = Math.floor(minutes / 60);
  const big = hours > 0 ? hours : minutes;
  const bigLabel = hours > 0 ? "ساعة من الأنمي" : "دقيقة من الأنمي";
  const name = String(p.name || "").slice(0, 40);
  const [glyph, personaTitle] = PERSONA[p.personality] || PERSONA.fan;
  const top = Array.isArray(p.top) ? p.top.slice(0, 3) : [];
  const months = Array.isArray(p.months) && p.months.length === 12 ? p.months.map(n) : new Array(12).fill(0);
  const maxMonth = Math.max(1, ...months);
  const topMonth = months.indexOf(Math.max(...months));
  const genres = Array.isArray(p.genres) ? p.genres.slice(0, 3) : [];
  const image = httpsUrl(top[0]?.image);

  const stat = (v, label) =>
    `<div style="flex:1;text-align:center"><div style="font-family:Outfit,sans-serif;font-weight:800;font-size:22px">${n(v)}</div><div style="font-size:11px;color:rgba(255,255,255,.6);font-weight:600">${label}</div></div>`;

  const card = `
  <div style="position:relative;width:100%;max-width:400px;aspect-ratio:9/16;border-radius:26px;overflow:hidden;background:linear-gradient(180deg,#191B3A,#0C0D18 55%,#08090C);text-align:right;padding:24px;display:flex;flex-direction:column;box-shadow:0 30px 80px rgba(0,0,0,.6)">
    <div style="position:absolute;top:-70px;left:-60px;width:260px;height:260px;border-radius:50%;background:rgba(139,147,255,.22);filter:blur(10px)"></div>
    <div style="position:absolute;bottom:40px;right:-70px;width:200px;height:200px;border-radius:50%;background:rgba(94,234,212,.12);filter:blur(10px)"></div>
    <div style="position:relative;display:flex;flex-direction:column;flex:1">
      <div style="font-family:Outfit,sans-serif;font-weight:700;letter-spacing:1.5px;color:#5EEAD4;font-size:11px">PANTOUFA WRAPPED · ${year}</div>
      <div style="color:rgba(255,255,255,.75);font-weight:600;font-size:15px">${esc(name || "مشاهد بانتوفة")}</div>
      <div style="margin-top:16px;font-family:Outfit,sans-serif;font-weight:900;font-size:64px;line-height:1.1">${big}</div>
      <div style="color:#C9CCFF;font-weight:700;font-size:15px">${bigLabel}</div>
      <div style="display:flex;margin-top:16px">${stat(p.episodes, "حلقة")}${stat(p.animeCount, "أنمي")}${stat(p.completedAnime, "مكتمل")}${stat(p.longestStreak, "أيام متتالية")}</div>
      <div style="margin-top:16px;display:flex;align-items:center;gap:10px;padding:12px;border-radius:18px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1)">
        <div style="font-size:30px">${glyph}</div>
        <div><div style="font-weight:700;font-size:17px">${personaTitle}</div><div style="font-size:12px;color:rgba(255,255,255,.65)">${esc(personaDesc(p))}</div></div>
      </div>
      ${top.length ? `<div style="margin-top:16px;color:rgba(255,255,255,.55);font-weight:700;font-size:12px">الأكثر مشاهدة</div>` : ""}
      ${top.map((a, i) => `
        <div style="display:flex;align-items:center;gap:10px;margin-top:8px">
          <div style="width:22px;text-align:center;font-family:Outfit,sans-serif;font-weight:900;font-size:18px;color:#5EEAD4">${i + 1}</div>
          ${httpsUrl(a.image) ? `<img src="${esc(httpsUrl(a.image))}" alt="" style="width:34px;height:48px;object-fit:cover;border-radius:7px" />` : ""}
          <div style="min-width:0"><div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.title)}</div><div style="font-size:11px;color:rgba(255,255,255,.55)">${n(a.episodes)} حلقة</div></div>
        </div>`).join("")}
      ${genres.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:14px">${genres.map((g) => `<span style="font-size:11px;font-weight:600;padding:4px 10px;border-radius:20px;background:rgba(139,147,255,.18);border:1px solid rgba(139,147,255,.35);color:#D9DBFF">${esc(GENRE_AR[g] || g)}</span>`).join("")}</div>` : ""}
      <div style="flex:1"></div>
      <div style="display:flex;align-items:flex-end;height:38px;direction:ltr">
        ${months.map((m, i) => `<div style="flex:1;display:flex;justify-content:center;align-items:flex-end;height:100%"><div style="width:62%;height:${Math.max(2, Math.round((m / maxMonth) * 34))}px;border-radius:3px;background:${i === topMonth && m > 0 ? "#5EEAD4" : "rgba(139,147,255,.55)"}"></div></div>`).join("")}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
        <span style="font-weight:700;font-size:14px">بانتوفة</span>
        <span style="font-family:Outfit,sans-serif;font-size:10px;color:rgba(255,255,255,.45)">pantoufa-join.pages.dev</span>
      </div>
    </div>
  </div>`;

  const title = `${name || "مشاهد"} — سنة ${year} في الأنمي: ${big} ${hours > 0 ? "ساعة" : "دقيقة"}`;
  const description = `${personaTitle} ${glyph} · ${n(p.episodes)} حلقة من ${n(p.animeCount)} أنمي على بانتوفة. اصنع ملخصك أنت أيضًا!`;
  const body = `${card}
    <p class="hint">اصنع ملخصك السنوي من الملف الشخصي في تطبيق بانتوفة.</p>
    <a class="btn btn--primary" href="${FALLBACK}">حمّل بانتوفة مجانًا</a>`;
  return html(page({ title, description, image, url: request.url, body }));
}

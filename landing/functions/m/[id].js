// /m/<id> — shared-moment page: rich preview for chat apps + one tap into
// the app at the exact timestamp (anime-mobile://moment/<id>).
import { ID_RE, FALLBACK, clock, esc, fetchRow, html, httpsUrl, intentUrl, notFound, page } from "../_shared.js";

export async function onRequestGet({ params, request }) {
  const id = String(params.id || "");
  if (!ID_RE.test(id)) return notFound("رابط اللحظة غير صالح.");
  let m = null;
  try {
    m = await fetchRow("shared_moments", id);
  } catch {}
  if (!m) return notFound("هذه اللحظة غير موجودة أو حُذفت.");

  const at = clock(m.t_sec);
  const ep = m.ep_num != null ? `الحلقة ${m.ep_num}` : "";
  const title = `${m.anime_title}${ep ? ` — ${ep}` : ""} · ${at}`;
  const who = m.sharer_name ? `${m.sharer_name} يشاركك` : "لحظة مشتركة";
  const description = `${who} هذه اللحظة على بانتوفة — افتحها لتبدأ المشاهدة من ${at} مباشرة.`;
  const image = httpsUrl(m.image);
  const intent = intentUrl(`moment/${id}`);

  const body = `
    <span class="kicker">Pantoufa · Moment</span>
    ${image ? `<img src="${esc(image)}" alt="" style="width:180px;aspect-ratio:2/3;object-fit:cover;border-radius:18px;box-shadow:0 18px 50px rgba(0,0,0,.6)" />` : ""}
    <h1 style="font-weight:900;font-size:24px;line-height:1.5">${esc(m.anime_title)}</h1>
    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">
      ${ep ? `<span style="background:rgba(139,147,255,.16);border:1px solid rgba(139,147,255,.4);color:#C9CCFF;border-radius:999px;padding:4px 14px;font-weight:700">${esc(ep)}</span>` : ""}
      <span style="background:rgba(94,234,212,.12);border:1px solid rgba(94,234,212,.35);color:#5EEAD4;border-radius:999px;padding:4px 14px;font-family:Outfit,sans-serif;font-weight:800">${esc(at)}</span>
    </div>
    <p class="hint">${esc(who)} — اضغط ليفتح التطبيق على هذه الثانية بالضبط.</p>
    <a class="btn btn--primary" href="${esc(intent)}">افتح في بانتوفة</a>
    <a class="btn btn--ghost" href="${FALLBACK}">تحميل بانتوفة</a>`;

  return html(page({ title, description, image, url: request.url, body, autoOpen: intent }));
}

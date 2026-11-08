// /download — always serves the LATEST Pantoufa APK as a direct file download.
// Reads apk_url from version.json (bumped on every release) and streams the
// APK through this origin with Content-Disposition: attachment, so tapping
// "download" saves the file immediately instead of opening a GitHub page.
const VERSION_JSON = "https://raw.githubusercontent.com/techvibedz/anime-mobile/master/version.json";

async function latestApk() {
  const res = await fetch(VERSION_JSON, { cf: { cacheTtl: 120, cacheEverything: true } });
  if (!res.ok) throw new Error("version.json " + res.status);
  const data = await res.json();
  const url = String(data.apk_url || "");
  if (!/^https:\/\/github\.com\/techvibedz\/anime-mobile\/releases\/download\/[^\s]+\.apk$/.test(url)) {
    throw new Error("bad apk_url");
  }
  return { url, version: String(data.version || "") };
}

export async function onRequest({ request }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }
  let apk;
  try {
    apk = await latestApk();
  } catch {
    return new Response("تعذر الوصول إلى ملف التحميل، حاول لاحقًا.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  const name = apk.version ? `pantoufa-${apk.version}.apk` : "pantoufa.apk";
  try {
    const upstream = await fetch(apk.url, {
      method: request.method,
      redirect: "follow",
      headers: { "User-Agent": "pantoufa-download/1.0" },
    });
    if (!upstream.ok || !upstream.body && request.method === "GET") throw new Error("upstream " + upstream.status);
    const headers = new Headers({
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    });
    const len = upstream.headers.get("Content-Length");
    if (len) headers.set("Content-Length", len);
    return new Response(upstream.body, { status: 200, headers });
  } catch {
    // Streaming failed — the release asset URL itself is still a direct
    // file download (GitHub answers it with an attachment), never a web page.
    return Response.redirect(apk.url, 302);
  }
}

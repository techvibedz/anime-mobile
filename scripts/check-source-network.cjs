// Exercise the real request/browser/cache paths with deterministic network failures.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function load(file, imports = {}, globals = {}, append = "") {
  const context = { exports: {}, URL, AbortController, setTimeout, clearTimeout, ...globals,
    require(name) { assert.ok(name in imports, `unmocked import ${name}`); return imports[name]; } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8") + append, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, context);
  return context.exports;
}
const storage = { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} };
const domains = load("lib/scraper/sourceDomains.ts", { "@react-native-async-storage/async-storage": storage });
const shortTimers = { setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 5)), clearTimeout };
const cache = load("lib/requestCache.ts", {}, shortTimers);
const scripts = load("lib/scraper/scripts.ts", { "../videoProviders": { providerClassifierScript: () => "" } });
let fetcher, browser, requests;
const direct = load("lib/scraper/direct.ts", {
  "@react-native-async-storage/async-storage": storage,
  "./bus": { enqueue: (job) => browser(job) }, "./scripts": scripts,
  "../fuzzy": { fuzzyScore: () => 0 }, "../remoteLog": { remoteLog: () => {} },
  "../videoProviders": { VIDEO_USER_AGENT: "test-browser" }, "./sourceDomains": domains,
}, { ...shortTimers, fetch: (url, init) => { requests.push(url); return fetcher(url, init); } },
"\nexport { rawGetA3rb, fetchWitPlayerResponse };\n");

const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status,
  headers: { get: () => null }, text: async () => body });
function stalledBody(_url, { signal }) {
  return { ...response(""), text: () => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("body aborted")), { once: true });
  }) };
}

async function main() {
  for (const host of ["witanime.site", "w1.anime4up.rest", "anime3rb.com", "3asq.online", "mangalik.net", "mangawy.org"]) {
    assert.equal(domains.isVerificationSourceUrl(`https://${host}/`), true);
  }
  assert.equal(domains.isVerificationSourceUrl("https://mangawy.org.evil.example/"), false);
  assert.equal(domains.isVerificationSourceUrl("https://www.mp4upload.com/"), false);
  assert.equal(domains.isValidSourceHtml("witanime", '<title>Just a moment</title>witanime.site'), false);
  assert.equal(domains.isValidSourceHtml("anime3rb", '<title>Just a moment</title>anime3rb.com'), false);
  assert.equal(domains.looksLikeCfChallenge('<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>wp-manga'), false);

  // A one-attempt fast path must still reach the configured alternate host.
  requests = [];
  fetcher = async (url) => { if (url.includes("w1.")) throw new Error("DNS unavailable"); return response("anime4up episode-servers"); };
  assert.equal(await direct.fetchHtml("https://w1.anime4up.rest/episode/show", undefined, [100]), "anime4up episode-servers");
  assert.equal(requests.length, 2);
  assert.equal(new URL(requests[1]).hostname, "anime4up.rest");

  // Stalled response bodies abort and leave the fallback host usable.
  requests = [];
  fetcher = async (url, init) => url.includes("w1.") ? stalledBody(url, init) : response("anime4up episode-servers");
  assert.equal(await direct.fetchHtml("https://w1.anime4up.rest/episode/show", undefined, [100]), "anime4up episode-servers");
  assert.equal(requests.length, 2);

  requests = [];
  fetcher = async () => response("missing", 404);
  assert.equal(await direct.fetchHtml("https://w1.anime4up.rest/episode/missing", undefined, [100]), null);
  assert.equal(requests.length, 1, "genuine missing pages must not rotate hosts");
  fetcher = async (url) => response(url.includes("w1.") ? "ISP blocked page" : "anime4up episode-servers");
  assert.equal(await direct.fetchHtml("https://w1.anime4up.rest/episode/show", undefined, [100]), "anime4up episode-servers");

  // Browser discovery must not cancel unrelated manga/home work as playback does.
  fetcher = async () => response('<title>Just a moment</title>witanime.site');
  browser = async (job) => { assert.equal(!!job.priority, true); assert.equal(!!job.allFrames, false); return { html: '<a href="/anime/show">witanime</a>' }; };
  assert.ok(await direct.fetchSourceHtml("https://witanime.site/anime/show", "https://witanime.site/", "/anime/"));
  browser = async () => ({ html: "unrelated content" });
  assert.equal(await direct.fetchSourceHtml("https://witanime.site/anime/show", "https://witanime.site/", "/anime/"), null);

  fetcher = async () => response("<title>Just a moment</title>anime3rb.com");
  assert.equal((await direct.rawGetA3rb("https://anime3rb.com/titles/show")).html, null);
  fetcher = async () => response("video_sources=[1]");
  assert.equal((await direct.rawGetA3rb("https://vid3rb.com/player/1")).html, "video_sources=[1]", "provider pages have no catalog branding");
  fetcher = async (url, init) => stalledBody(url, init);
  await assert.rejects(direct.fetchWitPlayerResponse("https://witanime.site/watch/show/1", {}, 100), /body aborted/);

  let browserCalls = 0;
  const manga = load("lib/manga/fetch.ts", {
    "../scraper/direct": { fetchHtml: async () => null, looksLikeCfChallenge: domains.looksLikeCfChallenge },
    "../scraper/bus": { enqueue: async (job) => { browserCalls++; return browser(job); } },
    "../scraper/scripts": scripts, "../videoProviders": { VIDEO_USER_AGENT: "test-browser" },
  }, { ...shortTimers, fetch: (url, init) => fetcher(url, init) });
  fetcher = async (_url, init) => { assert.equal(init.headers["User-Agent"], "test-browser"); return response("blocked", 403); };
  browser = async (job) => {
    assert.ok(job.injectAfter.includes("var RAW_TEXT = true"));
    assert.equal(!!job.priority, false);
    return { html: '{"items":[{"title":"One Piece"}]}' };
  };
  assert.equal((await manga.fetchMangaJson("https://mangawy.org/api/series/search?q=one")).items[0].title, "One Piece");

  const before = browserCalls;
  fetcher = async () => response("missing", 404);
  assert.equal(await manga.fetchMangaRawText("https://mangawy.org/api/missing"), null);
  assert.equal(browserCalls, before);
  browser = async () => ({ html: "<title>Just a moment</title>wp-manga" });
  assert.equal(await manga.fetchMangaHtml("https://3asq.online/manga/show", undefined, "wp-manga"), null);
  browser = async () => ({ html: "wp-manga chapter/1" });
  const dedupBefore = browserCalls;
  const copies = await Promise.all([manga.fetchMangaHtml("https://mangalik.net/manga/show", undefined, "wp-manga"), manga.fetchMangaHtml("https://mangalik.net/manga/show", undefined, "wp-manga")]);
  assert.equal(copies[0], copies[1]);
  assert.equal(browserCalls - dedupBefore, 1);

  // Run the injected extractor, including the CF wait, on a rendered JSON document.
  function extract(body, challenged = false, marker = "", rawText = true, timeoutMs = 20000, settleAt = 0) {
    let tick, now = 0, message;
    const document = { get readyState() { return now < settleAt ? "loading" : "interactive"; }, title: challenged ? "Just a moment" : "", querySelector: (selector) => selector === "body > pre" ? { textContent: body } : null,
      documentElement: { outerHTML: `<html><body><pre>${body}</pre></body></html>`, textContent: body, innerHTML: body } };
    vm.runInNewContext(scripts.EXTRACT_RENDERED_HTML(marker, rawText, timeoutMs), { document,
      window: { ReactNativeWebView: { postMessage: (text) => { message = JSON.parse(text); } } },
      Date: { now: () => now }, setInterval: (fn) => { tick = fn; return 1; }, clearInterval: () => {},
    });
    for (let i = 0; i < 90 && !message; i++) { now += 350; tick(); }
    return message;
  }
  assert.equal(extract('{"name":"A&B <test>"}').data.html, '{"name":"A&B <test>"}');
  assert.equal(extract("blocked", true).type, "error", "never return an unsolved challenge on timeout");
  assert.equal(extract("wrong page", false, "wp-manga", false).type, "error");
  assert.match(extract("blocked", true).message, /challenge/);
  assert.match(extract("wrong page", false, "og:title").message, /timed out/);
  assert.equal(extract("og:title", false, "og:title", false, 20000, 22000).type, "error");
  assert.equal(extract("og:title", false, "og:title", false, 24000, 22000).type, "result", "verification must use the browser job's available time");

  const rows = [];
  const logger = load("lib/remoteLog.ts", {
    "../version.json": { version: "4.0.0" },
    "react-native": { Platform: { OS: "android", Version: 34 } },
    "expo-device": { manufacturer: "samsung", modelName: "SM-M135FU" },
    "expo-application": { nativeApplicationVersion: "3.4.6" },
    "expo-updates": { updateId: "active-ota", runtimeVersion: "3.4.6", isEmbeddedLaunch: false },
    "./supabase": { isSupabaseConfigured: true, supabase: { from: table => {
      assert.equal(table, "device_logs"); return { insert: row => { rows.push(row); return Promise.resolve(); } };
    } } },
  });
  logger.setLogUser({ id: "reporter", email: "reporter@example.com" });
  logger.remoteLog("warn", "scraper", "anime search completed", { sourceCounts: { witanime: 0, anime3rb: 3 } });
  assert.equal(rows[0].app_version, "3.4.6", "native version remains distinct from active OTA");
  assert.equal(rows[0].user_id, "reporter");
  assert.equal(rows[0].context.updateId, "active-ota");
  assert.equal(rows[0].context.runtimeVersion, "3.4.6");
  assert.equal(rows[0].context.isEmbeddedLaunch, false);
  assert.equal(rows[0].context.sourceCounts.anime3rb, 3);

  // Browser identity, subresource errors and renderer recovery use real slot handlers.
  const stateChanges = [], rejected = [];
  const jsx = (type, props, key) => ({ type, props, key });
  const host = load("lib/scraper/ScraperHost.tsx", {
    react: { useRef: (current) => ({ current }), useEffect: () => {},
      useState: (initial) => { const value = typeof initial === "function" ? initial() : initial; return [value, (next) => stateChanges.push(typeof next === "function" ? next(value) : next)]; } },
    "react/jsx-runtime": { jsx, jsxs: jsx }, "react-native": { View: "View" },
    "./bus": { _reject: (...args) => rejected.push(args) }, "../videoProviders": { VIDEO_USER_AGENT: "test-browser" },
    "expo-application": { applicationId: "com.anime.mobile" }, "expo/fetch": { fetch },
    "./witGate": {}, "../remoteLog": { remoteLog: (...event) => rows.push(event[3]) }, "./sourceDomains": domains,
    "react-native-webview": { WebView: "WebView" },
  });
  const slot = host.ScraperHost().props.children[0].type;
  let done = 0;
  const url = "https://anime3rb.com/titles/show";
  const view = slot({ job: { id: "browser-test", url, urls: [url], injectAfter: "true;", timeoutMs: 1000 }, onDone: () => { done++; } });
  assert.equal(view.props.userAgent, undefined, "Anime3rb verification needs the browser's actual identity");
  view.props.onLoadStart({ nativeEvent: { url } });
  view.props.onHttpError({ nativeEvent: { url, statusCode: 403 } });
  view.props.onHttpError({ nativeEvent: { url: "https://anime3rb.com/missing-ad.js", statusCode: 404 } });
  assert.equal(rejected.length, 0);
  view.props.onRenderProcessGone();
  assert.equal(rejected.length, 1);
  assert.equal(done, 1);
  assert.equal(stateChanges.at(-1), 1, "a killed renderer must create a new browser instance");
  assert.equal(rows.at(-1).lastHttpStatus, 403, "preserve the HTTP challenge when verification later fails");
  assert.equal(rows.at(-1).path, "/titles/show");

  // A dead primary does not delay the reachable secondary source to its timeout.
  const homes = load("lib/homeSourceSelection.ts", { "./fuzzy": { normFuzzy: (s) => s }, "./requestCache": cache });
  const good = { featured: ["secondary"] };
  const never = () => new Promise(() => {});
  assert.equal(await homes.loadWitanimeHome(never, never, [async () => good, async () => { throw Error("blocked"); }]), good);
  const primary = { featured: ["primary"] };
  assert.equal(await homes.loadWitanimeHome(async () => primary, never, [async () => good]), primary);
  assert.equal(await homes.loadWitanimeHome(async () => null, async () => null, [async () => null, async () => null]), null);

  // Empty browse results must not poison the cache after changing networks.
  let attempts = 0;
  const adapter = { browseAll: async () => ++attempts === 1 ? [] : [{ title: "One Piece" }] };
  const api = load("lib/manga/api.ts", {
    "@react-native-async-storage/async-storage": storage, "../requestCache": cache,
    "./sources/asq": { asqSource: adapter }, "./sources/mangawy": { mangawySource: adapter }, "./sources/mangalik": { mangalikSource: adapter },
  });
  assert.equal((await api.browseMangaAll("asq", 1)).length, 0);
  assert.equal((await api.browseMangaAll("asq", 1)).length, 1);
  assert.equal(attempts, 2);

  // Execute the real cold-home orchestration with the existing authenticated cache.
  const source = fs.readFileSync("lib/api.ts", "utf8");
  const ast = ts.createSourceFile("api.ts", source, ts.ScriptTarget.Latest, true);
  const functions = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && ["fetchHome", "homeHasContent"].includes(node.name?.text)).map((node) => node.getText(ast)).join("\n");
  let cloudValue = { success: true, data: { featured: [{ title: "cached" }], sections: [] } };
  let freshHome = never();
  const homeWrites = [];
  const ctx = { exports: {}, ...shortTimers, readCacheEntry: async () => null, HOME_CACHE_KEY: "home", HOME_SERVE_TTL: 1,
    writeCache: async (_key, data) => homeWrites.push(data), readCloudHome: async () => cloudValue, withTimeout: cache.withTimeout, fetchHomeFreshShared: () => freshHome };
  vm.runInNewContext(ts.transpileModule(functions + "\nexports.fetchHome = fetchHome;", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, ctx);
  assert.equal(await ctx.exports.fetchHome(), cloudValue);
  freshHome = Promise.resolve({ success: true, data: { featured: [], sections: [] } });
  assert.equal(await ctx.exports.fetchHome(), cloudValue, "an empty live result must not beat the shared fallback");
  let finishLive, pushed;
  freshHome = new Promise((resolve) => { finishLive = resolve; });
  assert.equal(await ctx.exports.fetchHome((updated) => { pushed = updated; }), cloudValue);
  const lateLive = { success: true, data: { featured: [{ title: "live" }], sections: [] } };
  finishLive(lateLive);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(pushed, lateLive, "the shared feed upgrades when live content recovers");
  cloudValue = { bad: "payload" };
  freshHome = Promise.resolve({ success: true, data: { featured: [], sections: [] } });
  assert.equal(await ctx.exports.fetchHome(), await freshHome);
  let finishCloud;
  ctx.readCloudHome = () => new Promise(resolve => { finishCloud = resolve; });
  freshHome = Promise.resolve(lateLive);
  homeWrites.length = 0;
  assert.equal(await ctx.exports.fetchHome(), lateLive);
  finishCloud({ success: true, data: { featured: [{ title: "older shared feed" }], sections: [] } });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(homeWrites.length, 0, "a late shared response cannot overwrite the winning live cache");
  console.log("source network checks passed (anime + manga, timeouts, mirrors, browser verification, recovery, home/cloud fallbacks)");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

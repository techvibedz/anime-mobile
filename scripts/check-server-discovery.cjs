// Run the actual orchestration functions with deterministic source responses.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function loadPure(file, modules = {}, globals = {}) {
  const ctx = vm.createContext({ exports: {}, URL, AbortController, setTimeout, clearTimeout,
    require: (name) => { assert.ok(name in modules, 'unexpected import: ' + name); return modules[name]; }, ...globals });
  vm.runInContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, ctx);
  return ctx.exports;
}
const cache = loadPure(path.join(root, 'lib/requestCache.ts'));
async function check(project, desktop, primarySource, missingWit = false, witCache = new Map(), noTitle = false, lateUp4 = false) {
  const lib = path.join(project, desktop ? 'src/lib' : 'lib');
  const text = fs.readFileSync(path.join(lib, 'api.ts'), 'utf8');
  const ast = ts.createSourceFile('api.ts', text, ts.ScriptTarget.Latest, true);
  const functions = ast.statements.filter((node) => ts.isFunctionDeclaration(node) &&
    ['fetchCompleteVideoServers', 'completePayload', 'titleFromSlug'].includes(node.name?.text)).map((node) => node.getText(ast)).join('\n');
  const providers = loadPure(path.join(lib, 'videoProviders.ts'));
  const href = (source) => source === 'anime3rb' ? 'https://anime3rb.com/episode/show/7'
    : source === 'anime4up' ? 'https://anime4up.example/episode/show-الحلقة-7/' : 'https://witanime.site/watch/show/7';
  const server = (source) => ({ id: source, name: source, provider: 'mp4upload', iframeUrl: `https://www.mp4upload.com/embed-${source}.html`, source });
  const payload = (source) => ({ success: true, data: { servers: [server(source)], episodeTitle: '7', animeTitle: 'Show', animeHref: '', navigation: { prev: null, next: null } } });
  const events = [];
  let clock = 0;
  const resolve = async (server) => {
    events.push(`resolve:${server.source}`);
    return `https://cdn.mp4upload.com/${server.source}.mp4`;
  };
  const context = vm.createContext({
    exports: {}, URL, Date: lateUp4 ? { now: () => clock } : Date, Promise, setTimeout, clearTimeout, console, ...providers, ...cache,
    completeVideoServerRequests: cache.createRequestCache(0),
    // The cross-source Witanime lookup remembers the anime page a title search
    // resolved to (the site rate-limits /search with HTTP 429), so the
    // orchestration needs the same cache hooks the app's storage provides.
    WIT_ANIME_CACHE_PREFIX: '@wit_anime_v1:',
    UP4_CACHE_TTL: 24 * 60 * 60 * 1000,
    readCache: async (key) => (witCache.has(key) ? witCache.get(key) : null),
    writeCache: async (key, data) => { witCache.set(key, data); events.push('cache:witanime'); },
    getWitBase: async () => 'https://witanime.site', rewriteWitUrl: (url) => url,
    resolveWitanimeEpisode: async (title, number, animeHref, _search, _aliases, _season, _read, onResolved) => {
      assert.equal(title.toLowerCase(), 'show'); assert.equal(number, 7);
      events.push(animeHref ? 'lookup:witanime:known' : 'lookup:witanime:search');
      if (missingWit) return null;
      if (!animeHref) onResolved?.('https://witanime.site/anime/show');
      return href('witanime');
    },
    searchWitanimeDirect: async () => [], searchWitanimeDirectList: async () => [],
    getAltTitles: async () => [], tm_seasonNum: () => 1, fetchHtml: async () => '',
    fetchSourceHtml: async () => '',
    window: { pantoufa: { fetchHtml: async () => '' } },
    fetchVideoServers: async (url) => {
      const source = url.includes('anime4up') ? 'anime4up' : 'witanime';
      events.push(`fetch:${source}`);
      if (source === primarySource) await new Promise((r) => setTimeout(r, 20));
      if (lateUp4 && source === primarySource) clock = Number(text.match(/discoveryDeadline = Date.now\(\) \+ ([\d_]+)/)[1].replaceAll('_', '')) + 1;
      if (lateUp4 && source === 'anime4up') await new Promise((r) => setTimeout(r, 40));
      return payload(source);
    },
    scrapeAnime4upEpisodePageDirect: async () => ({ ...payload('anime4up').data }),
    resolveUp4EpisodeUrl: async () => href('anime4up'),
    fetchAnime3rbServersByUrl: async () => [server('anime3rb')],
    fetchAnime3rbServers: async (title) => { events.push('a3rb-title:' + title); return [server('anime3rb')]; },
    resolveDirectServerList: async (servers, _timeout, _fresh, callback) => {
      if (lateUp4) await new Promise((r) => setTimeout(r, 50));
      const ready = await Promise.all(servers.map(async (s) => ({ ...s, videoUrl: await resolve(s) })));
      callback?.(ready); return ready;
    },
    resolveVideo: async (url) => {
      const source = url.match(/embed-(.+)\.html/)[1];
      return { success: true, data: { videoUrl: await resolve(server(source)), type: 'mp4' } };
    },
  });
  vm.runInContext(ts.transpileModule(functions, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText + '\nglobalThis.run = fetchCompleteVideoServers;', context);
  const partial = [];
  const result = await context.run({ episodeUrl: href(primarySource), animeTitle: noTitle ? undefined : 'Show', episodeNumber: 7,
    url4up: lateUp4 ? href('anime4up') : undefined,
    onCandidates: (p) => { partial.push(...p.data.servers.map((s) => s.source)); events.push('candidates'); },
    onPartial: () => events.push('playable'),
  });
  const expected = missingWit ? ['anime3rb', 'anime4up'] : ['anime3rb', 'anime4up', 'witanime'];
  assert.deepEqual([...new Set(result.data.servers.map((s) => s.source))].sort(), expected);
  if (lateUp4) await new Promise((r) => setTimeout(r, 60));
  for (const source of expected) assert.ok(partial.includes(source), `${source} should appear progressively`);
  if (noTitle) {
    // Entry points without a title param (notification taps, deep links) must
    // still discover the other sources off the URL slug, or a dead primary
    // leaves the user with zero servers. Witanime primaries prove it via the
    // Anime3rb title lookup; anime3rb primaries (whose own URL identifies the
    // episode) prove it via the Witanime title search.
    assert.ok(events.includes('a3rb-title:show') || events.some((e) => e.startsWith('lookup:witanime')),
      'slug-derived title must drive cross-source discovery: ' + events.join(' | '));
  } else if (primarySource !== 'witanime') assert.ok(events.some((e) => e.startsWith('lookup:witanime')));
  assert.ok(events.indexOf('resolve:anime4up') >= 0, 'MP4Upload must be warmed');
  // Only a cross-source primary needs the lookup; when Witanime IS the primary
  // its own episode page already carries the servers.
  if (!missingWit && primarySource !== 'witanime') assert.equal(witCache.get('@wit_anime_v1:show'),
    'https://witanime.site/anime/show',
    'the resolved Witanime anime page must be remembered for the next episode');
  console.log(`${desktop ? 'Desktop' : 'Mobile'} from ${primarySource}${missingWit ? ' (Wit unavailable)' : ''}: source merge and progressive resolution passed`);
}
(async () => {
  const storage = { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} };
  const domains = loadPure(path.join(root, 'lib/scraper/sourceDomains.ts'), { '@react-native-async-storage/async-storage': storage });
  const providers = loadPure(path.join(root, 'lib/videoProviders.ts'));
  const jobs = [];
  const witHtml = '<a href="/anime/show"><img src="show.jpg"><h3>Show</h3></a>';
  const up4Html = '<div class="anime-card-title"><h3><a href="/anime/show">Show</a></h3></div><a href="/episode/انمي-show-الحلقة-7-مترجمة/" title="الحلقة 7">7</a><ul id="episode-servers"><li data-watch="https://www.mp4upload.com/embed-show.html"><a>Mp4upload</a></li></ul>';
  let blocked = true;
  const direct = loadPure(path.join(root, 'lib/scraper/direct.ts'), {
    '@react-native-async-storage/async-storage': storage,
    './bus': { enqueue: async (job) => { jobs.push(job); return { html: job.url.includes('witanime') ? witHtml : up4Html }; } },
    './scripts': { EXTRACT_RENDERED_HTML: (marker) => marker },
    '../fuzzy': loadPure(path.join(root, 'lib/fuzzy.ts')),
    '../remoteLog': { remoteLog: () => {} }, '../videoProviders': providers, './sourceDomains': domains,
  }, { fetch: async () => ({ ok: !blocked, status: blocked ? 403 : 200, headers: { get: () => null }, text: async () => up4Html }) });
  assert.equal((await direct.searchWitanimeDirect('Show'))[0]?.title, 'Show');
  assert.equal(await direct.searchAnime4upDirect('Show'), 'https://w1.anime4up.rest/anime/show');
  assert.ok((await direct.findUp4EpisodeAcrossPages('https://w1.anime4up.rest/anime/show', 7)).includes('/episode/'));
  assert.equal(direct.parseUp4Servers(await direct.fetchSourceHtml('https://w1.anime4up.rest/episode/show', 'https://w1.anime4up.rest/', 'data-watch'))[0]?.provider, 'mp4upload');
  assert.equal(await direct.fetchSourceHtml('https://witanime.site/anime/show', 'https://witanime.site/', '/watch/'), witHtml);
  assert.ok(jobs.length >= 5 && jobs.every((job) => job.priority), 'blocked lookup pages must use the reserved browser slot');
  blocked = false;
  const count = jobs.length;
  assert.equal(await direct.fetchSourceHtml('https://w1.anime4up.rest/anime/show', 'https://w1.anime4up.rest/', '/episode/'), up4Html);
  assert.equal(jobs.length, count, 'healthy native requests must avoid browser work');
  console.log('Blocked WitAnime/Anime4up search, episode lookup and server extraction recover through WebView');

  const scripts = loadPure(path.join(root, 'lib/scraper/scripts.ts'), { '../videoProviders': providers });
  const requests = [];
  const result = await new Promise((resolve, reject) => {
    const rootNode = { getAttribute: () => "watchPlayer({ sourcesUrl: '/watch/show/7/sources' })" };
    const context = vm.createContext({
      window: { Alpine: { $data: () => ({ sourcesLoaded: true, sourcesError: false, players: { FHD: [
        { label: 'videa', token: 'a'.repeat(64) }, { label: 'hgcloud', token: 'b'.repeat(64) },
      ] } }) }, ReactNativeWebView: { postMessage: (value) => { const m = JSON.parse(value); if(m.type === 'wit-gate') { context.window.__witGateReplies[m.token]=m.token.startsWith('b') ? 'https://hgcloud.to/e/live' : null; return; } m.type === 'error' ? reject(Error(m.message)) : resolve(m.data); } } },
      document: { readyState: 'interactive', title: 'Show',
        querySelector: (selector) => selector.includes('watchPlayer') ? rootNode : selector.includes('csrf-token') ? { getAttribute: () => 'csrf' } : null,
        querySelectorAll: () => [], },
      location: { origin: 'https://witanime.site', pathname: '/watch/show/7' },
      navigator: { userAgent:'Chrome/157.0',language:'en-US' },
      fetch: async (url) => { requests.push(url); assert.ok(url.includes('/stream-source/'), 'reuse the site manifest instead of replacing its tokens'); return { ok: true, json:async()=>({sandbox:false}) }; },
      setTimeout: (fn) => setTimeout(fn, 1), setInterval: (fn) => setInterval(fn, 1), clearInterval,
    });
    vm.runInContext(scripts.EXTRACT_VIDEO_SERVERS, context);
  });
  assert.equal(result.servers.length, 2);
  assert.equal(requests.length, 2);
  assert.ok(result.servers.some(server=>server.provider==='generic' && server.iframeUrl.includes('/stream-gate/')));
  assert.ok(result.servers.some(server=>server.provider==='streamwish' && server.iframeUrl==='https://hgcloud.to/e/live' && server.sandbox===false));
  console.log('WitAnime browser extraction reuses the live session manifest and exposes its servers');

  const up4Result = await new Promise((resolve, reject) => {
    const tab = { getAttribute: () => 'https://mp4upload.com/embed-real.html', querySelector: () => null };
    const context = vm.createContext({
      URL, location: { origin: 'https://w1.anime4up.rest', pathname: '/episode/show-7/' },
      window: { ReactNativeWebView: { postMessage: value => { const msg = JSON.parse(value); msg.type === 'result' ? resolve(msg.data) : reject(Error(msg.message)); } } },
      document: { title: 'Show', readyState: 'interactive',
        querySelector: selector => selector.includes('#episode-servers') ? tab : null,
        querySelectorAll: selector => selector.includes('li[data-watch]') ? [tab] : selector === 'iframe' ? [{ src: 'https://ads.example/banner' }] : [],
      },
      setTimeout: fn => setTimeout(fn, 1), setInterval: fn => setInterval(fn, 1), clearInterval,
    });
    vm.runInContext(scripts.EXTRACT_VIDEO_SERVERS, context);
  });
  assert.equal(up4Result.servers.length, 1);
  assert.equal(up4Result.servers[0].provider, 'mp4upload');
  console.log('Anime4up server tabs exclude page advertising iframes');

  const watch = ts.createSourceFile('watch.tsx', fs.readFileSync(path.join(root, 'app/watch/[episode].tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let tapGuard;
  function findTapGuard(node) {
    if (ts.isJsxSelfClosingElement(node) && node.attributes.getText(watch).includes('onPress={tapToToggle}')) {
      tapGuard = node.parent.parent.left.getText(watch);
    }
    ts.forEachChild(node, findTapGuard);
  }
  findTapGuard(watch);
  const catchesTap = (isWebView, controlsVisible) => vm.runInNewContext(tapGuard, {
    isPlaying: false, isWebView, controlsVisible, pickerOpen: false, episodesOpen: false, companionOpen: false,
  });
  assert.equal(catchesTap(true, true), false, 'visible embed controls must receive the play tap');
  assert.equal(catchesTap(true, false), true, 'a hidden toolbar can still be revealed');
  let apply;
  function findApply(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(watch) === 'applyPayload') apply = node.getText(watch);
    ts.forEachChild(node, findApply);
  }
  findApply(watch);
  let states = [];
  const picker = vm.createContext({
    sortVideoServers: loadPure(path.join(root, 'lib/videoProviders.ts')).sortVideoServers,
    setServers: (update) => { states = update(states); },
    setActiveIdx: () => {}, setTitle: () => {}, setAnimeTitle: () => {}, setAnimeHref: () => {},
    setNextEpisodeHref: () => {}, setPrevEpisodeHref: () => {}, resolvedAnime: '', nextEpParam: '', prevEpParam: '',
  });
  vm.runInContext(ts.transpileModule('const ' + apply + '; globalThis.apply = applyPayload;', {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, picker);
  const row = (provider) => ({ id: provider, name: provider, provider, iframeUrl: `https://example.com/${provider}` });
  const show = (servers) => picker.apply({ data: { servers } }, true, true);
  show([row('mp4upload')]);
  states[0].status = 'resolving';
  show([row('vid3rb')]);
  assert.equal(states[0].server.provider, 'mp4upload', 'late recommended servers must not change the selected index');
  assert.equal(states[0].status, 'resolving', 'progressive discovery must preserve playback state');
  show([row('vid3rb')]);
  assert.equal(states.length, 2, 'an incomplete final payload must not remove already discovered servers');
  console.log('Picker preserves discovered servers, playback state and selected indices');
  let pick;
  function findPick(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(watch) === 'pickServer') pick = node.getText(watch);
    ts.forEachChild(node, findPick);
  }
  findPick(watch);
  const guard = providers.createGenerationGuard();
  const discovery = guard.next();
  let selected = -1;
  let picked = false;
  const selection = vm.createContext({
    useCallback: (fn) => fn, loadGenerationRef: { current: guard },
    _cancelBackground: () => {}, selectServer: (idx) => { selected = idx; },
    setPicked: (value) => { picked = value; }, setNoServersFinal: () => {},
  });
  vm.runInContext(ts.transpileModule('const ' + pick + '; pickServer(0);', {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, selection);
  assert.equal(selected, 0);
  assert.equal(picked, true);
  assert.ok(guard.isCurrent(discovery), 'selecting an early server must keep late source callbacks alive');
  console.log('Selecting Anime3rb preserves the ongoing discovery generation');

  const apiAst = ts.createSourceFile('api.ts', fs.readFileSync(path.join(root, 'lib/api.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
  const fetchServers = apiAst.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'fetchVideoServers').getText(apiAst);
  const stale = { data: { servers: [{ iframeUrl: 'https://witanime.site/watch/stream-gate/' + 'a'.repeat(64) }] } };
  let freshLoads = 0;
  let persisted = 0;
  const caching = vm.createContext({
    exports: {}, SERVERS_CACHE_PREFIX: 'servers:', SERVERS_CACHE_TTL: 21_600_000,
    serverRequests: cache.createRequestCache(21_600_000),
    readCache: async () => stale, writeCache: () => { persisted++; },
    fetchVideoServersFresh: async () => { freshLoads++; return stale; },
  });
  vm.runInContext(ts.transpileModule(fetchServers, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, caching);
  await caching.exports.fetchVideoServers('https://witanime.site/watch/show/7');
  await caching.exports.fetchVideoServers('https://witanime.site/watch/show/7');
  assert.equal(freshLoads, 2, 'session gates must be refreshed on each new watch visit');
  assert.equal(persisted, 0, 'session gates must not be stored as six-hour embeds');
  console.log('WitAnime session gates bypass both server-list caches');
  for (const primary of ['witanime', 'anime4up', 'anime3rb']) await check(root, false, primary);
  await check(root, false, 'anime4up', true);
  await check(root, false, 'witanime', false, new Map(), false, true);
  console.log('Source finishing after the discovery cutoff remains in the final list');
  // No title param (notification tap / deep link): the URL slug must still
  // drive cross-source discovery, otherwise a dead primary leaves no servers.
  await check(root, false, 'witanime', false, new Map(), true);
  await check(root, false, 'anime3rb', false, new Map(), true);
  console.log('Slug-derived title still discovers every source when no title param is passed');
  // Second episode of the same anime: the remembered anime page must be reused,
  // so the rate-limited /search is never touched again.
  const witCache = new Map();
  await check(root, false, 'anime4up', false, witCache);
  await check(root, false, 'anime3rb', false, witCache);
  assert.equal(witCache.get('@wit_anime_v1:show'), 'https://witanime.site/anime/show');
  console.log('Witanime anime-page cache reused for the next episode passed');
  if (process.argv[2]) {
    for (const primary of ['witanime', 'anime4up', 'anime3rb']) await check(path.resolve(process.argv[2]), true, primary);
    await check(path.resolve(process.argv[2]), true, 'anime4up', true);
    for (const shared of ['witanimeMatch.ts', 'authErrors.ts']) {
      assert.equal(fs.readFileSync(path.join(root, 'lib', shared), 'utf8'),
        fs.readFileSync(path.join(process.argv[2], 'src/lib', shared), 'utf8'), shared + ' must match');
    }
    console.log('Mobile/desktop Witanime matcher + auth error map are identical');
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });

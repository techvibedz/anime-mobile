// Run the actual orchestration functions with deterministic source responses.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function loadPure(file) {
  const ctx = vm.createContext({ exports: {}, URL, setTimeout, clearTimeout });
  vm.runInContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, ctx);
  return ctx.exports;
}
const cache = loadPure(path.join(root, 'lib/requestCache.ts'));
async function check(project, desktop, primarySource, missingWit = false, witCache = new Map()) {
  const lib = path.join(project, desktop ? 'src/lib' : 'lib');
  const text = fs.readFileSync(path.join(lib, 'api.ts'), 'utf8');
  const ast = ts.createSourceFile('api.ts', text, ts.ScriptTarget.Latest, true);
  const functions = ast.statements.filter((node) => ts.isFunctionDeclaration(node) &&
    ['fetchCompleteVideoServers', 'completePayload'].includes(node.name?.text)).map((node) => node.getText(ast)).join('\n');
  const providers = loadPure(path.join(lib, 'videoProviders.ts'));
  const href = (source) => source === 'anime3rb' ? 'https://anime3rb.com/episode/show/7'
    : source === 'anime4up' ? 'https://anime4up.example/episode/show-الحلقة-7/' : 'https://witanime.site/watch/show/7';
  const server = (source) => ({ id: source, name: source, provider: 'mp4upload', iframeUrl: `https://www.mp4upload.com/embed-${source}.html`, source });
  const payload = (source) => ({ success: true, data: { servers: [server(source)], episodeTitle: '7', animeTitle: 'Show', animeHref: '', navigation: { prev: null, next: null } } });
  const events = [];
  const resolve = async (server) => {
    events.push(`resolve:${server.source}`);
    return `https://cdn.mp4upload.com/${server.source}.mp4`;
  };
  const context = vm.createContext({
    exports: {}, URL, Date, Promise, setTimeout, clearTimeout, console, ...providers, ...cache,
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
      assert.equal(title, 'Show'); assert.equal(number, 7);
      events.push(animeHref ? 'lookup:witanime:known' : 'lookup:witanime:search');
      if (missingWit) return null;
      if (!animeHref) onResolved?.('https://witanime.site/anime/show');
      return href('witanime');
    },
    searchWitanimeDirect: async () => [], searchWitanimeDirectList: async () => [],
    getAltTitles: async () => [], tm_seasonNum: () => 1, fetchHtml: async () => '',
    window: { pantoufa: { fetchHtml: async () => '' } },
    fetchVideoServers: async (url) => {
      const source = url.includes('anime4up') ? 'anime4up' : 'witanime';
      events.push(`fetch:${source}`);
      if (source === primarySource) await new Promise((r) => setTimeout(r, 20));
      return payload(source);
    },
    scrapeAnime4upEpisodePageDirect: async () => ({ ...payload('anime4up').data }),
    resolveUp4EpisodeUrl: async () => href('anime4up'),
    fetchAnime3rbServersByUrl: async () => [server('anime3rb')],
    fetchAnime3rbServers: async () => [server('anime3rb')],
    resolveDirectServerList: async (servers, _timeout, _fresh, callback) => {
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
  const result = await context.run({ episodeUrl: href(primarySource), animeTitle: 'Show', episodeNumber: 7,
    onCandidates: (p) => { partial.push(...p.data.servers.map((s) => s.source)); events.push('candidates'); },
    onPartial: () => events.push('playable'),
  });
  const expected = missingWit ? ['anime3rb', 'anime4up'] : ['anime3rb', 'anime4up', 'witanime'];
  assert.deepEqual([...new Set(result.data.servers.map((s) => s.source))].sort(), expected);
  for (const source of expected) assert.ok(partial.includes(source), `${source} should appear progressively`);
  if (primarySource !== 'witanime') assert.ok(events.some((e) => e.startsWith('lookup:witanime')));
  assert.ok(events.indexOf('resolve:anime4up') >= 0, 'MP4Upload must be warmed');
  // Only a cross-source primary needs the lookup; when Witanime IS the primary
  // its own episode page already carries the servers.
  if (!missingWit && primarySource !== 'witanime') assert.equal(witCache.get('@wit_anime_v1:show'),
    'https://witanime.site/anime/show',
    'the resolved Witanime anime page must be remembered for the next episode');
  console.log(`${desktop ? 'Desktop' : 'Mobile'} from ${primarySource}${missingWit ? ' (Wit unavailable)' : ''}: source merge and progressive resolution passed`);
}
(async () => {
  for (const primary of ['witanime', 'anime4up', 'anime3rb']) await check(root, false, primary);
  await check(root, false, 'anime4up', true);
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

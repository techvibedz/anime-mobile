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
async function check(project, desktop, primarySource, missingWit = false) {
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
    getWitBase: async () => 'https://witanime.site', rewriteWitUrl: (url) => url,
    resolveWitanimeEpisode: async (title, number) => {
      assert.equal(title, 'Show'); assert.equal(number, 7);
      events.push('lookup:witanime'); return missingWit ? null : href('witanime');
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
  if (primarySource !== 'witanime') assert.ok(events.includes('lookup:witanime'));
  assert.ok(events.indexOf('resolve:anime4up') >= 0, 'MP4Upload must be warmed');
  console.log(`${desktop ? 'Desktop' : 'Mobile'} from ${primarySource}${missingWit ? ' (Wit unavailable)' : ''}: source merge and progressive resolution passed`);
}
(async () => {
  for (const primary of ['witanime', 'anime4up', 'anime3rb']) await check(root, false, primary);
  await check(root, false, 'anime4up', true);
  if (process.argv[2]) {
    for (const primary of ['witanime', 'anime4up', 'anime3rb']) await check(path.resolve(process.argv[2]), true, primary);
    await check(path.resolve(process.argv[2]), true, 'anime4up', true);
    assert.equal(fs.readFileSync(path.join(root, 'lib/witanimeMatch.ts'), 'utf8'), fs.readFileSync(path.join(process.argv[2], 'src/lib/witanimeMatch.ts'), 'utf8'));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });

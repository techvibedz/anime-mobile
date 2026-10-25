// Exercise the shipped search, parsers and screen callbacks; --live checks public sources.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');
const baseline = process.argv.includes('--baseline');
const live = process.argv.includes('--live');
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function load(file, imports = {}, globals = {}) {
  const ctx = { exports: {}, URL, AbortController, setTimeout, clearTimeout, ...globals,
    require(name) { assert.ok(name in imports, `unexpected import ${name}`); return imports[name]; } };
  vm.runInNewContext(compile(fs.readFileSync(file, 'utf8')), ctx);
  return ctx.exports;
}
const storage = { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} };
const fuzzy = load('lib/fuzzy.ts');
const domains = load('lib/scraper/sourceDomains.ts', { '@react-native-async-storage/async-storage': storage });
const cache = load('lib/requestCache.ts');
const providers = load('lib/videoProviders.ts');
const raw = (source, part, title = `JoJo Part ${part}`) => ({ title,
  href: `https://${source === 'witanime' ? 'witanime.site/anime' : source === 'anime4up' ? 'w1.anime4up.rest/anime' : 'anime3rb.com/titles'}/jojo-${part}`,
  image: null, type: null, status: null });
const wait = (ms, value) => new Promise(resolve => setTimeout(() => resolve(value), ms));
const plain = (value) => JSON.parse(JSON.stringify(value));
function api(overrides = {}, cached = null) {
  const source = baseline ? execFileSync('git', ['show', 'HEAD:lib/api.ts'], { encoding: 'utf8' }) : fs.readFileSync('lib/api.ts', 'utf8');
  const ast = ts.createSourceFile('api.ts', source, ts.ScriptTarget.Latest, true);
  const names = ['norm', 'imgOrEmpty', 'toSearchResult', 'searchAnimeFresh', 'searchAnime'];
  const functions = ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text)).map(n => n.getText(ast)).join('\n');
  const written = [];
  const logs = [];
  const ctx = { exports: {}, ...fuzzy, ...domains, ...cache,
    // Scale the actual source budgets so failures stay deterministic and fast.
    withTimeout: (promise, ms, fallback) => cache.withTimeout(promise, live ? ms : ms / 100, fallback),
    searchRequests: cache.createRequestCache(0), SEARCH_CACHE_PREFIX: '@search_v4:', SEARCH_CACHE_TTL: 1,
    _swrInFlight: new Set(), readCache: async () => cached, writeCache: async (_key, value) => written.push(value),
    searchWitanimeDirectList: async () => ({ results: [] }), searchAnime4upDirectList: async () => [],
    searchAnime3rbDirectList: async () => [], getAltTitles: async () => [], getAniListAltTitles: async () => [],
    remoteLog: (...event) => logs.push(event),
    // Previous orchestration uses these; they establish the report's old failure.
    searchAnime3rbCatalogFuzzy: async () => [], searchAnime3rbCatalog: async () => 'https://anime3rb.com/titles/jojo-1',
    searchAnime3rbDirect: async () => null, scrapeAnime3rbTitlePage: async () => ({ title: 'JoJo Part 1', poster: null }),
    scrapeSearch: async () => ({ results: [raw('witanime', 2)] }), scrapeSearchUp4: async () => ({ results: [raw('anime4up', 6)] }),
    ...overrides };
  vm.runInNewContext(compile(functions) + '\nexports.searchAnime = searchAnime;', ctx);
  return { search: ctx.exports.searchAnime, written, logs };
}
function direct(fetcher, browser) {
  return load('lib/scraper/direct.ts', {
    '@react-native-async-storage/async-storage': storage, './bus': { enqueue: browser },
    './scripts': { EXTRACT_RENDERED_HTML: marker => marker }, '../fuzzy': fuzzy, './a3rbCatalogSeed': { A3RB_CATALOG_SEED: '' }, '../remoteLog': { remoteLog() {} },
    '../videoProviders': { ...providers, VIDEO_USER_AGENT: 'Mozilla/5.0' }, './sourceDomains': domains,
  }, { fetch: fetcher, ...(live ? {} : { setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 5)) }) });
}
function response(html, status = 200) { return { ok: status === 200, status, headers: { get: () => null }, text: async () => html }; }
function titlePage(slug) { return `<meta property="og:title" content="JoJo ${slug} - Anime3rb"><meta property="og:image" content="https://example.com/poster.jpg"><a href="/episode/${slug}/1">1</a>`; }
function up4Page() { return '<meta property="og:title" content="Anime4up"><div class="anime-card-container"><div class="anime-card-title"><h3><a href="/anime/jojo-part-6/">JoJo Part 6</a></h3></div></div>'; }
async function checks() {
  const partials = [];
  const first = api({
    searchWitanimeDirectList: () => wait(80, { results: [raw('witanime', 2)] }),
    searchAnime4upDirectList: () => wait(100, [raw('anime4up', 6)]),
    searchAnime3rbDirectList: async (_q, onResult) => { const card = raw('anime3rb', 1); onResult(card); return [card]; },
  });
  const all = await first.search('jojo', rows => partials.push(rows.map(row => domains.identifySource(row.href))));
  assert.deepEqual(plain(all.data.results.map(row => domains.identifySource(row.href)).sort()), ['anime3rb', 'anime4up', 'witanime'], 'slow sources must survive another source answering first');
  assert.ok(partials[0].includes('anime3rb') && !partials[0].includes('anime4up'), 'first source streams immediately');

  const duplicates = api({ searchWitanimeDirectList: async () => ({ results: [raw('witanime', 1, 'JoJo')] }),
    searchAnime4upDirectList: async () => [raw('anime4up', 1, 'JoJo'), raw('anime4up', 1, 'JoJo'), raw('anime4up', 6)] });
  assert.equal((await duplicates.search('JoJo')).data.results.length, 2, 'one card per anime across sources; repeated URLs collapse too');
  const tld = api({ searchWitanimeDirectList: async () => ({ results: [{ ...raw('witanime', 1, 'JoJo'), href: 'https://witanime.you/anime/jojo-1' }] }) },
    { success: true, data: { query: 'JoJo', results: [raw('witanime', 1, 'JoJo')], totalResults: 1 } });
  assert.equal((await tld.search('JoJo')).data.results.length, 1, 'rotated witanime TLD is the same anime');
  const parts = api({ searchAnime4upDirectList: async () => [raw('anime4up', 1, 'JoJo'), raw('anime4up', 2, 'JoJo')] });
  assert.equal((await parts.search('JoJo')).data.results.length, 2, 'same-named batches on one source stay distinct');
  const words = [];
  const staged = api({ searchWitanimeDirectList: async q => { words.push(q); return { results: [raw('witanime', 1, 'Naruto Shippuden')] }; } });
  await staged.search('Naruto Shippuden');
  assert.ok(!words.includes('naruto'), 'single-word fallbacks wait for a full-text miss');
  const completeCache = { success: true, data: { query: 'jojo', results: [raw('anime3rb', 1)], totalResults: 1, incompleteSources: [] } };
  let refetched = 0;
  const hot = api({ searchAnime4upDirectList: async () => { refetched++; return []; } }, completeCache);
  assert.equal((await hot.search('jojo')).data.results.length, 1);
  assert.equal(refetched, 0, 'a complete cached search answers without re-scraping');

  const oldCache = { success: true, data: { query: 'jojo', results: [raw('anime3rb', 1)], totalResults: 1 } };
  const cached = api({ searchAnime4upDirectList: async () => [raw('anime4up', 6)] }, oldCache);
  const updates = [];
  const repaired = await cached.search('jojo', rows => updates.push(rows.length));
  assert.deepEqual(updates, [1, 2], 'a cached partial refreshes the current screen');
  assert.equal(repaired.data.results.length, 2);
  assert.equal(cached.written[0].data.results.length, 2);

  const never = () => new Promise(() => {});
  const outage = api({ searchWitanimeDirectList: never, searchAnime4upDirectList: async () => { throw Error('blocked'); } }, oldCache);
  const limited = await outage.search('jojo');
  assert.equal(limited.data.results.length, 1, 'outages preserve previously found parts');
  assert.deepEqual(plain(limited.data.incompleteSources.sort()), ['anime4up', 'witanime']);
  assert.equal(outage.logs[0][0], 'warn');
  assert.equal(outage.logs[0][2], 'anime search incomplete');
  assert.deepEqual(plain(outage.logs[0][3].sourceCounts), { witanime: 0, anime4up: 0, anime3rb: 1 });
  assert.deepEqual(plain(outage.logs[0][3].incompleteSources.sort()), ['anime4up', 'witanime']);
  assert.equal(first.logs[0][0], 'info');
  assert.equal(first.logs[0][3].query, 'jojo');
  const empty = api();
  assert.equal((await empty.search('')).data.results.length, 0);
  assert.equal((await empty.search('absent')).data.results.length, 0);
  assert.equal(empty.written.length, 0, 'empty failures do not poison search cache');

  let calls = 0;
  const shared = api({ searchAnime4upDirectList: async () => { calls++; return wait(15, [raw('anime4up', 6)]); } });
  await Promise.all([shared.search('jojo'), shared.search('jojo')]);
  assert.equal(calls, 1, 'concurrent same-query callers share recovery');

  let lateResult;
  const latePartials = [];
  const late = api({ searchAnime3rbDirectList: (_q, onResult) => { lateResult = onResult; return new Promise(() => {}); } });
  await late.search('jojo', rows => latePartials.push(rows));
  lateResult(raw('anime3rb', 6));
  assert.equal(latePartials.length, 0, 'a timed-out source cannot change the completed search');

  let browsers = 0;
  const recovered = direct(async () => response('Just a moment Anime4up', 403), async job => {
    browsers++; assert.equal(job.priority, true); return { html: up4Page() };
  });
  assert.equal((await recovered.searchAnime4upDirectList('jojo'))[0].title, 'JoJo Part 6');
  assert.equal(browsers, 1, 'Anime4up search independently uses browser verification');

  const slugs = [...Array.from({ length: 12 }, (_, n) => `jojo-part-${n + 1}`), 'heat-guy-j'];
  let concurrent = 0, maxConcurrent = 0;
  const family = direct(async url => {
    if (url.endsWith('.xml')) return response(slugs.map(slug => `<loc>https://anime3rb.com/titles/${slug}</loc>`).join(''));
    concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent);
    await wait(1); concurrent--;
    return response(titlePage(url.split('/').pop()));
  }, async () => null);
  const familyRows = [];
  const familyResult = await family.searchAnime3rbDirectList('jojo', card => familyRows.push(card));
  assert.equal(familyResult.length, 12, 'Anime3rb must expose all JoJo parts, not one title or top five');
  assert.equal(familyRows.length, 12);
  assert.ok(maxConcurrent <= 3, 'catalog hydration must not stampede the source');
  assert.equal((await family.searchAnime3rbDirectList("JoJo's bizarre adventure")).length, 12, 'word queries recover franchise entries despite a different title language');

  // Run the actual screen callbacks: editing/clearing must invalidate older results.
  const screen = fs.readFileSync('app/(tabs)/search.tsx', 'utf8');
  const ast = ts.createSourceFile('search.tsx', screen, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'SearchScreen');
  const callbacks = component.body.statements.filter(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => ['doSearch', 'onChangeText', 'handleClear', 'handleGenre'].includes(d.name.getText(ast)))).map(n => n.getText(ast)).join('\n');
  let finish;
  const states = [];
  const timers = new Map();
  const ctx = { exports: {}, useCallback: fn => fn, reqSeq: { current: 0 }, modeRef: { current: 'browse' }, debounceRef: { current: null }, inputRef: { current: null },
    setItems: rows => states.push(rows), setLoading() {}, setSearching() {}, setStale() {}, setHasMore() {}, setIncompleteSearch() {}, setQuery() {}, setActiveGenre() {},
    loadBrowse() {}, loadGenre() {}, searchAnime: () => new Promise(resolve => { finish = resolve; }),
    setTimeout: fn => { const id = timers.size + 1; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id) };
  vm.runInNewContext(compile(callbacks) + '\nexports.actions = {doSearch, onChangeText, handleClear, handleGenre};', ctx);
  const pending = ctx.exports.actions.doSearch('jojo');
  ctx.exports.actions.onChangeText('naruto');
  finish({ success: true, data: { results: [raw('anime3rb', 1)] } });
  await pending;
  assert.equal(states.length, 0, 'previous query cannot overwrite results after a keystroke');
  ctx.exports.actions.handleClear();
  assert.equal(timers.size, 0, 'clear cancels the pending debounce');
  ctx.exports.actions.onChangeText('jojo'); ctx.exports.actions.handleGenre('Action');
  assert.equal(timers.size, 0, 'genre selection cancels pending search');
  console.log('Anime multi-source search, cache recovery, JoJo family and screen-race checks passed');
}
async function liveCheck() {
  const scraper = direct((url, init) => fetch(url, init), async () => null);
  const runtime = api({ searchWitanimeDirectList: async q => {
    const rows = await scraper.searchWitanimeDirect(q); return rows ? { results: rows } : null;
  }, searchAnime4upDirectList: scraper.searchAnime4upDirectList, searchAnime3rbDirectList: scraper.searchAnime3rbDirectList });
  const result = await runtime.search('jojo');
  const counts = {};
  for (const row of result.data.results) counts[row.source] = (counts[row.source] || 0) + 1;
  assert.ok(result.data.results.length >= 8, 'live JoJo franchise entries must survive aggregation');
  for (const part of ['Part 3', 'Part 4', 'Part 5', 'Part 6']) assert.ok(result.data.results.some(row => row.title.includes(part)), `missing ${part}`);
  const opened = [];
  for (const row of result.data.results.filter(row => /stone-ocean-part-[23]/.test(row.href))) {
    const episodes = row.source === 'anime3rb'
      ? (await scraper.scrapeAnime3rbTitlePage(row.href))?.episodes
      : scraper.parseUp4Episodes(await scraper.fetchSourceHtml(row.href, row.href, '/episode/') || '');
    assert.ok(episodes?.length >= 12, `missing episode list: ${row.href}`);
    if (row.source === 'anime4up') {
      const servers = await scraper.scrapeAnime4upEpisodePageDirect(episodes[0].href);
      assert.ok(servers?.servers.length, `missing servers: ${episodes[0].href}`);
      opened.push({ source: row.source, title: row.title, episodes: episodes.length, servers: servers.servers.length });
    } else {
      const servers = await scraper.scrapeAnime3rbEpisodeServers(episodes[0].href);
      assert.ok(servers.length, `missing servers: ${episodes[0].href}`);
      opened.push({ source: row.source, title: row.title, episodes: episodes.length, servers: servers.length });
    }
  }
  assert.equal(opened.length, 2, 'both previously missing Stone Ocean batches open (one card each)');
  console.log(JSON.stringify({ query: 'jojo', counts, incompleteSources: result.data.incompleteSources, opened }, null, 2));
}
(live ? liveCheck() : checks()).catch(error => { console.error(error); process.exitCode = 1; });

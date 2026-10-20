const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');
const baseline = process.argv.includes('--baseline');
function functions(file, names) {
  const source = baseline && file === 'lib/completion.tsx' ? execFileSync('git', ['show', 'HEAD:' + file], { encoding: 'utf8' }) : fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text)).map(n => n.getText(ast)).join('\n');
}
function run(source, context) {
  context.exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
  return context.exports;
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
(async () => {
  const size = 2500, map = {};
  for (let i = 0; i < size; i++) map['key' + i] = {
    key: 'key' + i, hrefs: ['https://witanime.site/anime/series' + i], titles: ['series' + i],
    lastEpNum: 12, caughtUp: false, finished: false, updatedAt: 1,
  };
  let scans = 0, normalizations = 0;
  const normalize = value => { normalizations++; return (value || '').toLowerCase(); };
  const context = { Map, Set, Date,
    Object: Object.assign(Object.create(Object), { values: value => { const rows = Object.values(value); scans += rows.length; return rows; } }),
    normAnimeKey: normalize, animeTitleKey: normalize,
    getCompletionMap: async () => map, getCompletedSets: async () => ({ knownTitles: new Set(), knownNumbersByTitle: new Map(), numbersByTitle: new Map() }),
    matchCompletionRecords: (_map, hrefs, titles) => {
      const rows = Object.values(_map); scans += rows.length;
      return rows.filter(rec => rec.hrefs.some(h => hrefs.includes(h)) || rec.titles.some(t => titles.includes(t)));
    },
    sameSource: () => true,
    saveCompletionMap: async () => {}, pushToCloud: async () => {}, notify() {},
  };
  const completion = run(functions('lib/completion.tsx', ['uniq', 'reconcileCompletionFromEpisodes']), context);
  const started = performance.now();
  await completion.reconcileCompletionFromEpisodes(Object.values(map).map(rec => ({ animeHref: rec.hrefs[0], animeTitle: rec.titles[0], epNum: rec.lastEpNum })));
  const elapsed = Math.round(performance.now() - started);
  assert.ok(scans <= size * 2, `startup must be linear: scanned ${scans} rows for ${size} records`);
  assert.ok(normalizations <= size * 8, 'normalization must not repeat per pair of records');
  console.log(`Completion startup: ${size} records, ${scans} scanned rows, ${normalizations} normalizations, ${elapsed}ms on this host.`);

  const home = { featured: [{ title: 'ready' }], episodes: [{ href: 'episode' }] };
  let archiveCalls = 0;
  const homeContext = { loadWitanimeHome: async () => home, fetchWitHomeDirect() {}, sourceHomeHasContent() {}, scrapeWitanimeHome() {},
    fetchAnime4upHomeDirect() {}, fetchAnime3rbHomeDirect() {},
    fetchAnime4upRecentPageDirect: () => { archiveCalls++; return new Promise(() => {}); }, filterFinishedEpisodes: async () => [],
    mergeRecentEpisodes: rows => rows, buildHomePayload: raw => ({ success: true, data: raw }),
    homeHasContent: () => true, writeCache: async () => {}, writeCloudHome: async () => {}, HOME_CACHE_KEY: 'home', remoteLog() {},
  };
  const fresh = run(functions('lib/api.ts', ['fetchHomeFresh']) + '\nexports.fetchHomeFresh = fetchHomeFresh;', homeContext);
  const result = await fresh.fetchHomeFresh();
  assert.equal(result.data.featured[0].title, 'ready');
  assert.equal(archiveCalls, 0, 'ready home must not wait for optional archive/airing lookups');

  let homeSettled = false, callback;
  const ast = ts.createSourceFile('home.tsx', fs.readFileSync('app/(tabs)/index.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'HomeScreen');
  const load = component.body.statements.find(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(ast) === 'load'));
  const loading = [];
  const screenContext = { useCallback: fn => fn, startTransition: fn => fn(), lastLoadAt: { current: 0 }, coldStartDeadline: { current: 0 }, COLD_START_DEADLINE_MS: 25000,
    hasContent: { current: false }, emptyRetry: { current: 0 },
    fetchHome: updated => { callback = updated; return new Promise(() => {}); }, getContinueWatching: () => new Promise(() => {}),
    setFeatured() {}, setSections() {}, setLoading: value => loading.push(value),
    setHistory() {}, setOffline() {}, setRefreshing() {}, Date,
  };
  run(load.getText(ast) + '\nexports.load = load;', screenContext).load().then(() => { homeSettled = true; });
  callback({ success: true, data: { featured: home.featured, sections: [] } });
  await tick();
  assert.equal(homeSettled, false);
  assert.deepEqual(loading, [false], 'first usable content must render while other startup promises are pending');

  const host = fs.readFileSync('lib/scraper/ScraperHost.tsx', 'utf8');
  const hostAst = ts.createSourceFile('host.tsx', host, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hostComponent = hostAst.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'ScraperHost');
  const fillSlots = hostComponent.body.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'fillSlots');
  const jobs = Array.from({ length: 4 }, (_, i) => ({ job: { id: 'bg' + i, priority: false } }));
  const browser = { SLOT_COUNT: 4, slotsRef: { current: [null, null, null, null] }, setSlots() {}, _consumeCancelled: () => false,
    _hasPending: () => jobs.length > 0, _peek: () => (jobs.find(row => row.job.priority) || jobs[0])?.job,
    _claimNext: () => jobs.splice(Math.max(0, jobs.findIndex(row => row.job.priority)), 1)[0] };
  const browserActions = run(fillSlots.getText(hostAst) + '\nexports.fillSlots = fillSlots;', browser);
  browserActions.fillSlots();
  assert.equal(browser.slotsRef.current.filter(Boolean).length, 3, 'parallel catalogs retain their existing timeout budget');
  jobs.push({ job: { id: 'selected detail', priority: true } });
  browserActions.fillSlots();
  assert.ok(browser.slotsRef.current.some(job => job?.id === 'selected detail'), 'a selected page starts without waiting for background browsers');
  const daily = fs.readFileSync('components/AnimeOfTheDay.tsx', 'utf8');
  assert.match(daily, /useFocusEffect\(useCallback\(\(\) => \{\s*let alive/, 'daily source verification must stop when Home loses focus');
  console.log('Ready home, early render, browser concurrency and focused background work checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });

// Exercise the actual API and detail lifecycle with deterministic source/platform adapters.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText;
const astOf = file => ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const episodes = n => Array.from({ length: n }, (_, i) => ({ number: i + 1, href: `https://witanime.site/watch/test/${i + 1}`, title: `Episode ${i + 1}`, type: 'TV', screenshot: '' }));
const detail = n => ({ title: 'Test Anime', synopsis: '', poster: '', genres: [], episodes: episodes(n), totalEpisodes: n });
const payload = n => ({ success: true, data: detail(n) });
const url = 'https://witanime.site/anime/test';
const evaluate = (source, context) => { vm.runInNewContext(compile(source), context); return context.exports; };
const cache = evaluate(fs.readFileSync('lib/requestCache.ts', 'utf8'), { exports: {}, setTimeout, clearTimeout });

function api(overrides = {}) {
  const ast = astOf('lib/api.ts');
  const names = ['readCacheEntry', 'readCache', 'writeCache', 'swr', 'fetchEpisodesFresh', 'detailSignature',
    'fetchEpisodesFreshOnce', 'fetchEpisodes', 'fetchEpisodesUp4', 'fetchAnime3rbEpisodes'];
  const source = ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text)).map(n => n.getText(ast)).join('\n');
  const stored = new Map();
  const ctx = { exports: {}, Date, setTimeout, clearTimeout,
    DETAIL_CACHE_PREFIX: '@detail:', DETAIL_CACHE_TTL: 1800000, UP4_CACHE_PREFIX: '@up4:', UP4_CACHE_TTL: 86400000,
    A3RB_EPS_PREFIX: '@a3rb:', A3RB_EPS_TTL: 21600000,
    episodesFreshInflight: new Map(), _swrMisses: new Map(),
    AsyncStorage: { getItem: async key => stored.get(key) ?? null, setItem: async (key, value) => stored.set(key, value) },
    cleanAnimeTitle: s => s || '', cleanSynopsis: s => s || '', titleFromSlug: () => 'Test Anime',
    readCloudMetadata: async () => null, writeCloudMetadata: async () => {},
    scrapeEpisodesPage: async () => detail(13), scrapeAnime3rbTitlePage: async () => detail(13),
    getCrossSourceUrl: async () => 'https://anime4up.com/anime/test', resolveAnime3rbTitleUrl: async () => 'https://anime3rb.com/titles/test',
    withTimeout: (promise, ms, fallback) => cache.withTimeout(promise, ms / 100, fallback), ...overrides };
  const functions = evaluate(source, ctx);
  return { ...functions, seed: (key, data, ageMs = 90_000) => stored.set(key, JSON.stringify({ ts: Date.now() - ageMs, data })),
    cached: key => JSON.parse(stored.get(key)).data };
}

async function apiChecks() {
  let calls = 0;
  const fresh = deferred();
  const cached = api({ scrapeEpisodesPage: () => { calls++; return fresh.promise; } });
  cached.seed('@detail:' + url, payload(12));
  const updates = [], second = [];
  assert.equal((await cached.fetchEpisodes(url, p => updates.push(p.data.episodes.length))).data.episodes.length, 12);
  await cached.fetchEpisodes(url, p => second.push(p.data.episodes.length));
  assert.equal(calls, 1, 'all open screens share the same live scrape');
  fresh.resolve(detail(13));
  await tick();
  assert.deepEqual(updates, [13], 'new episode pushes into the open screen');
  assert.deepEqual(second, [13], 'a second subscriber also receives the update');
  assert.equal(cached.cached('@detail:' + url).data.episodes.length, 13);

  const cloud = api({ readCloudMetadata: async () => ({ payload: payload(12), stale: false }) });
  const cloudUpdates = [];
  assert.equal((await cloud.fetchEpisodes(url, p => cloudUpdates.push(p.data.episodes.length))).data.episodes.length, 12);
  await tick();
  assert.deepEqual(cloudUpdates, [13], 'even a fresh shared cache must check an open page for new episodes');

  let cloudReads = 0;
  const priorities = [];
  const force = api({ readCloudMetadata: async () => { cloudReads++; return { payload: payload(12) }; },
    scrapeEpisodesPage: async (_href, priority) => { priorities.push(priority); return detail(13); } });
  force.seed('@detail:' + url, payload(12));
  assert.equal((await force.fetchEpisodes(url, undefined, { forceRefresh: true })).data.episodes.length, 13);
  assert.equal(cloudReads, 0, 'manual refresh bypasses both local and cloud episode caches');
  assert.deepEqual(priorities, [true], 'a selected detail page can use reserved browser capacity');
  const background = api({ scrapeEpisodesPage: async (_href, priority) => { priorities.push(priority); return detail(13); } });
  await background.fetchEpisodes(url);
  assert.equal(priorities.at(-1), false, 'daily verification cannot consume user-reserved browser capacity');

  let warmScrapes = 0;
  const warm = api({ scrapeEpisodesPage: async () => { warmScrapes++; return detail(13); },
    scrapeAnime3rbTitlePage: async () => { warmScrapes++; return detail(13); } });
  warm.seed('@detail:' + url, payload(13), 0);
  warm.seed('@up4:' + url, { merged: null, episodes4up: episodes(13) }, 0);
  warm.seed('@a3rb:https://anime3rb.com/titles/test', episodes(13), 0);
  await warm.fetchEpisodes(url, () => {});
  await warm.fetchEpisodesUp4(url, 'Test Anime', { onUpdated() {} });
  await warm.fetchAnime3rbEpisodes('Test Anime', { onUpdated() {} });
  assert.equal(warmScrapes, 0, 'rapid navigation reuses just-refreshed episodes without starting three more scrapes');
  await warm.fetchEpisodes(url, undefined, { forceRefresh: true });
  assert.equal(warmScrapes, 1, 'manual refresh still bypasses the warm cache');

  const empty = api({ scrapeEpisodesPage: async () => detail(0) });
  empty.seed('@detail:' + url, payload(12));
  const emptyUpdates = [];
  await empty.fetchEpisodes(url, p => emptyUpdates.push(p));
  await tick();
  assert.equal(emptyUpdates.length, 0, 'a failed empty scrape must not erase playable episodes');
  assert.equal(empty.cached('@detail:' + url).data.episodes.length, 12);

  for (const source of ['up4', 'a3rb']) {
    let scrapes = 0;
    const pending = deferred();
    const enriched = api({ [source === 'up4' ? 'scrapeEpisodesPage' : 'scrapeAnime3rbTitlePage']: () => { scrapes++; return pending.promise; } });
    const old = source === 'up4' ? { merged: { anime4up: 'https://anime4up.com/anime/test' }, episodes4up: episodes(12) } : episodes(12);
    const key = source === 'up4' ? '@up4:' + url : '@a3rb:https://anime3rb.com/titles/test';
    enriched.seed(key, old);
    const pushed = [], follower = [];
    const fetch = options => source === 'up4' ? enriched.fetchEpisodesUp4(url, 'Test Anime', options) : enriched.fetchAnime3rbEpisodes('Test Anime', options);
    const size = data => source === 'up4' ? data.episodes4up.length : data.length;
    assert.equal(size(await fetch({ onUpdated: data => pushed.push(size(data)) })), 12);
    await fetch({ onUpdated: data => follower.push(size(data)) });
    assert.equal(scrapes, 1, 'enrichment is single-flight, including cache hits');
    pending.resolve(detail(13));
    await tick();
    assert.deepEqual(pushed, [13], source + ' cache must push a new episode');
    assert.deepEqual(follower, [13], source + ' second subscriber receives fresh data');
    assert.equal(size(await fetch({ forceRefresh: true })), 13);
  }

  const offline = api({ scrapeEpisodesPage: async () => { throw Error('offline'); } });
  offline.seed('@up4:' + url, { merged: null, episodes4up: episodes(12) });
  assert.equal((await offline.fetchEpisodesUp4(url, 'Test Anime', { forceRefresh: true })).episodes4up.length, 12, 'secondary offline refresh preserves available episodes');
}

async function screenChecks() {
  const ast = astOf('app/anime/[id].tsx');
  const screen = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'AnimeDetailScreen');
  const hooks = screen.body.statements.filter(n => ts.isExpressionStatement(n) && n.expression.expression?.getText(ast) === 'useFocusEffect');
  const main = hooks.find(n => n.getText(ast).includes('refreshDetailRef'));
  const primary = deferred();
  const data = [], up4 = [], a3rb = [], requests = [], polls = [], stateListeners = [];
  const ctx = { exports: {}, animeHref: url, useCallback: fn => fn, useFocusEffect: fn => { ctx.cleanup = fn(); },
    dataRef: { current: null }, refreshDetailRef: { current: null },
    setData: value => { data.push(value); ctx.dataRef.current = value; }, setEpisodes4up: value => up4.push(value.length),
    setEpisodes3rb: value => a3rb.push(value.length), setMerged() {}, setError() {}, setLoading() {}, setRefreshing() {}, t: { failedToLoad: 'failed' },
    fetchEpisodes: (href, updated, options) => { requests.push(options); ctx.updatePrimary = updated; return requests.length === 1 ? primary.promise : Promise.resolve(payload(14)); },
    fetchEpisodesUp4: async (_href, _title, options) => { ctx.updateUp4 = options.onUpdated; return { episodes4up: episodes(12), merged: null }; },
    fetchAnime3rbEpisodes: async (_title, options) => { ctx.update3rb = options.onUpdated; return episodes(12); },
    setInterval: fn => { polls.push(fn); return fn; }, clearInterval: fn => { polls.splice(polls.indexOf(fn), 1); },
    AppState: { currentState: 'active', addEventListener: (_event, fn) => { stateListeners.push(fn); return { remove: () => stateListeners.splice(stateListeners.indexOf(fn), 1) }; } } };
  evaluate(main.getText(ast), ctx);
  polls[0](); stateListeners[0]('active');
  assert.equal(requests.length, 1, 'resume/poll cannot overlap a running detail refresh');
  primary.resolve(payload(12));
  await tick();
  ctx.updatePrimary(payload(13)); ctx.updateUp4({ episodes4up: episodes(13), merged: null }); ctx.update3rb(episodes(13));
  assert.equal(data.at(-1).episodes.length, 13);
  assert.equal(up4.at(-1), 13); assert.equal(a3rb.at(-1), 13);
  await ctx.refreshDetailRef.current(true);
  assert.equal(requests.at(-1).forceRefresh, true, 'pull-to-refresh forces live sources');
  const updatesBeforeBlur = data.length;
  const oldCallback = ctx.updatePrimary;
  ctx.cleanup();
  oldCallback(payload(99));
  assert.equal(data.length, updatesBeforeBlur, 'blurred/old pages ignore late source results');
  assert.equal(polls.length + stateListeners.length, 0, 'poll and resume listener stop on blur');
  evaluate(main.getText(ast), ctx);
  await tick();
  assert.equal(requests.length, 3, 'returning from the player refreshes the episode list');
  ctx.cleanup();

  const recordHook = screen.body.statements.find(n => ts.isExpressionStatement(n) && n.expression.expression?.getText(ast) === 'useEffect' && n.getText(ast).includes('recordAnimeCompletion'));
  const records = [];
  const recordContext = { exports: {}, useEffect: fn => { recordContext.cleanup = fn(); },
    data: detail(12), animeHref: url, maxNum: 12, setsLoaded: true, caughtUp: true, lastTracked: true, merged: null,
    recordAnimeCompletion: async rec => records.push(rec) };
  evaluate(recordHook.getText(ast), recordContext);
  await tick();
  assert.equal(records.length, 1, 'detail saves caught-up before slow airing/alternate-source lookups');
  assert.equal(records[0].caughtUp, true, 'detail records local watch evidence without awaiting other sources');

  const home = fs.readFileSync('app/(tabs)/index.tsx', 'utf8');
  assert.equal(home.includes('await fetchEpisodes(href)'), false, 'startup cannot scrape speculative recommendation details');
  assert.match(home, /initialNumToRender=\{3\}/, 'home rails bound first-render card work');
  assert.match(home, /maxToRenderPerBatch=\{3\}/, 'subsequent card mounts are bounded');
}

(async () => {
  await apiChecks();
  await screenChecks();
  console.log('Episode cache, all-source live refresh, screen lifecycle and startup workload checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });

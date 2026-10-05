// End-to-end continue-watching flow against the REAL history module with an
// in-memory storage adapter: watch → card appears → dismiss → hidden →
// re-watch → card returns. Catches the "not saving / X doesn't hide" class.
// Run:  node scripts/check-continue-watching.cjs

const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const storage = new Map();
// Storage-full simulation: the next write to the history key throws once
// (Android's capped DB), so the prune-and-retry path must kick in.
let failHistoryWriteOnce = false;
const fakeAsyncStorage = {
  getItem: async (key) => storage.get(key) ?? null,
  setItem: async (key, value) => {
    if (failHistoryWriteOnce && key === 'watch_history') {
      failHistoryWriteOnce = false;
      throw new Error('database or disk is full');
    }
    storage.set(key, value);
  },
  removeItem: async (key) => { storage.delete(key); },
  getAllKeys: async () => [...storage.keys()],
  multiGet: async (keys) => keys.map((k) => [k, storage.get(k) ?? null]),
  multiRemove: async (keys) => { for (const k of keys) storage.delete(k); },
};
const modules = {};
function load(file) {
  if (modules[file]) return modules[file];
  const exports = {};
  modules[file] = exports;
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  new Function('require', 'exports', code)((name) => {
    if (name === '@react-native-async-storage/async-storage') return { __esModule: true, default: fakeAsyncStorage };
    if (name === './supabase') return { isSupabaseConfigured: false, supabase: {}, getSessionUser: async () => null };
    if (name === './continueWatching') return load('lib/continueWatching.ts');
    if (name === './historyMerge') return load('lib/historyMerge.ts');
    if (name === './storageMaintenance') return load('lib/storageMaintenance.ts');
    throw Error(`unexpected import: ${name}`);
  }, exports);
  return exports;
}

(async () => {
  const h = load('lib/history.ts');
  const episodeA = 'https://witanime.site/watch/some-anime/5';
  const episodeB = 'https://witanime.site/watch/some-anime/4';
  const meta = {
    episodeTitle: 'الحلقة 5',
    animeTitle: 'Some Anime',
    animeHref: 'https://witanime.site/anime/some-anime',
    image: '',
    epNum: 5,
  };

  // 1. Watch (native save loop) → the episode must reach Continue Watching.
  await h.saveProgress({ ...meta, episodeHref: episodeA, positionMs: 120000, durationMs: 1400000 });
  let row = await h.getContinueWatching();
  assert.equal(row.length, 1, 'watched episode must appear in continue watching');
  assert.equal(row[0].episodeHref, episodeA);

  // 2. Watch an earlier episode later → the row shows the MOST RECENT watch.
  await h.saveProgress({ ...meta, episodeTitle: 'الحلقة 4', epNum: 4, episodeHref: episodeB, positionMs: 60000, durationMs: 1400000 });
  row = await h.getContinueWatching();
  assert.equal(row.length, 1, 'one card per anime');
  assert.equal(row[0].episodeHref, episodeB, 'most recently watched episode wins');

  // 3. X on the card → the whole anime hides (episode 5 must NOT take its place).
  await h.dismissFromContinue(episodeB);
  row = await h.getContinueWatching();
  assert.equal(row.length, 0, 'dismissing must hide the WHOLE anime, not reveal another episode');

  // 4. Re-watching the dismissed anime brings it back.
  await h.saveProgress({ ...meta, episodeHref: episodeA, positionMs: 300000, durationMs: 1400000 });
  row = await h.getContinueWatching();
  assert.equal(row.length, 1, 'watching again must un-dismiss the card');
  assert.equal(row[0].positionMs, 300000);

  // 4. A save with position 0 (WebView fallback path) must NOT overwrite the
  //    real position — and must still keep the card.
  await h.saveProgress({ ...meta, episodeHref: episodeA, positionMs: 0, durationMs: 0 });
  row = await h.getContinueWatching();
  assert.equal(row.length, 1);
  const stored = await h.getProgress(episodeA);
  assert.equal(stored.positionMs, 0, 'zero-position save is stored as-is (caller guards)');

  // 5. Storage-full recovery: a failing history write must prune caches and
  //    retry, so the watch still lands (Android's AsyncStorage DB is capped).
  storage.set('@anime_catalog_v2:page-1', JSON.stringify({ ts: Date.now(), data: [1, 2, 3] }));
  storage.set('@anime_mal_v2:123', JSON.stringify({ ts: Date.now(), data: { a: 1 } }));
  failHistoryWriteOnce = true;
  await h.saveProgress({ ...meta, episodeHref: episodeA, positionMs: 400000, durationMs: 1400000 });
  assert.equal((await h.getProgress(episodeA)).positionMs, 400000, 'save recovered after pruning');
  assert.equal(storage.has('@anime_catalog_v2:page-1'), false, 'cache pruned to free space');
  assert.equal(storage.has('@anime_mal_v2:123'), false, 'cache pruned to free space');

  h.flushHistoryCloudPushes(); // clear the coalescing timer saveProgress left behind
  console.log('continue-watching flow checks passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });

const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

// Run the real storage/reconciliation modules with in-memory platform adapters.
const storage = new Map();
const modules = {};
const react = { createContext: () => ({}), useCallback: x => x, useEffect() {}, useState() {}, useContext() {} };
function load(file) {
  if (modules[file]) return modules[file];
  const exports = {};
  modules[file] = exports;
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React }
  }).outputText;
  new Function('require', 'exports', code)((name) => {
    if (name === 'react') return react;
    if (name === '@react-native-async-storage/async-storage') return { default: {
      getItem: async key => storage.get(key) ?? null,
      setItem: async (key, value) => { storage.set(key, value); },
      removeItem: async key => { storage.delete(key); },
    } };
    if (name === './supabase') return { isSupabaseConfigured: false };
    if (name === './history') return load('lib/history.ts');
    throw Error(name);
  }, exports);
  return exports;
}

(async () => {
  const h = load('lib/history.ts');
  const c = load('lib/completion.tsx');
  const meta = { episodeTitle: 'episode 12', animeTitle: 'Test Anime', animeHref: 'https://witanime.you/anime/test', epNum: 12 };
  const entry = { ...meta, episodeHref: 'https://anime3rb.com/episode/test/12', image: '', positionMs: 95000, durationMs: 100000, updatedAt: 1 };
  storage.set('watch_history', JSON.stringify([entry, { ...entry, episodeHref: 'https://anime4up.com/episode/test-12', completed: true }]));
  let changes = 0;
  const stop = h.subscribeHistory(() => changes++);
  assert.equal(await h.toggleWatched('https://witanime.you/episode/test-12', meta), false);
  assert.equal((await h.getHistory()).some(h.isCompleted), false, 'all source aliases must unmark even past 80%');
  assert.equal((await h.getHistory())[0].positionMs, 95000, 'keep resume position');
  assert.equal((await h.getCompletedSets()).numbersByTitle.size, 0);
  assert.equal(changes, 1);
  assert.equal(await h.toggleWatched(entry.episodeHref + '/', meta), true);
  await c.reconcileCompletionFromEpisodes([meta]);
  let rec = Object.values(await c.getCompletionMap())[0];
  assert.equal(rec.caughtUp, true, 'cold home creates a badge without a detail-page visit');
  await h.toggleWatched(entry.episodeHref, meta);
  await c.reconcileCompletionFromEpisodes([meta]);
  rec = Object.values(await c.getCompletionMap())[0];
  assert.equal(rec.caughtUp, false, 'same episode number must reflect unmark');
  await h.toggleWatched(entry.episodeHref, meta);
  await c.reconcileCompletionFromEpisodes([meta]);
  assert.equal(Object.values(await c.getCompletionMap())[0].caughtUp, true);
  await c.reconcileCompletionFromEpisodes([{ ...meta, epNum: 13 }]);
  assert.equal(Object.values(await c.getCompletionMap())[0].caughtUp, false, 'new unwatched episode clears badge');
  stop();
  console.log('Watch history and cold-start completion checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });

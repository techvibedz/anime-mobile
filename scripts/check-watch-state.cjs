const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

// Run the real storage/reconciliation modules with in-memory platform adapters.
const storage = new Map();
const modules = {};
let airingLookup = async () => false;
let failCompletionWrite = false;
let maxReadBatch = 0;
const effects = [];
const react = { createContext: () => ({}), createElement: () => ({}), useCallback: x => x,
  useEffect: fn => effects.push(fn), useState: initial => [initial, () => {}], useContext() {} };
function load(file) {
  if (modules[file]) return modules[file];
  const exports = {};
  modules[file] = exports;
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React }
  }).outputText;
  new Function('require', 'exports', code)((name) => {
    if (name === 'react') return { __esModule: true, default: react, ...react };
    if (name === '@react-native-async-storage/async-storage') return { __esModule: true, default: {
      getItem: async key => storage.get(key) ?? null,
      setItem: async (key, value) => {
        if (key === 'anime_completion_v2' && failCompletionWrite) { failCompletionWrite = false; throw Error('storage full'); }
        storage.set(key, value);
      },
      removeItem: async key => { storage.delete(key); },
      getAllKeys: async () => [...storage.keys()],
      multiGet: async keys => { maxReadBatch = Math.max(maxReadBatch, keys.length); return keys.map(key => [key, storage.get(key)]); },
      multiRemove: async keys => { for (const key of keys) storage.delete(key); },
    } };
    if (name === './supabase') return { isSupabaseConfigured: false };
    if (name === './continueWatching') return load('lib/continueWatching.ts');
    if (name === './historyMerge') return load('lib/historyMerge.ts');
    if (name === './completionMatch') return load('lib/completionMatch.ts');
    if (name === './requestCache') return load('lib/requestCache.ts');
    if (name === './airing') return { fetchSeriesFinished: (...args) => airingLookup(...args) };
    if (name === './storageMaintenance') return load('lib/storageMaintenance.ts');
    if (name === './history') return load('lib/history.ts');
    throw Error(name);
  }, exports);
  return exports;
}

(async () => {
  const h = load('lib/history.ts');
  // Real raw storage values, not already-normalized test strings.
  const copies = [
    { key: 'old-wit-key', hrefs: ['https://witanime.life/anime/test/'], titles: ['Test Anime'] },
    { key: 'old-up4-key', hrefs: ['https://anime4up.com/anime/test'], titles: ['أنمي Test Anime مترجم'] },
  ].map(rec => ({ ...rec, lastEpNum: 12, caughtUp: true, finished: true, updatedAt: 1 }));
  storage.set('anime_completion_v2', JSON.stringify(Object.fromEntries(copies.map(rec => [rec.key, rec]))));
  const c = load('lib/completion.tsx');
  assert.equal(await c.countCompletedAnime(), 1, 'legacy source copies count as one completed anime');
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
  assert.ok(Object.values(await c.getCompletionMap()).every(rec => !rec.caughtUp && !rec.finished), 'new episode clears EVERY raw/source copy');
  assert.equal(Object.keys(await c.getCompletionMap()).length, 2, 'normalized matching reuses existing records');
  await c.recordAnimeCompletion({ hrefs: [meta.animeHref], titles: [meta.animeTitle], lastEpNum: 12, caughtUp: true, finished: true });
  // The detail page is authoritative over the list it shows: a stored higher
  // number must not make the badge impossible to earn (it never showed, even
  // after reopening the page). A real newer episode re-raises it via the feed.
  assert.ok(Object.values(await c.getCompletionMap()).every(rec => rec.lastEpNum === 12 && rec.caughtUp), 'detail page repairs an inflated episode number');
  await c.reconcileCompletionFromEpisodes([{ ...meta, epNum: 13 }]);
  assert.ok(Object.values(await c.getCompletionMap()).every(rec => rec.lastEpNum === 13 && !rec.caughtUp), 'anchor-source new episode clears it again');
  await c.recordAnimeCompletion({ hrefs: [meta.animeHref, 'https://anime4up.com/anime/test'], titles: [meta.animeTitle], lastEpNum: 13, caughtUp: true, finished: true });
  // anime4up numbers/uploads differently from the witanime list the detail page anchors on.
  await c.reconcileCompletionFromEpisodes([{ animeHref: 'https://anime4up.com/anime/test', animeTitle: meta.animeTitle, epNum: 25 }]);
  assert.ok(Object.values(await c.getCompletionMap()).every(rec => rec.lastEpNum === 13 && rec.caughtUp), 'another source\'s number cannot inflate lastEpNum');

  // Title-key folding: spellings that previously produced different keys must
  // now produce the same key (Latin diacritics, Arabic hamza/taa-marbuta/
  // tashkeel, Arabic-Indic digits) — drift between two sources' scrapes.
  assert.equal(h.animeTitleKey('Café Étoile'), h.animeTitleKey('Cafe Etoile'));
  assert.equal(h.animeTitleKey('النمر الأسود'), h.animeTitleKey('النمر الاسود'));
  assert.equal(h.animeTitleKey('مُشاهدة أنمي'), h.animeTitleKey('مشاهدة انمي'));
  assert.equal(h.animeTitleKey('الموسم ٢'), h.animeTitleKey('الموسم 2'));

  // The player can establish the badge on the finale when no record exists yet
  // (opened from a rail, detail page never visited) — only when the opener said
  // this IS the last episode (detail grid passes nextEp="").
  await c.recordEpisodeWatched({ animeHref: 'https://witanime.you/anime/fresh', animeTitle: 'Fresh Anime', epNum: 1, isLast: true });
  assert.equal((await c.getCompletionMap())['witanime/anime/fresh']?.caughtUp, true, 'isLast creates the finale badge');
  await c.recordEpisodeWatched({ animeHref: 'https://witanime.you/anime/other', animeTitle: 'Other Anime', epNum: 5 });
  assert.equal('witanime/anime/other' in (await c.getCompletionMap()), false, 'non-final watch without a record creates nothing');

  // Drift guard: reconcile must NOT clear the badge when none of the record's
  // titles have tracked history (title drift / evicted entries) — that spurious
  // clear made badges "sometimes disappear" on home focus.
  await c.recordAnimeCompletion({ hrefs: ['https://witanime.you/anime/drifted'], titles: ['Drifted Title'], lastEpNum: 12, caughtUp: true, finished: false });
  await c.reconcileCompletionFromEpisodes([{ animeHref: 'https://witanime.you/anime/drifted', animeTitle: 'Drifted Title', epNum: 12 }]);
  assert.equal((await c.getCompletionMap())['witanime/anime/drifted']?.caughtUp, true, 'drifted title keeps the badge');
  await c.reconcileCompletionFromEpisodes([{ animeHref: 'https://witanime.life/anime/drifted/', animeTitle: 'Drifted Title', epNum: 13 }]);
  assert.equal((await c.getCompletionMap())['witanime/anime/drifted']?.caughtUp, false, 'new episode clears even when no title has tracked history');

  await h.saveProgress({ ...entry, episodeHref: 'https://anime3rb.com/episode/evicted/11', animeTitle: 'Evicted Finale', epNum: 11, completed: false });
  await c.recordAnimeCompletion({ hrefs: ['https://witanime.life/anime/evicted'], titles: ['Evicted Finale'], lastEpNum: 12, caughtUp: true, finished: true });
  await c.reconcileCompletionFromEpisodes([{ animeTitle: 'Evicted Finale', epNum: 11 }]);
  assert.equal((await c.getCompletionMap())['witanime/anime/evicted'].finished, true, 'older history cannot erase a durable evicted finale mark');

  // A delayed AniList lookup must never delay caught-up or resurrect a badge.
  let finishAiring;
  airingLookup = () => new Promise(resolve => { finishAiring = resolve; });
  const race = { animeHref: 'https://anime3rb.com/titles/race', animeTitle: 'Race Anime', epNum: 12, isLast: true };
  const pending = c.recordEpisodeWatched(race);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal((await c.getCompletionMap())['anime3rb/titles/race'].caughtUp, true, 'badge saves before network lookup finishes');
  await c.reconcileCompletionFromEpisodes([{ ...race, epNum: 13 }]);
  finishAiring(true);
  await pending;
  assert.equal((await c.getCompletionMap())['anime3rb/titles/race'].finished, false, 'late airing lookup cannot overwrite the new episode');
  airingLookup = async () => true;
  await c.recordEpisodeWatched({ ...race, epNum: 13 });
  assert.equal((await c.getCompletionMap())['anime3rb/titles/race'].finished, true, 'finale upgrades when airing status is confirmed');

  // Provider reacts to history even when Home and detail are not mounted.
  c.CompletionProvider({ children: null });
  const cleanups = effects.splice(0).map(effect => effect());
  await h.toggleWatched('https://anime3rb.com/episode/race/13', { ...meta, animeHref: race.animeHref, animeTitle: race.animeTitle, epNum: 13 });
  await new Promise(resolve => setTimeout(resolve, 0));
  await h.toggleWatched('https://anime3rb.com/episode/race/13', { ...meta, animeHref: race.animeHref, animeTitle: race.animeTitle, epNum: 13 });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal((await c.getCompletionMap())['anime3rb/titles/race'].caughtUp, false, 'unmark propagates without visiting Home/detail');
  for (const cleanup of cleanups) cleanup?.();

  storage.set('@detail_old', 'refetchable cache');
  failCompletionWrite = true;
  await c.recordAnimeCompletion({ hrefs: [race.animeHref], titles: [race.animeTitle], lastEpNum: 13, caughtUp: false, finished: false });
  // Force a meaningful change for the storage-full recovery.
  await c.recordAnimeCompletion({ hrefs: [race.animeHref], titles: [race.animeTitle, 'Race Alias'], lastEpNum: 13, caughtUp: false, finished: false });
  assert.equal(storage.has('@detail_old'), false, 'full completion storage prunes only refetchable cache');
  assert.ok(storage.has('watch_history'), 'history survives cache recovery');
  const persisted = JSON.parse(storage.get('anime_completion_v2'));
  assert.ok(persisted['anime3rb/titles/race'].titles.includes('Race Alias'), 'completion retry persists');

  for (let i = 0; i < 65; i++) storage.set(`@detail_batch${i}`, JSON.stringify({ ts: 1, data: 'large payload' }));
  await load('lib/storageMaintenance.ts').pruneExpiredCaches();
  assert.ok(maxReadBatch <= 20, 'housekeeping bounds each bridge payload');

  // Grouped watch history: one row per anime across sources, with the last
  // episode reached and a per-anime delete that removes every source alias.
  const save = (over) => h.saveProgress({
    episodeHref: '', episodeTitle: '', animeTitle: '', animeHref: '', image: '',
    positionMs: 0, durationMs: 0, ...over,
  });
  await save({ episodeHref: 'https://anime3rb.com/episode/naruto/11', episodeTitle: 'الحلقة 11', animeTitle: 'Naruto', animeHref: 'https://anime3rb.com/anime/naruto', completed: true, epNum: 11 });
  await new Promise((r) => setTimeout(r, 5));
  await save({ episodeHref: 'https://witanime.you/episode/naruto-12', episodeTitle: 'الحلقة 12', animeTitle: 'Naruto', animeHref: 'https://witanime.you/anime/naruto', image: 'naruto.jpg', positionMs: 500000, durationMs: 1000000, epNum: 12 });
  await new Promise((r) => setTimeout(r, 5));
  await save({ episodeHref: 'https://anime4up.com/episode/naruto-12-sub', episodeTitle: 'الحلقة 12 مترجمة', animeTitle: 'Naruto', animeHref: 'https://anime4up.com/anime/naruto', positionMs: 0, durationMs: 0, epNum: 12 });
  await new Promise((r) => setTimeout(r, 5));
  await save({ episodeHref: 'https://witanime.you/episode/bleach-3', episodeTitle: 'الحلقة 3', animeTitle: 'Bleach', animeHref: 'https://witanime.you/anime/bleach', epNum: 3 });

  let groups = h.groupHistoryByAnime(await h.getHistory());
  const naruto = groups.find((g) => g.animeTitle === 'Naruto');
  assert.equal(!!naruto, true, 'same anime under two sources groups into one row');
  assert.equal(naruto.episodes, 2, 'the same episode on another source dedupes by episode number');
  assert.equal(naruto.watched, 1, 'completed episode counted');
  assert.equal(naruto.lastEpNum, 12, 'last episode reached shown');
  assert.equal(naruto.image, 'naruto.jpg');
  assert.equal(groups[0].animeTitle, 'Bleach', 'newest anime first');

  await h.removeAnimeFromHistory('https://witanime.you/anime/naruto', 'Naruto');
  groups = h.groupHistoryByAnime(await h.getHistory());
  assert.equal(groups.some((g) => g.animeTitle === 'Naruto'), false, 'per-anime delete removes every source alias');
  assert.equal(groups.some((g) => g.animeTitle === 'Bleach'), true, 'other anime untouched');

  h.flushHistoryCloudPushes(); // clear the coalescing timer saveProgress left behind
  stop();
  console.log('Watch history and cold-start completion checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });

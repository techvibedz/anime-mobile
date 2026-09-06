const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const desktop = process.argv[2];

function device(file, channels) {
  const mobile = !file.includes('src/lib');
  let slots = [], cursor = 0, effects = [];
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useCallback(fn) { cursor++; return fn; },
    useEffect(fn, deps) {
      const i = cursor++, prev = slots[i];
      if (!prev || deps.some((x, j) => x !== prev.deps[j])) {
        effects.push(() => { prev?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; });
      }
    },
  };
  const timers = new Set();
  const supabase = { channel(name) {
    const handlers = [];
    const ch = {
      name, on(type, filter, cb) { handlers.push({ type, event: filter.event, cb }); return ch; },
      subscribe(cb) { channels.push(ch); cb('SUBSCRIBED'); return ch; },
      async track() {}, async untrack() {}, presenceState() { return {}; },
      send(message) { for (const other of channels) if (other !== ch && other.name === name) other.deliver(message.event, message.payload); return Promise.resolve('ok'); },
      deliver(event, payload) { handlers.filter(h => h.type === 'broadcast' && h.event === event).forEach(h => h.cb({ payload })); },
    }; return ch;
  }, async removeChannel(ch) { channels.splice(channels.indexOf(ch), 1); } };
  const navigate = () => {};
  function load(sourceFile) {
    const out = {};
    const code = ts.transpileModule(fs.readFileSync(sourceFile, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function('require', 'exports', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', code)(name => {
      if (name === 'react') return react;
      if (name === 'react-native') return { AppState: { addEventListener: () => ({ remove() {} }) } };
      if (name === 'expo-router') return { router: { replace: navigate } };
      if (name === 'react-router-dom') return { useNavigate: () => navigate };
      if (name === './supabase') return { supabase };
      if (name === './watchPartySync') return load(path.join(path.dirname(sourceFile), 'watchPartySync.ts'));
      throw Error(name);
    }, out, fn => { timers.add(fn); return fn; }, fn => timers.delete(fn), () => 0, () => {});
    return out;
  }
  const api = load(file);
  const video = { currentTime: 42, paused: true, play() { video.paused = false; return Promise.resolve(); }, pause() { video.paused = true; }, addEventListener() {}, removeEventListener() {} };
  const opts = mobile ? {
    player: video, episode: 'https://anime3rb.com/episode/test/12', navParams: { url4up: 'alternate', epNum: '12' }, paused: true, selfReady: true,
    applyPaused(paused) { opts.paused = paused; video.paused = paused; },
  } : { videoRef: { current: video }, episode: 'https://anime3rb.com/episode/test/12', navParams: { up4: 'alternate', ep: '12' }, onPaused() {} };
  return { api, video, opts, beat() { timers.forEach(fn => fn()); }, render() { cursor = 0; effects = []; const hook = api.useWatchPartySync(opts); effects.forEach(fn => fn()); return hook; } };
}

async function scenario(hostFile, clientFile) {
  const channels = [];
  const host = device(hostFile, channels), client = device(clientFile, channels);
  const code = await host.api.createRoom({ id: 'host' });
  await client.api.joinRoom(code, { id: 'viewer' });
  let h = host.render();
  client.render();
  if (h.start) { h.start(); h = host.render(); } else host.video.paused = false;
  host.beat();
  assert.equal(client.video.paused, false);
  let c = client.render();
  if (c.requestPlayback) c.requestPlayback(false); else c.pulse(false);
  assert.equal(host.video.paused, true, 'viewer pauses host');
  assert.equal(client.video.paused, true, 'host relays pause to viewer');
  host.beat();
  assert.equal(client.video.paused, true, 'heartbeat must preserve viewer pause');
  if (c.requestPlayback) c.requestPlayback(true); else c.pulse(true);
  assert.equal(host.video.paused, false, 'viewer resumes room');
  host.beat();
  assert.equal(client.video.paused, false);
  let state;
  client.api.subscribeState(s => { state = s; });
  assert.equal(state.params.up4, 'alternate');
  assert.equal(state.params.url4up, 'alternate');
  assert.equal(state.params.epNum, '12');
  channels[0].deliver('control', { episode: 'wrong-episode', playing: false });
  assert.equal(host.video.paused, false, 'stale episode controls ignored');
  channels[1].deliver('sync', { positionMs: NaN });
  assert.equal(client.video.paused, false, 'invalid broadcast ignored');
  await host.api.leaveRoom(); await client.api.leaveRoom();
}
(async () => {
  await scenario('lib/watchParty.ts', 'lib/watchParty.ts');
  if (desktop) {
    const file = path.join(desktop, 'src/lib/watchParty.ts').replaceAll('\\', '/');
    await scenario('lib/watchParty.ts', file);
    await scenario(file, 'lib/watchParty.ts');
  }
  console.log('Party control, heartbeat, payload and interoperability checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });

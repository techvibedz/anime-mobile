const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function load(file, imports, extra = {}) {
  const out = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, { exports: out, URL, ...extra, require(name) {
    if (Object.hasOwn(imports, name)) return imports[name];
    throw Error(`Unmocked import: ${name}`);
  } });
  return out;
}
const jsx = (type, props) => ({ type, props });
function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}

// Exercise real component events and timers: failure, fallback, bounded retry,
// stalled loading, manual recovery, displayed state and cleanup.
const slots = [];
let cursor = 0, dirty = false, effects = [];
const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => value === b[i]);
const react = {
  useState(initial) {
    const i = cursor++;
    if (!slots[i]) slots[i] = { value: typeof initial === "function" ? initial() : initial };
    return [slots[i].value, (value) => {
      const next = typeof value === "function" ? value(slots[i].value) : value;
      if (next !== slots[i].value) { slots[i].value = next; dirty = true; }
    }];
  },
  useRef(initial) { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }); },
  useCallback(fn, deps) {
    const i = cursor++;
    if (!same(slots[i]?.deps, deps)) slots[i] = { deps, value: fn };
    return slots[i].value;
  },
  useEffect(fn, deps) {
    const i = cursor++;
    if (same(slots[i]?.deps, deps)) return;
    const cleanup = slots[i]?.cleanup;
    slots[i] = { deps };
    effects.push(() => { cleanup?.(); slots[i].cleanup = fn(); });
  },
};
let now = 0, timerId = 0;
const timers = new Map();
const theme = load("lib/manga/design.ts", {});
const cover = load("lib/manga/cover.ts", {});
const { MangaPageImage } = load("components/MangaPageImage.tsx", {
  react, "react/jsx-runtime": { jsx, jsxs: jsx },
  "react-native": { View: "View", Text: "Text", Pressable: "Pressable", StyleSheet: { create: s => s } },
  "expo-image": { Image: "Image" }, "@expo/vector-icons": { Ionicons: "Icon" },
  "../lib/manga/design": theme, "../lib/i18n": { t: { retry: "Retry", mangaPageError: "Failed page" } },
  "../lib/manga/cover": cover, "./MangaUI": { MangaSkeleton: "Shimmer" }, "../lib/motion": { useReducedMotion: () => false },
}, {
  setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id; },
  clearTimeout(id) { timers.delete(id); },
});
const original = "https://3asq.online/wp-content/uploads/WP-manga/data/one-175x238.jpg";
let displayed = 0;
let props = { uri: original, page: 0, headers: { Referer: "https://3asq.online/manga/one/1/" }, contentFit: "fill", onMeasure() {}, onDisplayed() { displayed++; } };
let tree;
function render() {
  let turns = 0;
  do {
    dirty = false; cursor = 0; effects = [];
    tree = MangaPageImage(props);
    for (const effect of effects) effect();
    assert(++turns < 20, "component must settle without a render loop");
  } while (dirty);
}
const image = () => nodes(tree).find(node => node.type === "Image");
function advance(ms) {
  const end = now + ms;
  while (true) {
    const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
    if (!next) break;
    now = next[1].at; timers.delete(next[0]); next[1].fn(); render();
  }
  now = end;
}
render();
assert.equal(image().props.allowDownscaling, true, "continuous strips must downsample safely");
assert.equal(image().props.source.headers.Referer, props.headers.Referer);
image().props.onError(); render();
assert.equal(image().props.source.uri, original, "missing upgraded image must fall back to provider URL");
assert.equal(image().props.cachePolicy, "none", "recovery must bypass failed cache entries");
image().props.onError(); advance(800);
image().props.onError(); render();
assert.equal(image(), undefined, "automatic retries must stop");
nodes(tree).find(node => node.type === "Pressable").props.onPress(); render();
assert(image(), "manual retry must restore the image request");
image().props.onDisplay(); render();
assert.equal(displayed, 1);
assert.equal(timers.size, 0, "successful display must cancel the loading watchdog");
props = { ...props, uri: "https://cdn.example.org/stalled.jpg" }; render();
advance(65_000);
assert.equal(image(), undefined, "stalled image must eventually show retry instead of endless shimmer");
for (const slot of slots) slot?.cleanup?.();
assert.equal(timers.size, 0, "unmount must clear recovery timers");

// Cover failures must leave a readable tile, and a recycled tile must be able
// to load its new cover instead of keeping the previous item's error state.
slots.length = 0;
const { MangaCover } = load("components/MangaUI.tsx", {
  react, "react/jsx-runtime": { jsx, jsxs: jsx },
  "react-native": { View: "View", Text: "Text", Pressable: "Pressable", ActivityIndicator: "Spinner", StyleSheet: { create: s => s } },
  "expo-image": { Image: "Image" }, "@expo/vector-icons": { Ionicons: "Icon" },
  "../lib/manga/design": theme, "../lib/cardLayout": { CARD_LAYOUTS: ["compact", "comfortable", "list"] },
  "../lib/i18n": { t: {} }, "../lib/motion": { useReducedMotion: () => false }, "./Shimmer": { Shimmer: "Shimmer" },
});
let coverProps = { uri: "https://cdn.example.org/cover-one.jpg", label: "First story" };
const renderCover = () => { cursor = 0; tree = MangaCover(coverProps); };
renderCover();
image().props.onError(); renderCover();
assert.equal(image(), undefined, "failed cover must stop rendering a broken image");
assert(nodes(tree).some(node => node.type === "Text" && node.props.children === "First story"), "failed cover must retain the story's label");
coverProps = { uri: "https://cdn.example.org/cover-two.jpg", label: "Second story" };
renderCover();
assert.equal(image().props.source.uri, coverProps.uri, "recycled cover must load the new story's artwork");

// Run the actual restore effects with cold preferences / warm progress and
// verify approximate jumps cannot overwrite the saved target.
const readerAst = ts.createSourceFile("reader.tsx", fs.readFileSync("app/manga-reader/[chapter].tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const effectFunctions = [];
const refFunctions = [];
let saveFunction;
let interactionFunction;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(readerAst) === "useEffect") effectFunctions.push(node.arguments[0].getText(readerAst));
  if (ts.isCallExpression(node) && node.expression.getText(readerAst) === "useRef" && ts.isArrowFunction(node.arguments[0])) refFunctions.push(node.arguments[0].getText(readerAst));
  if (ts.isVariableDeclaration(node) && node.name.getText(readerAst) === "beginInteraction") interactionFunction = node.initializer.arguments[0].getText(readerAst);
  if (ts.isBinaryExpression(node) && node.left.getText(readerAst) === "saveRef.current") saveFunction = node.right.getText(readerAst);
  ts.forEachChild(node, visit);
}
visit(readerAst);
const position = {
  pendingPageRef: { current: 20 }, indexRef: { current: 0 }, pagesRef: { current: null },
  restoredRef: { current: false }, restoringRef: { current: true }, userInteractedRef: { current: false },
  prefsLoaded: false, progressReady: true, pages: Array(30).fill("page"), saved: [], jumps: [],
  clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
  setIndex: (value) => { position.indexRef.current = value; },
  scrollToTargetRef: { current: (value) => position.jumps.push(value) },
  saveMangaProgress: (value) => { position.saved.push(value); },
  source: "asq", mangaId: "one", mangaTitle: "One", coverParam: "", detail: null, chapterId: "1", chapterSource: "asq", chapterMangaId: "one", chapterNumber: "1",
  displayedPagesRef: { current: new Set() },
};
function positionFunction(source) {
  const output = ts.transpileModule(`var extracted = ${source};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return vm.runInNewContext(`${output}\nextracted`, { ...position, setTimeout, clearTimeout });
}
const reanchorSource = effectFunctions.find(fn => fn.includes("if (restoredRef.current && pagesRef.current)"));
const restoreSource = effectFunctions.find(fn => fn.includes("const target = clamp(pendingPageRef.current"));
positionFunction(reanchorSource)();
assert.equal(position.pendingPageRef.current, 20, "late preferences must preserve the pending saved page");
assert.equal(positionFunction(restoreSource)(), undefined, "restore must wait for preferences");
position.prefsLoaded = true;
const cancelRestore = positionFunction(restoreSource)();
assert.equal(position.indexRef.current, 20);
positionFunction(saveFunction)(0, 30);
assert.equal(position.saved.length, 0, "initial/approximate viewability must not reset saved progress");
cancelRestore();
position.restoringRef.current = true;
positionFunction(saveFunction)(20, 30);
assert.equal(position.saved[0].page, 20, "saving resumes when the actual target becomes visible");
position.pagesRef.current = Array(30).fill("page");
position.restoringRef.current = true;
position.directionRef = { current: "rtl" };
position.saveRef = { current: positionFunction(saveFunction) };
positionFunction(refFunctions.find(fn => fn.includes("directionRef.current")))({ viewableItems: [{ isViewable: true, index: 9 }] });
assert.equal(position.restoringRef.current, false, "nonanimated paged restore must release protection via logical viewability");
position.jumpRetryRef = { current: { timer: setTimeout(() => assert.fail("cancelled restore retry fired"), 1000) } };
positionFunction(interactionFunction)();
assert.equal(position.jumpRetryRef.current.timer, null, "manual navigation must cancel pending restore retries");
assert.equal(position.userInteractedRef.current, true);

(async () => {
  const calls = [];
  const fuzzy = load("lib/fuzzy.ts", {});
  const aggregate = load("lib/manga/aggregate.ts", {
    "@react-native-async-storage/async-storage": { getItem: async () => null, setItem: async () => {} },
    "../fuzzy": fuzzy,
    "../requestCache": { createRequestCache: () => ({ run: (_, fn) => fn() }), withTimeout: (promise) => promise },
    "./api": { async searchManga(source, query, options) {
      calls.push({ source, query, options });
      return [{ source, id: options.genres[0], title: `One Piece ${options.genres[0]}`, cover: null }];
    } },
  });
  const results = await aggregate.searchMergedManga("One Piece", { genres: ["أكشن", "مغامرة"], type: "مانجا", status: "مستمر", page: 2 });
  assert.equal(calls.length, 6, "each source must combine title and each selected genre");
  for (const call of calls) {
    assert.equal(call.query, "One Piece");
    assert.equal(call.options.genres.length, 1);
    assert.equal(call.options.page, 2);
    assert.equal(call.options.type, "مانجا");
    assert.equal(call.options.status, "مستمر");
  }
  assert.equal(results.length, 2, "genre union must dedupe titles across sources");
  console.log("Manga recovery: retries, watchdog, safe decoding and combined search passed");
})().catch(error => { console.error(error); process.exitCode = 1; });

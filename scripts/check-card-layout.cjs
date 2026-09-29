const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function load(storage) {
  const out = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("lib/cardLayout.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, {
    exports: out,
    require(name) {
      if (name === "react") return {};
      if (name === "react-native") return {};
      if (name === "@react-native-async-storage/async-storage") return storage;
      throw Error(name);
    },
  });
  return out;
}

function loadUi(file, imports) {
  const out = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText, {
    exports: out,
    React: imports.react,
    require(name) {
      if (Object.hasOwn(imports, name)) return imports[name];
      throw Error(name);
    },
  });
  return out;
}
const jsx = (type, props, ...children) => ({ type, props: { ...props, children: children.length === 1 ? children[0] : children } });
function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
const native = { View: "View", Text: "Text", Pressable: "Pressable", Modal: "Modal", ActivityIndicator: "Spinner", StyleSheet: { create: styles => styles, absoluteFill: { position: "absolute" } } };
const theme = loadUi("lib/theme.ts", {});

(async () => {
  const saved = new Map();
  let resolveRead;
  const writes = [];
  const store = load({
    getItem: () => new Promise(resolve => { resolveRead = resolve; }),
    async setItem(key, value) { writes.push([key, value]); saved.set(key, value); },
  });
  for (const width of [240, 320, 360, 390, 430, 768]) {
    for (const layout of ["compact", "comfortable", "list"]) {
      const m = store.cardLayoutMetrics(layout, width);
      assert(m.cardWidth > 0);
      const used = m.cardWidth * m.columns + (m.columns - 1) * 12;
      assert(used <= width - 40 + 0.001, "cards must never overflow the available width");
      // The 2dp floor can shave <0.01 per column; anything larger is a real gap.
      assert(used >= width - 40 - 0.01 * m.columns - 0.001, "cards must fill the available width");
      if (layout === "list") assert.equal(m.columns, 1);
    }
  }
  assert.equal(store.cardLayoutMetrics("compact", 390).columns, 3);
  assert.equal(store.cardLayoutMetrics("comfortable", 390).columns, 2);
  // Each page owns its layout: changing one page must never touch another.
  assert.equal(store.getCardLayout("search"), "compact");
  assert.equal(store.getCardLayout("mylist"), "compact");
  let searchUpdates = 0;
  let mylistUpdates = 0;
  const unsubscribeSearch = store.subscribeCardLayout("search", () => searchUpdates++);
  const unsubscribeMylist = store.subscribeCardLayout("mylist", () => mylistUpdates++);
  const hydrating = store.hydrateCardLayout("search");
  const comfortable = store.setCardLayout("search", "comfortable");
  const list = store.setCardLayout("search", "list");
  const mylist = store.setCardLayout("mylist", "comfortable");
  resolveRead("compact");
  await Promise.all([hydrating, comfortable, list, mylist]);
  assert.equal(store.getCardLayout("search"), "list", "a delayed disk read must not overwrite a tap");
  assert.equal(store.getCardLayout("mylist"), "comfortable", "pages must not affect each other");
  const persisted = (key) => writes.filter(([k]) => k === key).map(([, value]) => value);
  assert.equal(writes.length, 3, "one write per tap");
  assert.deepEqual(persisted("@settings_card_layout:search"), ["comfortable", "list"], "each page persists under its own key, newest tap last");
  assert.deepEqual(persisted("@settings_card_layout:mylist"), ["comfortable"]);
  assert.equal(searchUpdates, 2, "the page's grid must be notified of its own changes");
  assert.equal(mylistUpdates, 1, "other pages must not be notified");
  unsubscribeSearch();
  unsubscribeMylist();
  const restarted = load({ getItem: async (key) => saved.get(key), setItem: async () => {} });
  await restarted.hydrateCardLayout("search");
  await restarted.hydrateCardLayout("mylist");
  assert.equal(restarted.getCardLayout("search"), "list", "each page restores its own saved layout");
  assert.equal(restarted.getCardLayout("mylist"), "comfortable");
  assert.equal(restarted.getCardLayout("upcoming"), "compact", "an untouched page keeps the default");
  const invalid = load({ getItem: async () => "unknown", setItem: async () => { throw Error("full"); } });
  await invalid.hydrateCardLayout("search");
  assert.equal(invalid.getCardLayout("search"), "compact");
  await invalid.setCardLayout("search", "comfortable");
  assert.equal(invalid.getCardLayout("search"), "comfortable", "a storage failure must not break layout switching");

  // FlatList forbids changing numColumns on the same instance. Every full-page
  // catalog must remount for a layout change while retaining its screen state.
  for (const file of ["app/(tabs)/search.tsx", "app/(tabs)/mylist.tsx", "app/see-all/[section].tsx", "app/upcoming.tsx", "app/seasons.tsx", "app/popular/[kind].tsx"]) {
    const source = fs.readFileSync(file, "utf8");
    assert(source.includes("<CardLayoutControl"), `${file}: missing layout selector`);
    assert(source.includes("key={`${cards.layout}-${cards.columns}`}"), `${file}: unsafe FlatList column change`);
    assert(source.includes("numColumns={cards.columns}"), `${file}: fixed column count`);
    assert(source.includes("cards.columns > 1 ? { gap: GAP } : undefined"), `${file}: column wrapper must be absent in list mode`);
  }
  for (const file of ["app/anime/[id].tsx", "app/title/[id].tsx"]) {
    assert(fs.readFileSync(file, "utf8").includes("<CardLayoutControl"), `${file}: related grids must support layouts`);
  }
  // The saved choice is per page: every grid must pass its own scope.
  const pageScopes = {
    "app/(tabs)/search.tsx": "search",
    "app/(tabs)/mylist.tsx": "mylist",
    "app/upcoming.tsx": "upcoming",
    "app/seasons.tsx": "seasons",
    "app/popular/[kind].tsx": "popular",
    "app/see-all/[section].tsx": "see-all",
    "app/anime/[id].tsx": "related",
    "app/title/[id].tsx": "title",
  };
  for (const [file, scope] of Object.entries(pageScopes)) {
    assert(fs.readFileSync(file, "utf8").includes(`useCardLayout("${scope}"`), `${file}: must save its own layout under "${scope}"`);
  }

  const react = { createElement: jsx, memo: fn => fn, useState: initial => [initial, () => {}] };
  const card = loadUi("components/PosterCard.tsx", {
    react,
    "react-native": native,
    "expo-image": { Image: "Image" },
    "expo-linear-gradient": { LinearGradient: "Gradient" },
    "@expo/vector-icons": { Ionicons: "Icon" },
    "../lib/theme": theme,
    "../lib/img": { posterUrl: uri => uri },
    "../lib/i18n": { t: { newBadge: "جديد" } },
  });
  const longTitle = "A very long anime title that must not expand the entire grid row";
  const posterSource = fs.readFileSync("components/PosterCard.tsx", "utf8");
  assert(posterSource.includes("export const GRID_TITLE_BAND"), "the overlaid title band must be a shared constant for callers");
  assert(posterSource.includes("bottom: GRID_TITLE_BAND + 8"), "bottom badges must clear the overlaid title");
  let presses = 0;
  for (const layout of ["compact", "comfortable", "list"]) {
    const tree = card.PosterCard({ title: longTitle, subtitle: "TV", image: "poster", width: 108, layout, onPress: () => presses++ });
    const title = nodes(tree).find(node => node.type === "Text" && node.props.children === longTitle);
    assert(title, "the title must always be rendered");
    assert.equal(title.props.numberOfLines, 2);
    assert.equal(title.props.ellipsizeMode, "tail");
    assert.equal(tree.props.accessibilityLabel, longTitle, "the full title remains accessible");
    const subtitleShown = nodes(tree).some(node => node.type === "Text" && node.props.children === "TV");
    const external = tree.props.children.filter(Boolean);
    if (layout === "list") {
      assert.equal(external.length, 2, "list keeps a caption beside the poster");
      assert(subtitleShown, "list shows the subtitle");
      assert.equal(title.props.maxFontSizeMultiplier, undefined);
    } else {
      assert.equal(external.length, 1, "grid cards must be the poster alone — the title lives on the artwork");
      assert(!subtitleShown, "grid never renders a caption subtitle");
      assert.equal(title.props.maxFontSizeMultiplier, 1.2, "overlaid titles must resist system font scaling");
    }
    tree.props.onPress();
  }
  assert.equal(presses, 3, "all layouts must keep the original navigation action");
  assert(fs.readFileSync("app/anime/[id].tsx", "utf8").includes("bottom: GRID_TITLE_BAND"), "the relation ribbon must clear the overlaid title");

  const cardLayoutModule = load({ getItem: async () => null, setItem: async () => {} });
  const changes = [];
  const control = loadUi("components/CardLayoutControl.tsx", {
    react,
    "react-native": native,
    "@expo/vector-icons": { Ionicons: "Icon" },
    "../lib/theme": theme,
    "../lib/cardLayout": cardLayoutModule,
    "../lib/i18n": { t: { cardLayout: "Layout", cardLayoutCompact: "Compact", cardLayoutComfortable: "Large", cardLayoutList: "List", cardLayoutHint: "Tap to cycle" } },
  });
  for (const [from, to] of [["compact", "comfortable"], ["comfortable", "list"], ["list", "compact"]]) {
    const controlTree = control.CardLayoutControl({ layout: from, onChange: value => changes.push(value) });
    assert(!nodes(controlTree).some(node => node.type === "Modal"), "the layout control must not open a sheet");
    const trigger = nodes(controlTree).find(node => node.type === "Pressable");
    const buttonStyle = trigger.props.style({ pressed: false })[0];
    assert.equal(buttonStyle.width, 48, "the selector must be a compact toolbar action");
    assert.equal(buttonStyle.height, 48);
    assert.equal(trigger.props.accessibilityRole, "button");
    assert(trigger.props.accessibilityHint, "the cycle button needs an accessibility hint");
    trigger.props.onPress();
  }
  assert.deepEqual(changes, ["comfortable", "list", "compact"], "one press must advance compact → comfortable → list → compact");
  console.log("Card layouts: sizing, per-page persistence, race handling, poster-only grid cards with overlaid titles, press-to-cycle selector and route coverage passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });

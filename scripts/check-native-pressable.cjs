const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const babel = require("@babel/core");

function evaluate(code, imports, extra = {}) {
  const exports = {};
  vm.runInNewContext(code, { exports, process: { env: { NODE_ENV: "production" } }, ...extra, require(name) {
    if (Object.hasOwn(imports, name)) return imports[name];
    if (name.startsWith("@babel/runtime/helpers/")) return require(name);
    throw Error(`Unmocked import: ${name}`);
  } });
  return exports;
}
function compile(file, isDev = false) {
  // Use the APP's Babel config and Android caller, not a separate web fixture.
  return babel.transformFileSync(file, {
    caller: { name: "metro", platform: "android", isDev },
    plugins: ["@babel/plugin-transform-modules-commonjs"],
  }).code;
}
const jsx = (type, props) => ({ type, props });
const react = {
  memo: fn => fn, createElement: jsx, useContext: () => ({}),
  useState: value => [value, () => {}], useMemo: fn => fn(), useEffect() {},
  useReducer: (reducer, initial, init) => [init(initial), () => {}],
};
const native = { Pressable: "Pressable", View: "View", Text: "Text", ActivityIndicator: "Spinner", StyleSheet: { create: value => value } };
const shared = require("react-native-css-interop/dist/shared");
const styles = { getOpaqueStyles: style => [style] };
const globals = {};
const render = evaluate(fs.readFileSync(require.resolve("react-native-css-interop/dist/runtime/native/render-component"), "utf8"), {
  react, "react-native": native, "./globals": globals, "./styles": styles,
});
const { interop } = evaluate(fs.readFileSync(require.resolve("react-native-css-interop/dist/runtime/native/native-interop"), "utf8"), {
  react, "react-native": native, "../../shared": shared,
  "../observable": { cleanupEffect() {} }, "./conditions": {}, "./globals": globals,
  "./render-component": render, "./styles": styles,
  "./resolve-value": { getTarget: (props, config) => config.target.reduce((value, key) => value?.[key], props) },
});
const config = require("react-native-css-interop/dist/runtime/config").getNormalizeConfig({ className: "style" });
const interopComponents = new Map([[native.Pressable, props => interop(native.Pressable, config, props)]]);
const wrapJSX = evaluate(fs.readFileSync(require.resolve("react-native-css-interop/dist/runtime/wrap-jsx"), "utf8"), {
  "./api": { interopComponents },
  "./third-party-libs/react-native-safe-area-context": { maybeHijackSafeAreaProvider: type => type },
}, { process: { env: { NODE_ENV: "test" } } }).default;
const imports = {
  react, "react-native": native, "@expo/vector-icons": { Ionicons: "Icon" },
  "react/jsx-runtime": { jsx, jsxs: jsx },
  "react/jsx-dev-runtime": { jsxDEV: jsx },
  "nativewind/jsx-runtime": { jsx: wrapJSX(jsx), jsxs: wrapJSX(jsx) },
  "nativewind/jsx-dev-runtime": { jsxDEV: wrapJSX(jsx) },
};
const theme = evaluate(compile("lib/manga/design.ts"), imports);
imports["../lib/manga/design"] = theme;
function resolve(node) {
  while (typeof node.type === "function") node = node.type(node.props);
  return node;
}
function flatStyle(node, pressed = false) {
  node = resolve(node);
  const style = typeof node.props.style === "function" ? node.props.style({ pressed }) : node.props.style;
  return Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
}

// Reproduce the installed native wrapper bug so this check covers the failure
// in the screenshots: a callback becomes {}, while a static style survives.
const callback = () => ({ flexDirection: "row-reverse", backgroundColor: theme.M.ink });
assert.equal(Object.keys(interop(native.Pressable, config, { style: callback }).props.style).length, 0);
assert.equal(interop(native.Pressable, config, { style: callback() }).props.style.backgroundColor, theme.M.ink);

for (const isDev of [false, true]) {
  const { ChapterRow } = evaluate(compile("components/ChapterRow.tsx", isDev), imports);
  const row = ChapterRow({ number: "171.5", title: "جاهز للقراءة", onPress() {} });
  assert.equal(flatStyle(row).flexDirection, "row-reverse", "Android chapter row lost its callback layout");
  assert.equal(flatStyle(row).backgroundColor, theme.M.sheet, "Android chapter row lost its panel");
  assert.equal(flatStyle(row, true).opacity, 0.85, "native press feedback must survive");
  assert.equal(flatStyle(ChapterRow({ number: "171", active: true, onPress() {} })).backgroundColor, theme.M.accentWash);

  const ui = evaluate(compile("components/MangaUI.tsx", isDev), {
    ...imports, "expo-image": {}, "../lib/motion": {}, "./Shimmer": {},
    "../lib/i18n": { t: {} }, "../lib/cardLayout": { CARD_LAYOUTS: ["compact", "comfortable", "list"] },
  });
  const controls = ui.MangaLayoutControl({ layout: "comfortable", onChange() {} }).props.children;
  assert.equal(flatStyle(controls[1]).backgroundColor, theme.M.ink, "selected controls must retain their dark panel");
  const tile = ui.MangaCardTile({ title: "Title", width: 320, layout: "list", onPress() {} });
  assert.equal(flatStyle(tile.props.children[0]).flexDirection, "row-reverse", "Android card lost its row layout");

  for (const file of ["app/(tabs)/manga.tsx", "app/manga/[id].tsx", "app/manga-reader/[chapter].tsx"]) {
    assert.ok(!/require\("nativewind\/jsx(?:-dev)?-runtime"\)/.test(compile(file, isDev)), `${file}: inline styles must use React's JSX runtime`);
  }
  assert.ok(/require\("nativewind\/jsx(?:-dev)?-runtime"\)/.test(compile("components/CatalogCard.tsx", isDev)), "NativeWind className card must keep CSS interop");
}
console.log("Android Pressable: dev/release layouts, panels, selected states and press feedback passed");

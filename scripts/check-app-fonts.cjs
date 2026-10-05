const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// Execute the actual root startup gate with Expo Go's initially missing fonts,
// already embedded native fonts, and a loading failure. No device required.
const code = ts.transpileModule(fs.readFileSync("app/_layout.tsx", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const expected = require("../app.json").expo.plugins
  .find(plugin => Array.isArray(plugin) && plugin[0] === "expo-font")[1].fonts
  .map(file => path.basename(file, ".ttf")).sort();

function startup(loaded, error = null) {
  const exports = {}, effects = [], warnings = [];
  let hides = 0;
  const jsx = (type, props) => ({ type, props });
  vm.runInNewContext(code, {
    exports, setTimeout: () => 1, clearTimeout() {},
    console: { warn: (...args) => warnings.push(args) },
    require(name) {
      if (name === "react") return { useEffect: fn => effects.push(fn) };
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "react-native") return { I18nManager: { isRTL: false } };
      if (name === "expo-splash-screen") return {
        preventAutoHideAsync: () => Promise.resolve(),
        hideAsync: () => { hides++; return Promise.resolve(); },
      };
      if (name === "expo-font") return { useFonts(map) {
        assert.deepEqual(Object.keys(map).sort(), expected, "all embedded font aliases need a runtime fallback");
        for (const [alias, source] of Object.entries(map)) {
          assert.equal(path.basename(source, ".ttf"), alias, "font aliases must match their bundled files");
        }
        return [loaded, error];
      } };
      if (name.endsWith(".ttf")) {
        const file = path.resolve("app", name);
        assert.ok(fs.existsSync(file), `Missing local font: ${file}`);
        return file;
      }
      return {};
    },
  });
  const tree = exports.default();
  effects.forEach(fn => fn());
  return { tree, hides, warnings };
}

const waiting = startup(false);
assert.equal(waiting.tree, null, "Expo Go must wait for fonts before mounting screens");
assert.equal(waiting.hides, 0, "splash must remain while fonts load");
const ready = startup(true);
assert.ok(ready.tree, "screens must mount once fonts are ready (including native embedded fonts)");
assert.equal(ready.hides, 1);
assert.equal(ready.warnings.length, 0);
const failed = startup(false, new Error("Font load failed"));
assert.ok(failed.tree, "a font failure must not trap the user behind the splash");
assert.equal(failed.hides, 1);
assert.equal(failed.warnings.length, 1, "font failures must be reported");
console.log("App font startup: OK (Expo Go, embedded fonts, failure recovery)");

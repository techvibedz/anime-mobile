const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

// Execute the real updater with native imports stubbed: a local Expo session
// must never fetch a release, download an update, or request a reload.
let externalCalls = 0;
const blocked = new Proxy({}, { get: () => () => { externalCalls++; throw new Error("Unexpected update operation"); } });
const exportsObject = {};
const source = ts.transpileModule(fs.readFileSync("lib/updater.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
vm.runInNewContext(source, {
  exports: exportsObject,
  require: () => blocked,
  __DEV__: true,
  fetch: () => { externalCalls++; throw new Error("Unexpected release fetch"); },
});

(async () => {
  assert.equal(await exportsObject.checkForApkUpdate(), null);
  assert.equal(await exportsObject.checkForOtaUpdate(), null);
  assert.equal(externalCalls, 0, "Expo development must not contact the updater");
  console.log("Expo development update isolation passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });

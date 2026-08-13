const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const target = path.join(
  __dirname,
  "..",
  "node_modules",
  "expo-video",
  "android",
  "src",
  "main",
  "java",
  "expo",
  "modules",
  "video",
  "utils",
  "DataSourceUtils.kt",
);
const source = fs.readFileSync(target, "utf8");

assert.match(source, /OkHttpClientProvider\.getOkHttpClient\(\)\.newBuilder\(\)\.build\(\)/);
assert.doesNotMatch(source, /val client = OkHttpClient\.Builder\(\)\.build\(\)/);
console.log("expo-video DoH client check passed");

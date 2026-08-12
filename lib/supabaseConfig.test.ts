import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./supabase.ts", import.meta.url), "utf8");

assert.match(source, /process\.env\.EXPO_PUBLIC_SUPABASE_URL\s*\|\|\s*"https:\/\/iwrphgttbjqifstqttqm\.supabase\.co"/);
assert.match(source, /process\.env\.EXPO_PUBLIC_SUPABASE_ANON_KEY\s*\|\|\s*"eyJ/);
assert.doesNotMatch(source, /placeholder\.supabase\.co|placeholder-anon-key/);

console.log("supabase config tests passed");

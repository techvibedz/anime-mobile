// Syntax-checks the injected WebView JS strings in lib/scraper/scripts.ts.
// tsc validates the TS file but not the JS inside the template literals —
// a typo there only surfaces as a silent scrape failure on device.
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "../lib/scraper/scripts.ts"), "utf8");

// Pull every `const NAME = `...`;` template literal out and evaluate it the
// same way TS would, with the interpolations it uses.
function grab(name) {
  const re = new RegExp(`const ${name}(?:: ?[^=]+)? = (?:\\(want: string\\) => )?\`([\\s\\S]*?)\`;`, "m");
  const m = src.match(re);
  if (!m) throw new Error(`could not find ${name}`);
  return m[1];
}

const HELPERS = eval("`" + grab("HELPERS") + "`");
const WIT_BASE = "https://witanime.you";
const UP4_BASE = "https://w1.anime4up.rest";
const want = "test title";
// The real generated classifier is syntax-checked by videoProviders.test.ts.
const providerClassifierScript = () => "function provider(url){return 'generic';}";

const names = [
  "EXTRACT_HOME_WIT", "EXTRACT_HOME_4UP", "EXTRACT_EPISODES_WIT",
  "EXTRACT_EPISODES_4UP", "EXTRACT_TITLE_MATCH", "EXTRACT_SEARCH",
  "EXTRACT_RECENT", "EXTRACT_LISTING", "EXTRACT_VIDEO_SERVERS",
  "HOOK_VIDEO_BEFORE", "COLLECT_VIDEO_AFTER",
];

let failed = false;
for (const name of names) {
  try {
    const code = eval("`" + grab(name) + "`");
    new Function(code); // throws on syntax error
    console.log(`OK    ${name} (${code.length} chars)`);
  } catch (e) {
    failed = true;
    console.error(`FAIL  ${name}: ${e.message}`);
  }
}
process.exit(failed ? 1 : 0);

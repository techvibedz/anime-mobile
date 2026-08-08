// Validates that ScraperHost's wrapOnce() wrapper yields syntactically valid
// JS for every injected after-load script in lib/scraper/scripts.ts.
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "../lib/scraper/scripts.ts"), "utf8");

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
const providerClassifierScript = () => "function provider(url){return 'generic';}";

// Mirror of wrapOnce() in lib/scraper/ScraperHost.tsx.
function wrapOnce(job) {
  const key = `__sj_${job.id}`;
  return `(function(){try{if(window.${key})return true;window.${key}=1;}catch(e){}\n${job.injectAfter}\n})();true;`;
}

const names = [
  "EXTRACT_HOME_WIT", "EXTRACT_HOME_4UP", "EXTRACT_EPISODES_WIT",
  "EXTRACT_EPISODES_4UP", "EXTRACT_TITLE_MATCH", "EXTRACT_SEARCH",
  "EXTRACT_RECENT", "EXTRACT_LISTING", "EXTRACT_VIDEO_SERVERS",
  "COLLECT_VIDEO_AFTER",
];

let failed = false;
for (const n of names) {
  try {
    const script = eval("`" + grab(n) + "`");
    new Function(wrapOnce({ id: "s1", injectAfter: script }));
    console.log(`OK    ${n} (wrapped)`);
  } catch (e) {
    console.log(`FAIL  ${n} (wrapped): ${e.message}`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);

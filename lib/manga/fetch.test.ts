import assert from "node:assert/strict";
import { isMangaHostDown, markHostFailed, markHostOk, resetMangaHostBreaker } from "./fetch";

// Per-host breaker: a dead source (hijala Turnstile, mangawy 500s) must stop
// queueing 28s WebView jobs on the shared serial scraper bus.

resetMangaHostBreaker();
const a = "https://hijala.com/solo-leveling/";
const b = "https://www.hijala.com/?s=x";
assert.equal(isMangaHostDown(a), false);
markHostFailed(a);
assert.equal(isMangaHostDown(a), false, "one failure is not enough");
markHostFailed(b); // www. folds into the same host
assert.equal(isMangaHostDown(a), true, "opens after 2 consecutive failures");
assert.equal(isMangaHostDown("https://3asq.online/manga/x/"), false, "other hosts unaffected");
markHostOk("https://hijala.com/");
assert.equal(isMangaHostDown(a), false, "any success closes it");
markHostFailed(a);
assert.equal(isMangaHostDown(a), false, "success reset the count");
console.log("manga fetch breaker OK");
process.exit(0);

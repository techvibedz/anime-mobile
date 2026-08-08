import assert from "node:assert";
import { shouldShowSynopsis } from "./animeDetail";

assert.equal(shouldShowSynopsis("https://anime3rb.com/titles/one-piece", "Unwanted source text"), false);
assert.equal(shouldShowSynopsis("https://witanime.cyou/anime/one-piece", "Real synopsis"), true);
assert.equal(shouldShowSynopsis("https://anime4up.cam/anime/one-piece", ""), false);

console.log("anime detail tests passed");

import assert from "node:assert";
import { shouldShowSynopsis, synopsisForDisplay } from "./animeDetail";

assert.equal(shouldShowSynopsis("https://anime3rb.com/titles/one-piece", "Real synopsis"), true);
assert.equal(shouldShowSynopsis("https://witanime.cyou/anime/one-piece", "Real synopsis"), true);
assert.equal(shouldShowSynopsis("https://anime4up.cam/anime/one-piece", "Real synopsis"), true);
assert.equal(shouldShowSynopsis("https://witanime.you/anime/one-piece", ""), false);

const top = "هذه هي القصة الحقيقية التي يجب أن تبقى ظاهرة للمستخدم.";
assert.equal(synopsisForDisplay(`${top}\n\nأسماء أخرى: اسم طويل ووصف غير مرغوب`), top);
assert.equal(synopsisForDisplay(`${top}\n\nالتقييم: 8.4 12 حلقات وصف طويل غير مرغوب`), top);
assert.equal(synopsisForDisplay(`${top} ${top}`), top);
assert.equal(synopsisForDisplay(top), top);

console.log("anime detail tests passed");

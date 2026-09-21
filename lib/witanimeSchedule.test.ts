// Checks for the witanime schedule parser (the pure HTML parse behind the
// schedule screen). The rows are duplicated across the page's list + grid
// views, so de-duping per weekday is part of the contract.
import assert from "node:assert/strict";
import { parseWitanimeSchedule } from "./scraper/direct";

const ROW = (slug: string, title: string, ep: string, score: string) => `
  <a href="https://witanime.site/anime/${slug}" class="group flex items-center gap-4">
    <div class="relative h-20 w-14"><img src="https://images.witanime.site/posters/${slug}.jpg" alt="${title}"></div>
    <div class="min-w-0 flex-1">
      <h3 class="truncate font-semibold">${title}</h3>
      <div class="mt-1 flex gap-2"><span>TV</span><span>الحلقة ${ep}</span></div>
    </div>
    <div dir="ltr" class="flex shrink-0"><span class="text-sm font-semibold text-white">${score}</span></div>
  </a>`;

const html =
  `<h2 id="schedule-day-Mon">الاثنين</h2>` +
  ROW("grand-blue-season-3", "Grand Blue Season 3", "12", "7.9") +
  ROW("grand-blue-season-3", "Grand Blue Season 3", "12", "7.9") +
  `<h2 id="schedule-day-Sat">السبت</h2>` +
  ROW("one-piece", "One Piece", "1122", "8.7");

const entries = parseWitanimeSchedule(html);
assert.equal(entries.length, 2, "duplicate rows within a day must be de-duped");
assert.deepEqual(entries[0], {
  weekday: "Mon",
  title: "Grand Blue Season 3",
  href: "https://witanime.site/anime/grand-blue-season-3",
  image: "https://images.witanime.site/posters/grand-blue-season-3.jpg",
  episode: 12,
  format: "TV",
  score: 7.9,
});
assert.equal(entries[1].weekday, "Sat");
assert.equal(entries[1].episode, 1122);
assert.equal(parseWitanimeSchedule("").length, 0);
assert.equal(parseWitanimeSchedule("<html>no schedule</html>").length, 0);
console.log("witanime schedule parser tests passed");

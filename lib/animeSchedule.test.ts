import assert from "node:assert/strict";
import { parseAnimeScheduleHtml } from "./animeSchedule";

const html = `
<div showID="a1" route="show-one" episodes="12" airedEpisode="7" mediaType="tv" class="timetable-column-show unaired">
  <img data-src="https://img.test/show.jpg?w=360&amp;q=90">
  <h2 class="show-title-bar">Show &amp; One</h2>
  <span class="show-episode">Ep 7</span>
  <time datetime="2026-09-09T13:30&#43;01:00" class="show-air-time">13:30</time>
  <span class="air-type-text" airType="raw">JPN</span>
</div>
<div showID="a2" route="show-one" episodes="12" airedEpisode="7" mediaType="tv" class="timetable-column-show">
  <h2 class="show-title-bar">Show &amp; One</h2>
  <time datetime="2026-09-09T15:30+01:00" class="show-air-time">15:30</time>
  <span class="air-type-text" airType="sub">SUB</span>
</div>
<div showID="a3" route="donghua" episodes="20" airedEpisode="3" mediaType="ona-chinese" chinese="true" class="timetable-column-show">
  <h2 class="show-title-bar">Donghua</h2>
  <time datetime="2026-09-10T10:00+01:00" class="show-air-time">10:00</time>
  <span class="air-type-text" airType="raw">JPN</span>
</div>`;

const items = parseAnimeScheduleHtml(html);
assert.equal(items.length, 1);
assert.equal(items[0].title, "Show & One");
assert.equal(items[0].episode, 7);
assert.equal(items[0].airingAt, Date.parse("2026-09-09T13:30+01:00") / 1000);
assert.equal(items[0].image, "https://img.test/show.jpg?w=360&q=90");
assert.equal(items[0].format, "TV");

console.log("animeSchedule parser: ok");

// VTT parser tests — the Anime4up sidecar subtitle format (live sample).
// Run:  npx tsx lib/subtitles.test.ts

import assert from "node:assert";
import { cueAt, parseTimestamp, parseVtt } from "./subtitles";

assert.equal(parseTimestamp("00:11.080"), 11.08);
assert.equal(parseTimestamp("02:02.740"), 122.74);
assert.equal(parseTimestamp("1:02:03,500"), 3723.5);
assert.equal(parseTimestamp("nonsense"), null);

// Live Anime4up VTT shape: WEBVTT header, <b>/<i> tags, RTL Arabic text.
const VTT = [
  "WEBVTT",
  "",
  "00:11.080 --> 00:12.960",
  "<b>\u202bأخرجوهم من هنا!</b>",
  "",
  "1",
  "00:13.340 --> 00:16.050",
  "<b><i>\u202bأليس هذا الفتى ممسوسًا؟</i></b>",
  "",
  "NOTE this is a comment block",
  "",
  "00:20.130 --> 00:21.720",
  "line one<br>line two &amp; more",
].join("\n");

const cues = parseVtt(VTT);
assert.equal(cues.length, 3);
assert.equal(cues[0].text, "\u202bأخرجوهم من هنا!");
assert.equal(cues[1].start, 13.34);
assert.equal(cues[2].text, "line one\nline two & more");

assert.equal(cueAt(cues, 0), null);
assert.equal(cueAt(cues, 11.5), "\u202bأخرجوهم من هنا!");
assert.equal(cueAt(cues, 12.0), "\u202bأخرجوهم من هنا!");
assert.equal(cueAt(cues, 12.5), "\u202bأخرجوهم من هنا!"); // still inside cue 1
assert.equal(cueAt(cues, 13.1), null); // between cues
assert.equal(cueAt(cues, 20.5), "line one\nline two & more");
assert.equal(cueAt(cues, 999), null);
assert.equal(cueAt([], 5), null);

console.log("subtitle tests passed");

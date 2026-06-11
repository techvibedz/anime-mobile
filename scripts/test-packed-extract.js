// One-off check: the packed-JS extractor inside COLLECT_VIDEO_AFTER must
// unpack genuine Dean-Edwards packer output (mp4upload-style player.src).
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "../lib/scraper/scripts.ts"), "utf8");
const m = src.match(/const COLLECT_VIDEO_AFTER = `([\s\S]*?)`;/m);
if (!m) throw new Error("COLLECT_VIDEO_AFTER not found");
const code = eval("`" + m[1] + "`");

// Pull the self-contained extractor functions out of the IIFE body.
const start = code.indexOf("  function isDecoy");
const end = code.indexOf("  function pickHooked");
const fns = code.slice(start, end);
const sandbox = new Function(fns + "\nreturn { extractPackedJS: extractPackedJS, extractJWPlayer: extractJWPlayer };")();

// Genuine packer shape: nested braces in the body, trailing ,0,{}) args.
const html =
  "<html><script>" +
  "eval(function(p,a,c,k,e,d){e=function(c){return c.toString(36)};if(!''.replace(/^/,String)){while(c--){d[c.toString(a)]=k[c]||c.toString(a)}k=[function(e){return d[e]}];e=function(){return'\\\\w+'};c=1};while(c--){if(k[c]){p=p.replace(new RegExp('\\\\b'+e(c)+'\\\\b','g'),k[c])}}return p}" +
  "('0.1({2:\"video/a\",3:\"4://5.6:7/8/9.a\"});',36,11,'player|src|type|src|https|s14|mp4upload.com|282|d|video|mp4'.split('|'),0,{}))" +
  "</script></html>";

const url = sandbox.extractPackedJS(html);
console.log("extracted:", url);
if (url !== "https://s14.mp4upload.com:282/d/video.mp4") {
  console.error("FAIL: wrong or missing URL");
  process.exit(1);
}
console.log("OK");

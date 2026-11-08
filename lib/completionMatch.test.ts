// completionMatch tests — the "watched the finale but a stale duplicate record
// shows no badge" path. Run:  npx tsx lib/completionMatch.test.ts

import assert from "node:assert";
import { matchingRecords, sameSource, isBlobRecord, buildCompletedList, findContamination, strictMatchingRecords } from "./completionMatch";
// history.ts pulls in react-native; mirror its two normalizers here.
const normAnimeKey = (k: string) => {
  if (!k) return "";
  try {
    const u = new URL(k);
    const labels = u.hostname.replace(/^www\./, "").split(".");
    const sld = labels.length >= 2 ? labels[labels.length - 2] : u.hostname;
    return (sld + u.pathname).replace(/\/+$/, "").toLowerCase();
  } catch { return k.trim().toLowerCase(); }
};
const animeTitleKey = (t: string | null | undefined) => (t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const rec = (name: string, hrefs: string[], titles: string[]) => ({ name, hrefs, titles });
const names = (records: { name: string }[]) => records.map((r) => r.name);
const keys = (...k: string[]) => new Set(k);

// No keys → nothing matches.
assert.deepEqual(matchingRecords([rec("a", ["h1"], ["t1"])], keys(), keys()), []);

// Href key hit.
assert.deepEqual(
  matchingRecords([rec("a", ["h1"], []), rec("b", ["h2"], [])], keys("h2"), keys()),
  [rec("b", ["h2"], [])],
);

// Title key is the fallback when no href matches.
assert.deepEqual(
  names(matchingRecords([rec("a", ["h1"], ["title a"])], keys("nope"), keys("title a"))),
  ["a"],
);

// ALL matches are returned, not just the first: one record via href, a
// duplicate of the same anime via title (the regression this guards — only
// updating the first copy is what left badges off).
assert.deepEqual(
  names(
    matchingRecords(
      [rec("href-copy", ["h1"], []), rec("title-copy", [], ["title a"])],
      keys("h1"),
      keys("title a"),
    ),
  ),
  ["href-copy", "title-copy"],
);

// Unrelated records are never swept in.
assert.deepEqual(matchingRecords([rec("other", ["h9"], ["t9"])], keys("h1"), keys("title a")), []);

// Feed items may only raise lastEpNum from the record's own (anchor) source.
assert.equal(sameSource("witanime/anime/x", "witanime/anime/y"), true);
assert.equal(sameSource("anime4up/anime/x", "witanime/anime/x"), false);
assert.equal(sameSource("", "witanime/anime/x"), true);

// Blob detection: the real One Piece/Mushoku residue vs a normal 3-source record.
const id = (v: string) => v;
assert.equal(isBlobRecord({ hrefs: ["w/anime/x", "a/anime/x-tv", "r/titles/x"], titles: ["x", "x 2nd"] }, id, id), false);
assert.equal(isBlobRecord({
  hrefs: ["w/anime/mushoku-iii", "w/anime/mushoku", "w/anime/one-piece", "a/anime/one-piece-gfjgfh", "w/anime/one-piece-heroines", "w/anime/eris"],
  titles: ["mushoku iii", "one piece", "one piece heroines", "mushoku", "eris"],
}, id, id), true);

// Completed shelf: finished only, one per anime (two source records of the same
// title collapse), newest first, poster borrowed by href or title.
{
  const lower = (v: string) => v.toLowerCase();
  const recs = [
    { key: "w/frieren", hrefs: ["w/frieren"], titles: ["Frieren"], finished: true, updatedAt: 1 },
    { key: "a/frieren-tv", hrefs: ["a/frieren-tv"], titles: ["frieren"], finished: true, updatedAt: 3 },
    { key: "w/bleach", hrefs: ["w/bleach"], titles: ["Bleach"], finished: false, updatedAt: 9 },
    { key: "w/naruto", hrefs: ["w/naruto"], titles: [], finished: true, updatedAt: 2 },
  ];
  const posters = [
    { title: "Naruto", href: "W/NARUTO", image: "naruto.jpg" },
    { title: "FRIEREN", href: "x/other", image: "frieren.jpg" },
  ];
  const out = buildCompletedList(recs, posters, lower, lower);
  assert.deepEqual(out.map((e) => [e.title, e.image]), [["FRIEREN", "frieren.jpg"], ["Naruto", "naruto.jpg"]]);
  assert.deepEqual(buildCompletedList(recs, [], lower, lower).map((e) => e.image), [null, null], "no poster → null, never a crash");
}


// ── Real data 2026-11-08: One Piece links polluting other anime ──
{
  const r = (key: string, hrefs: string[], titles: string[], lastEpNum = 1180) =>
    ({ key, hrefs, titles, lastEpNum, finished: true, updatedAt: 1 });
  const op = r("witanime/anime/one-piece", ["https://witanime.you/anime/one-piece/", "https://w1.anime4up.rest/anime/one-piece-gfjgfh/"], ["One Piece"]);
  const op4 = r("anime4up/anime/one-piece-gfjgfh", ["https://w1.anime4up.rest/anime/one-piece-gfjgfh/", "https://witanime.site/anime/one-piece"], ["One Piece"]);
  const heroines = r("witanime/anime/one-piece-heroines", ["https://witanime.you/anime/one-piece-heroines/", "https://w1.anime4up.rest/anime/one-piece-gfjgfh/", "https://witanime.you/anime/one-piece/"], ["One Piece: Heroines", "One Piece"]);
  const mushoku = r("witanime/anime/mushoku-tensei-iii-isekai-ittara-honki-dasu",
    ["https://witanime.you/anime/mushoku-tensei-iii-isekai-ittara-honki-dasu/", "https://anime3rb.com/titles/mushoku-tensei-iii-isekai-ittara-honki-dasu", "https://witanime.you/anime/one-piece/", "https://w1.anime4up.rest/anime/one-piece-gfjgfh/"],
    ["Mushoku Tensei III: Isekai Ittara Honki Dasu", "One Piece"]);
  const all = [op, op4, heroines, mushoku];

  const { cleaned } = findContamination(all, normAnimeKey, animeTitleKey);
  assert.deepEqual([...cleaned.keys()].sort(), [heroines.key, mushoku.key].sort(), "only the polluted records are flagged");
  assert.deepEqual(cleaned.get(mushoku.key)!.titles, ["Mushoku Tensei III: Isekai Ittara Honki Dasu"]);
  assert.equal(cleaned.get(mushoku.key)!.hrefs.length, 2, "One Piece links stripped, own anime3rb link kept");
  assert.deepEqual(cleaned.get(heroines.key)!.titles, ["One Piece: Heroines"]);

  // A One Piece page write touches only real One Piece copies.
  const hk = new Set(["witanime/anime/one-piece", "anime4up/anime/one-piece-gfjgfh"]);
  const tk = new Set([animeTitleKey("One Piece")]);
  assert.deepEqual(
    strictMatchingRecords(all, "witanime/anime/one-piece", hk, tk, normAnimeKey, animeTitleKey).map((x) => x.key).sort(),
    [op.key, op4.key].sort(),
  );
  // A season-3 page whose anime4up lookup resolved season 1 must not match the S1 record.
  const s1 = r("anime4up/anime/mushoku-tensei-isekai-ittara-honki-dasu", ["https://w1.anime4up.rest/anime/mushoku-tensei-isekai-ittara-honki-dasu/"], ["Mushoku Tensei: Isekai Ittara Honki Dasu"], 23);
  assert.deepEqual(
    strictMatchingRecords([s1], "witanime/anime/mushoku-tensei-iii-isekai-ittara-honki-dasu",
      new Set(["anime4up/anime/mushoku-tensei-isekai-ittara-honki-dasu"]), new Set([animeTitleKey("Mushoku Tensei III: Isekai Ittara Honki Dasu")]),
      normAnimeKey, animeTitleKey),
    [],
  );

  // Completed shelf: copies of one anime collapse to a single card.
  const shelf = buildCompletedList([op, op4], [{ title: "One Piece", href: "https://witanime.you/anime/one-piece/", image: "op.jpg" }], normAnimeKey, animeTitleKey);
  assert.equal(shelf.length, 1);
  // Legit cross-source copies (same primary title) are NOT treated as pollution.
  assert.equal(findContamination([op, op4], normAnimeKey, animeTitleKey).cleaned.size, 0);
}

console.log("completionMatch.test.ts — all assertions passed");

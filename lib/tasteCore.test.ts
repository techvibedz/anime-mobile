import assert from "node:assert";
import {
  bottomAffinities,
  buildProfile,
  classifyAnime,
  franchiseKey,
  groupForTaste,
  lengthBucket,
  passesFilter,
  preferredLength,
  profileSignature,
  rankTaste,
  scoreCandidate,
  topAffinities,
  type TasteAnime,
  type TasteEntry,
  type TasteMedia,
} from "./tasteCore";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 11);

const media = (id: number, title: string, genres: string[], extra: Partial<TasteMedia> = {}): TasteMedia => ({
  id, title, titleEnglish: null, image: null, format: "TV", episodes: 12, status: "FINISHED",
  averageScore: 78, popularity: 50000, seasonYear: 2020, genres, tags: [], studios: [], ...extra,
});

const anime = (over: Partial<TasteAnime> & { media?: TasteMedia | null }): TasteAnime => ({
  key: over.key ?? String(over.media?.id ?? Math.random()), title: over.media?.title ?? "x", href: "", image: "",
  watchedEps: 0, touchedEps: 0, maxEp: 0, firstAt: NOW - 30 * DAY, lastAt: NOW - DAY, activeDays: 1, bestDay: 1,
  finished: false, marked: false, caughtUp: false, ...over,
});

/* groupForTaste */
const e = (title: string, ep: number, daysAgo: number, completed = true, hoursOffset = 0): TasteEntry => ({
  animeTitle: title, animeHref: `https://w/anime/${title}/`, image: "img", epNum: ep,
  updatedAt: NOW - daysAgo * DAY + hoursOffset * 3_600_000, completed,
});
const groups = groupForTaste(
  [e("A", 1, 10), e("A", 2, 10, true, 1), e("A", 3, 10, true, 2), e("A", 3, 10, true, 3), e("A", 4, 9), e("A", 5, 2, false), e("B", 1, 40)],
  (x) => x.animeTitle,
);
assert.equal(groups.length, 2);
const ga = groups.find((g) => g.key === "A")!;
assert.equal(ga.watchedEps, 4, "duplicate episode counted once, unfinished not counted");
assert.equal(ga.touchedEps, 5);
assert.equal(ga.maxEp, 5);
assert.equal(ga.activeDays, 2);
assert.equal(ga.bestDay, 3);
assert.equal(groups[0].key, "A", "newest activity first");

/* classifyAnime */
const fin = classifyAnime(anime({ media: media(1, "F", []), watchedEps: 12, activeDays: 6, bestDay: 2, lastAt: NOW - 5 * DAY }), NOW);
assert.equal(fin.verdict, "finished");
assert.ok(fin.weight > 2.5);
const binged = classifyAnime(anime({ media: media(2, "B", []), watchedEps: 12, activeDays: 2, bestDay: 8 }), NOW);
assert.equal(binged.verdict, "binged");
assert.ok(binged.weight > fin.weight);
const marked = classifyAnime(anime({ media: null, marked: true, watchedEps: 0 }), NOW);
assert.equal(marked.verdict, "finished", "hand-marked counts as finished");
const dropped = classifyAnime(anime({ media: media(3, "D", [], { episodes: 24 }), watchedEps: 2, touchedEps: 3, maxEp: 3, lastAt: NOW - 60 * DAY }), NOW);
assert.equal(dropped.verdict, "dropped");
assert.ok(dropped.weight < -1);
const sampledOld = classifyAnime(anime({ watchedEps: 0, touchedEps: 1, maxEp: 1, lastAt: NOW - 60 * DAY }), NOW);
assert.equal(sampledOld.verdict, "dropped");
assert.ok(sampledOld.weight > dropped.weight, "one opened episode is weaker evidence than three");
const watching = classifyAnime(anime({ watchedEps: 5, touchedEps: 5, lastAt: NOW - 2 * DAY, activeDays: 4, bestDay: 2 }), NOW);
assert.equal(watching.verdict, "watching");
const longStall = classifyAnime(anime({ media: media(4, "OP", [], { episodes: 1100 }), watchedEps: 300, maxEp: 300, lastAt: NOW - 90 * DAY, activeDays: 60 }), NOW);
assert.equal(longStall.verdict, "stalled");
assert.ok(longStall.weight > 0, "putting a 1000-ep show down after 300 eps is not dislike");
const caught = classifyAnime(anime({ caughtUp: true, watchedEps: 6, lastAt: NOW - 40 * DAY }), NOW);
assert.equal(caught.verdict, "watching", "caught up with an airing show is never dropped");

/* lengthBucket */
assert.equal(lengthBucket({ format: "MOVIE", episodes: 1 }), "movie");
assert.equal(lengthBucket({ format: "TV", episodes: 12 }), "short");
assert.equal(lengthBucket({ format: "TV", episodes: 25 }), "medium");
assert.equal(lengthBucket({ format: "TV", episodes: 64 }), "long");

/* buildProfile — likes psychological thrillers, drops long romance */
const psych = (id: number, title: string) => media(id, title, ["Psychological", "Thriller", "Mystery"], {
  tags: [{ name: "Tragedy", rank: 80 }, { name: "Male Protagonist", rank: 90 }],
  studios: ["Madhouse"],
});
const romance = (id: number, title: string) => media(id, title, ["Romance", "Comedy", "Slice of Life"], { episodes: 50, tags: [{ name: "School", rank: 85 }] });
const history: TasteAnime[] = [
  anime({ key: "dn", media: psych(10, "Death Note"), finished: true, watchedEps: 37, activeDays: 4, bestDay: 12, lastAt: NOW - 10 * DAY }),
  anime({ key: "mon", media: psych(11, "Monster"), watchedEps: 74, lastAt: NOW - 20 * DAY, activeDays: 30, bestDay: 3, finished: true }),
  anime({ key: "r1", media: romance(20, "Kimi ni Todoke"), watchedEps: 2, touchedEps: 3, maxEp: 3, lastAt: NOW - 80 * DAY }),
  anime({ key: "r2", media: romance(21, "Toradora"), watchedEps: 1, touchedEps: 2, maxEp: 2, lastAt: NOW - 50 * DAY }),
];
const p = buildProfile(history, NOW);
assert.ok(p.genres.Psychological > 0.4, `psych affinity ${p.genres.Psychological}`);
assert.ok(p.genres.Romance < 0, "dropped romance is a dislike");
assert.ok(p.tags.Tragedy > 0);
assert.equal(p.tags["Male Protagonist"], undefined, "trivia tags ignored");
assert.equal(p.stats.finished, 2);
assert.equal(p.stats.dropped, 2);
assert.equal(p.stats.completionRate, 50);
assert.equal(p.stats.dropAt, 2);
assert.equal(p.seeds[0].anilistId, 10, "binged finished show is the strongest seed");
assert.ok(p.seenIds.has(20) && p.seenIds.has(10));
assert.deepEqual(topAffinities(p.genres, 2).map((x) => x.name).sort(), ["Psychological", "Thriller"].sort());
assert.ok(bottomAffinities(p.genres, 3).some((x) => x.name === "Romance"));
assert.ok(p.avoided.includes("Romance"), `avoided ${p.avoided}`);
assert.ok(!p.avoided.includes("Psychological"));

/* A sampler: finished 2 action shows, opened (and left) 8 others that also
   have Action. Liked genres must stay positive — sampling ≠ hating. */
const act = (id: number, extra: string[]) => media(id, `S${id}`, ["Action", ...extra]);
const sampler: TasteAnime[] = [
  anime({ key: "f1", media: act(100, ["Fantasy"]), finished: true, watchedEps: 12, activeDays: 5, bestDay: 3, lastAt: NOW - 20 * DAY }),
  anime({ key: "f2", media: act(101, ["Fantasy"]), finished: true, watchedEps: 12, activeDays: 5, bestDay: 3, lastAt: NOW - 30 * DAY }),
  ...Array.from({ length: 8 }, (_, i) => anime({ key: `s${i}`, media: act(200 + i, ["Comedy"]), watchedEps: 0, touchedEps: 1, maxEp: 1, lastAt: NOW - 60 * DAY })),
];
const ps = buildProfile(sampler, NOW);
assert.ok(ps.genres.Fantasy > 0.2, `fantasy ${ps.genres.Fantasy}`);
assert.ok(ps.genres.Action > 0, `action ${ps.genres.Action}`);
assert.ok(!ps.avoided.includes("Action"), "a genre in every finished show is not avoided");
assert.ok(ps.avoided.includes("Comedy"));
assert.equal(preferredLength(p), "short", "finished 12-ep shows, dropped 50-ep ones");
assert.ok(p.lengths.long < 0, "dropping long shows counts against long");

/* hidden ("not interested") pulls genres down */
const p2 = buildProfile(history, NOW, [{ id: 99, genres: ["Psychological"], tags: [] }]);
assert.ok(p2.genres.Psychological < p.genres.Psychological);
assert.ok(p2.seenIds.has(99));

/* scoring: a psych thriller beats a romance, endorsement adds a "because" reason */
const cPsych = media(30, "Steins;Gate", ["Psychological", "Thriller", "Sci-Fi"], { averageScore: 90, tags: [{ name: "Tragedy", rank: 70 }] });
const cRom = media(31, "Kaguya-sama", ["Romance", "Comedy"], { averageScore: 85 });
const sPsych = scoreCandidate(cPsych, p, [{ seedId: 10, rating: 400 }]);
const sRom = scoreCandidate(cRom, p);
assert.ok(sPsych.score > sRom.score);
assert.ok(sPsych.match > sRom.match);
assert.ok(sPsych.match <= 99 && sRom.match >= 1);
assert.equal(sPsych.reasons[0].kind, "because");
assert.deepEqual(sPsych.reasons[0], { kind: "because", seed: "Death Note", verdict: "binged" });
assert.ok(sPsych.reasons.some((r) => r.kind === "genres"));
assert.ok(sPsych.reasons.length <= 3);

/* ranking: excludes seen + adult + filtered, diversifies franchises */
const cands = [
  cPsych,
  cRom,
  media(10, "Death Note", ["Psychological"]), // seen
  media(32, "Steins;Gate 0", ["Psychological", "Thriller", "Sci-Fi"], { averageScore: 85 }),
  media(33, "Adult", ["Hentai"]),
  media(34, "Erased", ["Mystery", "Psychological", "Thriller"], { averageScore: 82 }),
  media(35, "Perfect Blue", ["Psychological", "Thriller", "Horror"], { format: "MOVIE", episodes: 1, averageScore: 86 }),
];
const ranked = rankTaste(cands, p, { endorsements: new Map([[30, [{ seedId: 10, rating: 400 }]]]) });
const ids = ranked.map((r) => r.media.id);
assert.ok(!ids.includes(10), "already watched never comes back");
assert.ok(!ids.includes(33), "adult filtered");
assert.equal(ids[0], 30);
assert.ok(ids.indexOf(32) > ids.indexOf(34), "same-franchise follow-up is pushed below a fresh pick");
assert.equal(ids[ids.length - 1], 31, "disliked genre ranks last");
const movies = rankTaste(cands, p, { filter: "movie" });
assert.deepEqual(movies.map((r) => r.media.id), [35]);
assert.ok(passesFilter(media(1, "x", [], { episodes: 12 }), "short"));
assert.ok(!passesFilter(media(1, "x", [], { episodes: 24 }), "short"));
assert.ok(passesFilter(media(1, "x", [], { status: "RELEASING" }), "airing"));
const excl = rankTaste(cands, p, { excluded: (m) => m.id === 30 });
assert.ok(!excl.some((r) => r.media.id === 30));

// Sequels need their prequel seen; ecchi needs an ecchi-leaning history.
const seqUnseen = media(40, "Re:Zero 4th Season", ["Psychological", "Thriller"], { prequelIds: [777] });
const seqSeen = media(41, "Death Note Rewrite", ["Psychological", "Thriller"], { prequelIds: [10] });
const ecchi = media(42, "Ecchi Show", ["Psychological", "Ecchi"]);
const gated = rankTaste([seqUnseen, seqSeen, ecchi], p).map((r) => r.media.id);
assert.deepEqual(gated, [41]);

// Prequel of a watched show (Naruto when Shippuden was watched) is excluded.
const shipp = anime({ key: "sh", media: media(500, "Naruto: Shippuuden", ["Action"], { prequelIds: [501] }), watchedEps: 30, lastAt: NOW - 5 * DAY, activeDays: 10 });
const pn = buildProfile([...history, shipp], NOW);
assert.ok(pn.relatedIds.has(501));
assert.ok(!rankTaste([media(501, "Naruto", ["Action"])], pn).length);

assert.equal(franchiseKey("Steins;Gate 0"), franchiseKey("Steins;Gate"));
assert.notEqual(profileSignature(history, []), profileSignature(history, [5]));

/* empty history is safe */
const empty = buildProfile([], NOW);
assert.equal(empty.stats.analysed, 0);
assert.equal(preferredLength(empty), null);
assert.deepEqual(rankTaste([cPsych], empty).length, 1);

console.log("taste core tests passed");

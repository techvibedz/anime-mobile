// Run: npx tsx lib/manga/coverFallback.test.ts — cases from the 2026-10-21 live cover audit.
import assert from "node:assert/strict";
import { pickAniListCover, type AniListMangaHit } from "./coverFallback";
import { mergeCards } from "./aggregate";

const hit = (english: string | null, romaji: string, cover: string, synonyms: string[] = []): AniListMangaHit =>
  ({ title: { english, romaji }, synonyms, coverImage: { large: cover } });

// Exact title, or an exact official alias, is safe.
assert.equal(pickAniListCover("Jujutsu Kaisen", [hit(null, "Jujutsu Kaisen", "jjk.jpg")]), "jjk.jpg");
assert.equal(pickAniListCover("SSS-Rank Lone Summoner", [hit("The Ultimate Summoner", "Seonggaeui Summoner", "sss.jpg", ["SSS-Rank Lone Summoner"])]), "sss.jpg");
assert.equal(pickAniListCover("Tamed the Monster Prince", [hit("I Tamed the Monster Prince", "x", "tamed.jpg")]), "tamed.jpg", "a dropped leading 'I' still matches");

// A different work must never lend its cover.
assert.equal(pickAniListCover("The Male Lead Is Obsessed With Me", [hit("The Male Lead Is Obsessed with Proposing", "x", "wrong.jpg")]), null);
assert.equal(pickAniListCover("Solo Leveling", [hit("Solo Leveling: Ragnarok", "Na Honjaman Level-Up: Ragnarok", "wrong.jpg")]), null);
assert.equal(pickAniListCover("Anything", []), null);
assert.equal(pickAniListCover("Jujutsu Kaisen", [{ title: { romaji: "Jujutsu Kaisen" }, coverImage: null }]), null, "no cover, no pick");

// Merging keeps the losing source's cover as a fallback instead of discarding it.
const merged = mergeCards([
  { source: "mangalik", id: "a", title: "SSS-Rank Lone Summoner", cover: "https://io.mangalik.net/dead.jpg", latest: "الفصل 120", rating: "4.5", status: "مستمر", type: "مانهوا" },
  { source: "mangawy", id: "b", title: "SSS-Rank Lone Summoner", cover: "https://img.mangawy.org/covers/ok.webp" },
]);
assert.equal(merged.length, 1);
assert.equal(merged[0].cover, "https://io.mangalik.net/dead.jpg");
assert.deepEqual(merged[0].coverAlts, ["https://img.mangawy.org/covers/ok.webp"]);
const single = mergeCards([{ source: "asq", id: "c", title: "One Piece", cover: "x.jpg" }]);
assert.equal(single[0].coverAlts, undefined, "no alts field when there's nothing to fall back to");

console.log("PASS manga cover fallback");

# Direct Servers And MAL Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore direct-only server selection and resilient MAL rating/detail enrichment without publishing or changing app versions.

**Architecture:** Repair parsing at the existing shared scraper boundaries, then filter candidate servers centrally before the watch screen receives them. Keep Jikan as the primary MAL source, but fall back to MyAnimeList's public search/page data and use AniList only as an ID bridge when title search cannot confidently resolve.

**Tech Stack:** Expo/React Native, TypeScript, hidden WebView scraper, native `fetch`, AsyncStorage, Jikan, AniList GraphQL, MyAnimeList public HTML.

---

### Task 1: Repair And Filter Direct Servers

**Files:**
- Modify: `lib/scraper/direct.ts:521-555,1079-1108,1676-1813`
- Modify: `lib/api.ts:1170-1237,1600-1650`
- Modify: `app/watch/[episode].tsx:44-84`
- Test: `lib/scraper/embedExtract.test.ts`
- Test: `lib/scraper/witFailover.test.ts`

- [ ] **Step 1: Add failing parser tests**

Add checks proving the current Witanime aliases decode and CSS cannot pass as mp4upload media:

```ts
test("mp4upload parser ignores player CSS on the mp4upload host", () => {
  const html = `
    <link href="https://www.mp4upload.com/player/videojs/skins/nuevo/videojs.min.css">
    <script>player.src({src:"${MP4UPLOAD}"});</script>`;
  assert.equal(extractMp4uploadUrl(html), MP4UPLOAD);
});

test("mp4upload parser returns null for CSS-only HTML", () => {
  assert.equal(
    extractMp4uploadUrl('<link href="https://www.mp4upload.com/player/videojs/video.min.css">'),
    null,
  );
});
```

Expose the existing pure Witanime parser and add a fixture using `_zH`/`_zW`; assert it yields the same decoded URL as the old `_zX`/`_zK` shape.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npx --yes tsx lib/scraper/embedExtract.test.ts && npx --yes tsx lib/scraper/witFailover.test.ts`

Expected: the CSS-only test or new-registry test fails against current code.

- [ ] **Step 3: Apply minimal parser repairs**

Use paired aliases rather than replacing support for old pages:

```ts
const zx = html.match(/_zX\s*=\s*"([^"]+)"/) || html.match(/_zH\s*=\s*"([^"]+)"/);
const zk = html.match(/_zK\s*=\s*"([^"]+)"/) || html.match(/_zW\s*=\s*"([^"]+)"/);
```

Export `parseWitServers` for the regression check; do not change its decode loop.

Require an actual media path in mp4upload validation:

```ts
const isMp4upload = (raw: string) => {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    return (host === "mp4upload.com" || host.endsWith(".mp4upload.com")) &&
      url.pathname.toLowerCase().endsWith(".mp4") &&
      !DECOY_RE.test(raw);
  } catch {
    return false;
  }
};
```

Classify `app.videas.fr` and resolve its static media through the existing `fetchEmbed`/`pickMediaUrl` machinery:

```ts
if (/app\.videas\.fr/.test(u)) return "videas";

export async function extractVideas(embedUrl: string) {
  const html = await fetchEmbed(embedUrl, 10000);
  const url = html ? pickMediaUrl(html) : null;
  return url ? { url, type: mediaType(url) } : null;
}
```

- [ ] **Step 4: Filter server candidates at the shared API boundary**

Import `extractVideas`, route it in `resolveVideo`, and filter before adding servers:

```ts
const DIRECT_VIDEO_PROVIDERS = new Set([
  "vid3rb", "streamwish", "videa", "videas",
]);

// First statement inside the existing `for (const s of arr)` loop:
if (!DIRECT_VIDEO_PROVIDERS.has(s.provider)) continue;
```

Update the watch screen's `DIRECT_ONLY` set to the same visible provider names. Embed-only providers must no longer reach the picker.

- [ ] **Step 5: Run focused tests**

Run: `npx --yes tsx lib/scraper/embedExtract.test.ts && npx --yes tsx lib/scraper/witFailover.test.ts`

Expected: all checks pass, including `_zH`/`_zW` and CSS rejection.

### Task 2: Restore MAL Score And Info Details

**Files:**
- Modify: `lib/animeInfo.ts:98-313`
- Create: `lib/animeInfo.test.ts`
- Modify: `package.json:11`

- [ ] **Step 1: Add failing MAL parser tests**

Create compact desktop MAL HTML fixtures and assert the real score and translated fields:

```ts
import assert from "node:assert";
import { parseMalHtml } from "./animeInfo";

const html = `
  <div class="spaceit_pad"><span class="dark_text">Type:</span> TV</div>
  <div class="spaceit_pad"><span class="dark_text">Status:</span> Currently Airing</div>
  <div class="spaceit_pad"><span class="dark_text">Studios:</span> <a>Toei Animation</a></div>
  <span itemprop="ratingValue" class="score-label">8.73</span>`;
const parsed = parseMalHtml(html);
assert.equal(parsed.score, 8.73);
assert.deepEqual(parsed.fields.slice(0, 3), [
  { label: "النوع", value: "مسلسل" },
  { label: "الحالة", value: "يُعرض حالياً" },
  { label: "الاستوديو", value: "Toei Animation" },
]);
assert.equal(parseMalHtml('<span itemprop="ratingValue">N/A</span>').score, null);
```

- [ ] **Step 2: Run the new test and confirm failure**

Run: `npx --yes tsx lib/animeInfo.test.ts`

Expected: FAIL because `parseMalHtml` is not implemented/exported.

- [ ] **Step 3: Implement direct MAL parsing**

Add a small entity/tag cleaner, known-label map, score parser, and `parseMalHtml(html): MalData`. Accept desktop `.spaceit_pad` rows and retain only Type, Episodes, Status, Aired, Premiered, Studios, Source, Duration, Rating, Ranked, and Popularity.

```ts
const MAL_LABELS: Record<string, string> = {
  Type: "النوع", Episodes: "عدد الحلقات", Status: "الحالة",
  Aired: "تاريخ العرض", Premiered: "الموسم", Studios: "الاستوديو",
  Source: "المصدر", Duration: "مدة الحلقة", Rating: "التصنيف العمري",
  Ranked: "الترتيب", Popularity: "الشعبية",
};
```

Reuse `TYPE_AR`, `STATUS_AR`, `SEASON_AR`, `SOURCE_AR`, and `RATING_AR` when translating values.

- [ ] **Step 4: Add the fallback data flow**

After Jikan title-search attempts fail:

1. Query `https://myanimelist.net/search/prefix.json?type=anime&keyword=<clean title>&v=1`.
2. Score returned names with the existing `pickBest` logic and reject weak unrelated matches.
3. Use the result's actual MAL score immediately.
4. Fetch the selected MAL page and merge parsed fields.
5. If MAL search cannot resolve, query AniList for a season-aware match and `idMal`, then fetch `/anime/<idMal>`.
6. If MAL HTML fails but AniList resolved, return fields built from AniList while leaving `score: null`.

The AniList query must request only required fields:

```ts
const MAL_FALLBACK_QUERY = `query ($search: String) {
  Page(perPage: 8) { media(search: $search, type: ANIME) {
    idMal title { romaji english native } synonyms format status episodes
    duration season seasonYear source studios { nodes { name } }
  } }
}`;
```

Do not use AniList `averageScore` in `MalData.score`. Keep the existing rule that only non-empty results are cached.

- [ ] **Step 5: Add the test to the standard suite and run it**

Append `npx --yes tsx lib/animeInfo.test.ts` to the existing `test` script, then run:

`npx --yes tsx lib/animeInfo.test.ts`

Expected: parser and null-score checks pass.

### Task 3: Full And Live Verification

**Files:**
- No release/version files.

- [ ] **Step 1: Run static and unit verification**

Run: `npm test`

Expected: TypeScript, injected-script checks, and all unit checks pass.

- [ ] **Step 2: Test live direct providers**

Use current Witanime episode pages and validate one sample each for vid3rb, mp4upload, streamwish, videa.hu, and app.videas.fr. A provider passes only when extraction returns a media URL and a `Range: bytes=0-1` request returns media bytes or an HLS manifest request returns playlist content.

Expected keep list: `vid3rb`, `streamwish`, `videa`, `videas`.

Expected absent list: `mp4upload`, `dailymotion`, `voe`, `doodstream`, `okru`, `yonaplay`, `generic`, `vk`, `mega`.

- [ ] **Step 3: Test MAL fallback live**

Check `One Piece` and one current-season title. Confirm Jikan failure does not prevent the real MAL score or Info rows from loading, and confirm the displayed score matches the direct MAL page.

- [ ] **Step 4: Confirm release files are untouched**

Run: `git diff -- app.json package.json version.json`

Expected: only the `package.json` test-script addition may appear; `app.json` and `version.json` have no changes. Do not run `npm run publish-ota`.

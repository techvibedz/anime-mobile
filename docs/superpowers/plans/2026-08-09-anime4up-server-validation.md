# Anime4up Server Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Do not use subagents for this task.

**Goal:** Restore Anime4up server discovery by accepting complete source pages that include Cloudflare's appended telemetry script.

**Architecture:** Keep validation in the shared `isValidSourceHtml` boundary. Require a source marker, and reject Cloudflare HTML only when source content is absent.

**Tech Stack:** TypeScript, Node assert tests, Expo React Native

---

### Task 1: Correct source HTML validation

**Files:**
- Modify: `lib/scraper/sourceDomains.test.ts`
- Modify: `lib/scraper/sourceDomains.ts:102-110`

- [ ] **Step 1: Write the failing regression test**

Add an assertion that valid Anime4up server markup followed by a Cloudflare `challenge-platform` telemetry script is accepted, while the existing marker-free challenge assertion remains false.

```ts
assert.equal(
  isValidSourceHtml(
    "anime4up",
    '<ul id="episode-servers"><li data-watch="https://video.example/e/1"></li></ul><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>',
  ),
  true,
);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx --yes tsx lib/scraper/sourceDomains.test.ts`

Expected: FAIL because `isValidSourceHtml` currently rejects any HTML containing `challenge-platform`.

- [ ] **Step 3: Implement the minimal condition**

Change validation so source content markers are authoritative:

```ts
export function isValidSourceHtml(source: SourceId, html: string): boolean {
  return SOURCE_MARKERS[source].test(html);
}
```

- [ ] **Step 4: Run focused and static verification**

Run:

```text
npx --yes tsx lib/scraper/sourceDomains.test.ts
npx --yes tsc --noEmit
node scripts/check-injected-js.js
node scripts/check-wrapped-js.js
```

Expected: all commands pass. Do not run `publish-ota`.

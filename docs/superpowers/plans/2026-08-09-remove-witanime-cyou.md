# Remove WitAnime c.you Mirror Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the incomplete `witanime.cyou` mirror and deliver the change to preview installs through EAS Update.

**Architecture:** Keep the existing shared source-candidate mechanism and remove only one host from its WitAnime domain list. The existing preference validator then rejects stale preferences for that host without migration code.

**Tech Stack:** TypeScript, React Native/Expo, EAS Update, Node assert tests

---

### Task 1: Remove The Mirror

**Files:**
- Modify: `lib/scraper/sourceDomains.test.ts:14-20`
- Modify: `lib/scraper/sourceDomains.ts:6-10`

- [ ] **Step 1: Change the focused expectation first**

Update the expected WitAnime candidates and remove the `witanime.cyou` identity assertion:

```ts
assert.deepEqual(sourceCandidates("https://witanime.you/anime/x?y=1", null), [
  "https://witanime.you/anime/x?y=1",
  "https://witanime.life/anime/x?y=1",
]);
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `npx --yes tsx lib/scraper/sourceDomains.test.ts`

Expected: FAIL because the implementation still returns `https://witanime.cyou/anime/x?y=1`.

- [ ] **Step 3: Remove the mirror from the shared domain list**

```ts
export const SOURCE_DOMAINS: Record<SourceId, readonly string[]> = {
  witanime: ["witanime.you", "witanime.life"],
  anime4up: ["w1.anime4up.rest", "anime4up.rest"],
  anime3rb: ["anime3rb.com", "www.anime3rb.com"],
};
```

- [ ] **Step 4: Run the focused test and confirm it passes**

Run: `npx --yes tsx lib/scraper/sourceDomains.test.ts`

Expected: `sourceDomains tests passed`.

### Task 2: Verify And Publish Preview OTA

**Files:**
- Verify: `lib/scraper/sourceDomains.ts`
- Verify: `lib/scraper/sourceDomains.test.ts`

- [ ] **Step 1: Run the full project checks**

Run: `npm test`

Expected: TypeScript, injected-script checks, wrapped-script checks, and every listed test pass.

- [ ] **Step 2: Confirm the delivery diff is OTA-safe**

Run: `git diff --check`

Expected: no output.

Run: `git diff -- lib/scraper/sourceDomains.ts lib/scraper/sourceDomains.test.ts`

Expected: only deletion of `witanime.cyou` from the candidate list and matching assertions.

- [ ] **Step 3: Publish to preview current and discovered runtimes**

Run from Git Bash or an equivalent Bash shell:

```bash
BRANCHES=preview npm run publish-ota -- "Remove incomplete witanime.cyou mirror"
```

Expected: EAS publishes to branch `preview` for the current app runtime and each discovered finished Android build runtime, including `3.3.1`.

- [ ] **Step 4: Record the update result**

Run: `eas update:list --branch preview --limit 5 --non-interactive`

Expected: the newest preview update groups show the removal message and successful publication.

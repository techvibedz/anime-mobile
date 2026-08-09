# Supabase Egress Reduction Implementation Plan

> **For agentic workers:** Execute inline in this session. Do not dispatch subagents.

**Goal:** Remove redundant Supabase Auth responses and prevent conflict-only episode reports from triggering full notification fan-out reads.

**Architecture:** Routine client sync reads the persisted Supabase session instead of remotely validating the same user before each RLS-backed request. Episode queue upserts return inserted keys, and notifier invocation is gated on that result.

**Tech Stack:** Expo, React Native, TypeScript, `@supabase/supabase-js`, assert-based TS tests

---

### Task 1: Queue Insert Gate

**Files:**
- Create: `lib/notificationQueue.ts`
- Create: `lib/notificationQueue.test.ts`
- Modify: `lib/notifications.ts:430-446`

- [ ] Write a failing assert-based test proving null/empty inserted rows skip fan-out and non-empty rows permit it.
- [ ] Run `npx --yes tsx lib/notificationQueue.test.ts` and confirm it fails because the policy function does not exist.
- [ ] Add the minimal pure policy function.
- [ ] Add `.select("episode_key")` to the queue upsert and return before invoking the Edge Function when no row was inserted.
- [ ] Run `npx --yes tsx lib/notificationQueue.test.ts` and confirm it passes.

### Task 2: Local Session User

**Files:**
- Modify: `lib/supabase.ts`
- Modify: `lib/history.ts`
- Modify: `lib/favorites.ts`
- Modify: `lib/completion.tsx`
- Modify: `lib/push.ts`

- [ ] Add `getSessionUser()`, returning `supabase.auth.getSession()`'s user or null.
- [ ] Replace routine `auth.getUser()` calls in history, favorites, completion, and notification-setting sync with `getSessionUser()`.
- [ ] Keep remote `auth.getUser()` calls in profile/report/settings trust-sensitive flows unchanged.

### Task 3: Verification

**Files:**
- Modify: `package.json`

- [ ] Add the focused queue policy test to the existing `test` script.
- [ ] Run `npx --yes tsx lib/notificationQueue.test.ts`.
- [ ] Run `npx --yes tsc --noEmit`.
- [ ] Run `npm test`.
- [ ] Review `git diff` and confirm there are no schema, progress-frequency, scraping, or notification-scope changes.

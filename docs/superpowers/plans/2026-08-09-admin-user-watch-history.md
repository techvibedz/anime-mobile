# Admin User Watch History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show started/completed episode counts for every user and full per-user watch history to the admin account, then publish the JavaScript update to Android preview runtime 3.3.1.

**Architecture:** Keep existing `watch_history` RLS unchanged. Add two authenticated, internally admin-gated RPCs: an aggregate summary for the users list and a detail query for one selected user; map their raw rows through a small pure module before rendering them in the existing admin screens.

**Tech Stack:** Expo 54, React Native, TypeScript, Supabase/Postgres RPC, EAS Update.

---

## File Map

- Create `supabase/admin-watch-history.sql`: admin authorization, aggregate counts RPC, and per-user history RPC.
- Create `lib/adminHistory.ts`: raw-row conversion, progress clamping, and summary merging.
- Create `lib/adminHistory.test.ts`: runnable mapper checks without React Native dependencies.
- Modify `lib/usage.ts`: call the two new RPCs and expose typed history fetching.
- Modify `app/users.tsx`: render started/completed counts on every user card.
- Modify `app/user/[id].tsx`: load and render full history with explicit failure state.
- Modify `lib/i18n.ts`: Arabic labels and history states.
- Modify `package.json`: include the mapper check in the repository test command.

### Task 1: Admin Database RPCs

**Files:**
- Create: `supabase/admin-watch-history.sql`

- [ ] **Step 1: Add the aggregate RPC**

Create `public.admin_watch_summary()` returning `user_id`, `episodes_started`, and `episodes_completed`. It must use `security definer set search_path = ''`, reject callers whose normalized JWT email is not `zlabia66@gmail.com`, aggregate `public.watch_history` by `user_id`, and count completed rows with `count(*) filter (where completed)`.

- [ ] **Step 2: Add the detail RPC**

Create `public.admin_user_watch_history(p_user_id uuid)` with the same authorization gate. Return `episode_href`, `episode_title`, `anime_title`, `anime_href`, `image`, `position_ms`, `duration_ms`, `completed`, and `updated_at`, filtered by `p_user_id` and ordered by `updated_at desc`.

- [ ] **Step 3: Restrict execution**

For both signatures, revoke execute from `public` and `anon`, then grant execute to `authenticated`. Do not add an admin SELECT policy to `watch_history`.

- [ ] **Step 4: Apply and verify SQL**

Authenticate/link the CLI if needed, then run:

```powershell
npx supabase db query --linked --file supabase/admin-watch-history.sql
```

Expected: both functions are created. Verify with an authenticated admin call from the app; verify a non-admin call returns the `admin only` database error.

### Task 2: Pure Row Mapping

**Files:**
- Create: `lib/adminHistory.ts`
- Create: `lib/adminHistory.test.ts`

- [ ] **Step 1: Write failing mapper checks**

Cover these exact cases with Node `assert`:

```ts
assert.deepEqual(mergeWatchSummaries([{ userId: "u1" }], [
  { user_id: "u1", episodes_started: "4", episodes_completed: "2" },
]), [{ userId: "u1", episodesStarted: 4, episodesCompleted: 2 }]);

assert.equal(mapAdminHistoryRow({
  episode_href: "/ep/1", episode_title: "Episode 1", anime_title: "Anime",
  anime_href: "/anime", image: null, position_ms: "900", duration_ms: "1000",
  completed: false, updated_at: "2026-08-09T00:00:00Z",
}).progress, 0.9);
```

- [ ] **Step 2: Confirm the check fails**

Run `npx --yes tsx lib/adminHistory.test.ts`.

Expected: FAIL because the module/functions do not exist.

- [ ] **Step 3: Implement minimal mapping**

Define `WatchSummaryRow`, `AdminHistoryRow`, and `AdminWatchEntry`. Implement `mergeWatchSummaries()` using a `Map` keyed by user ID and default missing counts to zero. Implement `mapAdminHistoryRow()` with numeric conversion and progress clamped to `0..1`; a zero duration yields zero progress.

- [ ] **Step 4: Confirm the check passes**

Run `npx --yes tsx lib/adminHistory.test.ts`.

Expected: PASS.

### Task 3: Supabase Client Integration

**Files:**
- Modify: `lib/usage.ts`

- [ ] **Step 1: Add episode counts to `UsageRow`**

Add `episodesStarted: number` and `episodesCompleted: number`.

- [ ] **Step 2: Fetch list and summary together**

In `fetchAllUsage()`, run `admin_list_users` and `admin_watch_summary` with `Promise.all`. Preserve the existing empty-array behavior if the user list fails; merge successful summaries with `mergeWatchSummaries`, and default counts to zero if the summary call fails.

- [ ] **Step 3: Add explicit history result**

Export:

```ts
export type AdminHistoryResult =
  | { ok: true; entries: AdminWatchEntry[] }
  | { ok: false; entries: []; error: string };
```

Implement `fetchUserWatchHistory(userId)` by calling `admin_user_watch_history`, returning the error union on failure and mapping rows on success.

### Task 4: All Users Counts

**Files:**
- Modify: `app/users.tsx`
- Modify: `lib/i18n.ts`

- [ ] **Step 1: Add Arabic labels**

Add `usersEpisodesStarted: "بدأ مشاهدتها"` and `usersEpisodesCompleted: "حلقات مكتملة"`.

- [ ] **Step 2: Render both counts**

Add two existing `Stat` cells to each user card using `play-outline` and `checkmark-circle-outline`, rendering `u.episodesStarted` and `u.episodesCompleted`. Do not add an expandable history list to this screen.

### Task 5: Per-User Full History

**Files:**
- Modify: `app/user/[id].tsx`
- Modify: `lib/i18n.ts`

- [ ] **Step 1: Add history strings**

Add labels for the history heading, completed, progress percentage, empty state, load failure, and retry action.

- [ ] **Step 2: Load usage and history concurrently**

Add `history`, `historyError`, and loading state. Update `load()` to call `fetchUserDaily(userId)` and `fetchUserWatchHistory(userId)` with `Promise.all`, retaining daily rows even when history fails. Ensure refresh resets in `finally`.

- [ ] **Step 3: Add history summary cells**

Show started and completed totals derived from loaded entries in the existing summary grid.

- [ ] **Step 4: Render newest-first history**

Below daily activity, render each entry with `expo-image`, title text, completed/in-progress status, rounded percentage, a small progress bar, and localized last-update date/time. Use an icon fallback when `image` is empty.

- [ ] **Step 5: Render explicit terminal states**

Show an activity indicator while history loads, the Arabic empty state for a successful empty result, and an error card with retry action after RPC failure.

### Task 6: Verification and Preview OTA

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the mapper check to `npm test`**

Insert `npx --yes tsx lib/adminHistory.test.ts` alongside the existing TypeScript checks.

- [ ] **Step 2: Run repository verification**

Run `npm test`.

Expected: TypeScript and all runnable checks pass. The known unrelated updater error is only acceptable if it remains the sole pre-existing failure and is unchanged.

- [ ] **Step 3: Inspect intended changes**

Run `git status --short` and `git diff --` for the files listed in this plan. Do not modify or revert the pre-existing scraper worktree changes.

- [ ] **Step 4: Publish preview Android OTA**

Run:

```powershell
eas update --channel preview --platform android --message "feat: admin user watch history" --non-interactive
```

Expected: one Android update on branch `preview`, runtime `3.3.1`.

- [ ] **Step 5: Verify publication**

Run:

```powershell
eas update:list --branch preview --limit 3 --json --non-interactive
```

Expected: the newest update message is `feat: admin user watch history`, platform is Android, and runtime is `3.3.1`. Record its update group ID.

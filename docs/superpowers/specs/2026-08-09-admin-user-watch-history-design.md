# Admin User Watch History

## Goal

Give the admin account episode-level visibility for every account from the existing All Users flow without weakening ordinary users' watch-history privacy.

## User Experience

- Each card on `app/users.tsx` shows two counts: episodes started and episodes completed.
- Episodes started means the number of distinct rows in `watch_history` for that user.
- Episodes completed means rows where `completed` is true. The existing player marks an episode complete after 80% progress, and manually marked episodes also count.
- Tapping a user continues to open `app/user/[id].tsx`.
- The user detail screen retains its current usage summary, daily activity, and admin chat action, then adds the complete watch history newest first.
- Each history item shows its image, anime title, episode title, completed or in-progress state, percentage watched, and last update time.
- Pull-to-refresh reloads both daily usage and watch history.
- Loading, empty-history, and request-failure states are visible and do not hide the existing usage data.

## Data Access

- Extend the existing admin user-list response with `episodes_started` and `episodes_completed` values aggregated by user.
- Add an admin-only database RPC accepting one user ID and returning that user's `watch_history` rows ordered by `updated_at desc`.
- Both database paths verify the authenticated caller against the same admin email used by the existing admin RPC family.
- Existing row-level policies remain unchanged: non-admin clients can still read only their own history.
- The detail request runs only after an admin opens a user, avoiding a full-history download on the All Users page.

## App Changes

- Extend `UsageRow` and `fetchAllUsage()` in `lib/usage.ts` with both episode counts.
- Add a typed watch-history result and fetch function in `lib/usage.ts`, reusing the current Supabase client and admin RPC pattern.
- Add the two count cells to `app/users.tsx`.
- Load and render the history section in `app/user/[id].tsx`.
- Add only the required Arabic strings to `lib/i18n.ts` and reuse current theme components and formatting patterns.

## Error Handling

- RPC failures return an explicit failed state rather than silently presenting an empty history.
- Refresh always clears its spinner in a `finally` path.
- Invalid progress values are clamped for display, and missing durations display zero progress rather than dividing by zero.
- Missing images use the existing visual fallback.

## Verification

- TypeScript and the repository test command pass.
- A small runnable mapper test covers count conversion and history progress/completed mapping.
- Confirm a non-admin session cannot call the admin history RPC.
- Confirm the admin sees correct started/completed counts and newest-first history for users with no history, partial episodes, completed episodes, and manually completed zero-duration episodes.
- Publish an Android OTA to the existing `preview` channel only, targeting runtime `3.3.1`, then verify the new preview update ID.

## Out Of Scope

- Editing or deleting another user's history.
- Live playback surveillance beyond the latest synchronized history progress.
- New native dependencies, an APK build, production/staging OTA publication, pagination, or analytics charts.

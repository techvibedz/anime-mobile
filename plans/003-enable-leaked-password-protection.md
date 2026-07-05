# Plan 003: Enable Supabase leaked-password protection

> **Executor instructions**: This is an **operator/dashboard action**, not a code
> change. A code-only executor cannot complete it — if you are a code executor,
> mark this plan BLOCKED in `plans/README.md` with reason "requires Supabase
> dashboard/admin access" and report back. A human or an agent with Supabase
> admin credentials should perform the steps below.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `e619caf`, 2026-06-26

## Why this matters

The Supabase security advisor reports **"Leaked Password Protection Disabled"**
for this project. With it off, users can set passwords that are known to be
compromised (present in HaveIBeenPwned breach corpora). The app uses email/password
auth (`lib/auth.tsx` → `supabase.auth.signUpWithPassword` /
`signInWithPassword`), so enabling this check directly hardens every account at
signup and password change, with zero code and no UX cost beyond rejecting known-
breached passwords.

Reference: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

## Current state

- Project ref: `iwrphgttbjqifstqttqm` (Supabase project, per `CLAUDE.md`).
- Advisor lint `auth_leaked_password_protection` = present (WARN).
- No repo file controls this — it is an Auth service setting.

## Steps

### Step 1: Enable the setting

**Option A — Dashboard (simplest):**
1. Open the Supabase dashboard for project `iwrphgttbjqifstqttqm`.
2. Go to **Authentication → Policies** (a.k.a. Password settings / Attack
   Protection, depending on dashboard version).
3. Turn **ON** "Leaked password protection" (HaveIBeenPwned check).
4. Save.

**Option B — Management API** (for an operator with a Supabase access token):
```
curl -X PATCH "https://api.supabase.com/v1/projects/iwrphgttbjqifstqttqm/config/auth" \
  -H "Authorization: Bearer <SUPABASE_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"password_hibp_enabled": true}'
```
Do **not** paste the token into any file or commit it.

### Step 2: Verify

Re-run the security advisor and confirm the lint is gone:
- Via the Supabase MCP / dashboard "Advisors" → Security: the
  `auth_leaked_password_protection` warning should no longer appear.

Optional functional check: attempt to register with a notoriously breached
password (e.g. `password`) in a dev build → signup should be rejected.

## Done criteria

- [ ] `auth_leaked_password_protection` no longer reported by the Supabase security advisor.
- [ ] `plans/README.md` status row for 003 updated (DONE, or BLOCKED if no admin access).

## STOP conditions

- You lack Supabase admin/dashboard access → mark BLOCKED and report.
- Enabling it surfaces an unexpected paid-plan gate → report; do not change billing.

## Maintenance notes

- No code interacts with this setting; it persists at the project level.
- If a future error message needs to explain "password found in a breach" to
  users in Arabic, add the string to `lib/i18n.ts` and surface the Supabase
  error in `lib/auth.tsx` — deferred, not required here.

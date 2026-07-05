# Plan 004: Sanitize episode_queue rows before they fan out as push notifications

> **Executor instructions**: Follow this plan step by step. The code change is in
> one Deno edge-function file. Deployment of the edge function is a separate
> operator step (Step 4) that a code-only executor cannot perform — if you cannot
> deploy, make the code change, then mark the plan IN PROGRESS in
> `plans/README.md` noting "code done, awaiting deploy". If a STOP condition
> occurs, stop and report.
>
> **Drift check (run first)**:
> `git diff --stat e619caf..HEAD -- supabase/functions/episode-notifier/index.ts supabase/notifications.sql`
> If either changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, STOP.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED (touches the live push pipeline — a bad filter could drop legit notifications)
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `e619caf`, 2026-06-26

## Why this matters

The `episode_queue` table is a **shared, global feed**: by design, any signed-in
user can `INSERT` rows (`supabase/notifications.sql:86-87`,
`with check (true)`), because the server can't scrape witanime itself (Cloudflare),
so devices contribute. The `episode-notifier` edge function then **fans those rows
out as push notifications to all users**, using the row's `anime_title` (push body
text) and `image` (rich-content image) verbatim.

The gap: a malicious authenticated user can insert a crafted row and have an
**attacker-controlled title and image pushed to every user** of the app. The
advisor also flags this policy (`rls_policy_always_true` on `episode_queue`). We
keep the open-contribution model (it's load-bearing for the architecture) but
**sanitize rows server-side before fanout**, so a poisoned row can't deliver
abusive text or an arbitrary image.

This is a low-likelihood abuse (requires a logged-in user acting maliciously) but
a high-blast-radius one (push to all users), and the fix is contained to one
function.

## Current state

### `supabase/functions/episode-notifier/index.ts`

`QueueRow` (lines 53-62):
```ts
interface QueueRow {
  episode_key: string; anime_key: string; anime_title: string; anime_href: string;
  episode_title: string | null; episode_href: string | null;
  episode_number: number; image: string | null;
}
```

The queue is loaded (lines 214-221) then iterated to build pushes:
```ts
  const { data: queueRows } = await supabase
    .from("episode_queue")
    .select("*")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(500);
  const queue = (queueRows ?? []) as QueueRow[];
```

`buildMessage` (lines 86-100) puts row data straight into the push:
```ts
function buildMessage(to: string, q: QueueRow): PushMessage {
  const msg: PushMessage = {
    to, title: "حلقة جديدة! 🎬",
    body: `${q.anime_title} — الحلقة ${q.episode_number} متوفرة الآن`,
    sound: "default", channelId: CHANNEL_ID, priority: "high",
    data: { animeHref: q.anime_href, episodeHref: q.episode_href, episodeNumber: q.episode_number, image: q.image },
  };
  if (q.image) msg.richContent = { image: q.image };
  return msg;
}
```

### `supabase/notifications.sql` — the policy (context only, not edited here)

```sql
create policy "episode_queue_insert_auth" on public.episode_queue
  for insert to authenticated with check (true);
```

## Commands you will need

| Purpose                | Command | Expected |
|------------------------|---------|----------|
| Find current image hosts (operator, read-only) | see Step 1 SQL | a small list of hostnames |
| Deploy the function (operator) | `supabase functions deploy episode-notifier` (or Supabase MCP `deploy_edge_function`) | deploy succeeds |

There is no local typecheck for the Deno edge function in this repo's `npm`
scripts; the function is validated on deploy. Keep the edit minimal and
syntactically careful.

## Scope

**In scope**:
- `supabase/functions/episode-notifier/index.ts` — add a sanitize step.

**Out of scope**:
- The `episode_queue` RLS policy — keep open contribution (architectural).
- `lib/notifications.ts` (the in-app reporter) — it writes the queue; not the fanout.
- Any other edge function or table.

## Git workflow

- Branch: `advisor/004-sanitize-push-fanout`
- Example commit: `fix(notifier): sanitize episode_queue rows before push fanout`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Build the image-host allowlist from REAL data (operator, read-only)

Before filtering images, learn which hosts legit rows actually use, so the filter
never drops real episode images. Run (Supabase SQL editor / MCP `execute_sql`):

```sql
select distinct split_part(split_part(image, '//', 2), '/', 1) as host, count(*)
from public.episode_queue
where image is not null and image <> ''
group by 1 order by 2 desc;
```

Also check the metadata cache for the broader set of legit image hosts the app
already trusts:
```sql
select distinct split_part(split_part((payload->>'image'), '//', 2), '/', 1) as host
from public.anime_metadata_cache
where (payload->>'image') is not null limit 50;
```

Record the resulting hostnames. They are expected to be the scrape sources'
image CDNs (witanime / anime4up / anime3rb and their image subdomains). If the
queue is currently empty, fall back to the hosts from the metadata-cache query.

**If you cannot run SQL**, STOP and ask the operator for the allowlist — do NOT
guess hosts (a wrong allowlist silently drops legit images).

### Step 2: Add a sanitize function

In `supabase/functions/episode-notifier/index.ts`, just below the `QueueRow`
interface (after line 62), add (fill `IMG_HOST_ALLOW` from Step 1):

```ts
// Rows in episode_queue are inserted by ANY signed-in user (shared feed). Before
// fanning them out as push to everyone, sanitize attacker-controllable fields:
// clamp the title, require a sane episode number, and drop images from hosts that
// aren't known scrape-source CDNs. Dropping a bad image still delivers the text
// push — we never drop a whole notification here, only untrusted rich content.
const IMG_HOST_ALLOW = /(?:^|\.)(REPLACE_WITH|HOSTS_FROM_STEP_1)$/i; // e.g. anime3rb.com, witanime.*, ...

function safeImage(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    return IMG_HOST_ALLOW.test(u.hostname) ? url : null;
  } catch {
    return null;
  }
}

function sanitizeRow(q: QueueRow): QueueRow {
  const title = (q.anime_title || "").slice(0, 80);
  const ep = Number.isFinite(q.episode_number) ? Math.trunc(q.episode_number) : 0;
  return {
    ...q,
    anime_title: title,
    episode_number: ep,
    image: safeImage(q.image),
  };
}

function isPlausibleRow(q: QueueRow): boolean {
  // Drop rows that can't be a real episode notification at all.
  return !!q.anime_title && q.episode_number > 0 && q.episode_number < 100000;
}
```

> Regex note: build `IMG_HOST_ALLOW` from the Step-1 hosts. Escape dots
> (`anime3rb\.com`). The `(?:^|\.)` prefix lets subdomains match
> (`img.anime3rb.com` matches `anime3rb\.com`). Verify it matches the real hosts
> and rejects an unrelated one (e.g. `evil.example.com`) before moving on.

### Step 3: Apply sanitize where the queue is loaded

Change line 221 from:
```ts
  const queue = (queueRows ?? []) as QueueRow[];
```
to:
```ts
  const queue = ((queueRows ?? []) as QueueRow[]).filter(isPlausibleRow).map(sanitizeRow);
```

Everything downstream (`buildMessage`, the seeding loop, dedup) keeps working —
it just receives clamped, image-validated rows.

**Verify (static)**: re-read the diff. Confirm:
- `buildMessage` is unchanged.
- The only behavioral change is rows are filtered+sanitized before use.
- No `await` was added inside a synchronous map (the functions are sync).

### Step 4: Deploy (operator)

Deploy the updated function:
- Supabase CLI: `supabase functions deploy episode-notifier`, or
- Supabase MCP: `deploy_edge_function` for `episode-notifier`.

Then trigger one run (the cron will also run on schedule) and confirm in the
function logs that legit episodes still push (no mass image-dropping). Use the
Supabase logs / `get_logs` for the edge function.

## Test plan

No unit-test harness exists for the Deno edge function in this repo. Validate by:

1. **Allowlist sanity** (do this before deploy): in a scratch Deno/Node REPL or by
   eye, confirm `safeImage` returns the URL for a real source-host image and
   `null` for `https://evil.example.com/x.jpg` and for a non-https URL.
2. **Post-deploy**: confirm a normally-reported new episode still arrives as a push
   WITH its image, and that `episode_number`/title look normal in the logs.

Document the allowlist hosts you used in the PR description.

## Done criteria

- [ ] `episode-notifier/index.ts` filters + sanitizes the queue before fanout (`grep -n "sanitizeRow\|safeImage\|isPlausibleRow" supabase/functions/episode-notifier/index.ts` → matches).
- [ ] `IMG_HOST_ALLOW` contains real source hosts from Step 1, not the placeholder.
- [ ] `buildMessage` and the RLS policy are unchanged.
- [ ] Function deployed (or plan marked "code done, awaiting deploy").
- [ ] A real new-episode push still delivers with its image after deploy.
- [ ] `plans/README.md` status row for 004 updated.

## STOP conditions

- You cannot determine the legit image hosts (Step 1) → STOP; do not guess.
- After deploy, legit episode images are being dropped (allowlist too strict) →
  revert the deploy and report; an over-broad drop is worse than the original risk.
- The function file has drifted from the excerpts (different load/query shape).

## Maintenance notes

- If a NEW scrape source with a new image CDN is added later, its host must be
  added to `IMG_HOST_ALLOW` or its images will be silently dropped from pushes.
  Leave a comment to that effect at the regex.
- A stronger follow-up (deferred): a per-user insert rate-limit on `episode_queue`
  via a trigger (mirroring the existing `metadata_write_limits` pattern) to stop
  one account flooding the feed. Not done here because content sanitization
  removes the high-impact part (abusive push content) with less risk.
- Reviewer should scrutinize the allowlist regex most of all — it's the line that
  can break legit notifications.

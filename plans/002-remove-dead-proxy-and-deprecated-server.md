# Plan 002: Remove the dead video-proxy code and the deprecated backend directories

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat e619caf..HEAD -- lib/config.ts lib/api.ts app/watch/\[episode\].tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: 001 (soft — 001 also edits `app/watch/[episode].tsx`; do 001 first to avoid a merge conflict)
- **Category**: tech-debt
- **Planned at**: commit `e619caf`, 2026-06-26

## Why this matters

The app became **backend-free**: scraping happens in-app via a hidden WebView and
the residential IP plays CDN URLs directly. The old remote video-proxy and server
are no longer used, but their code and directories still sit in the repo:

- `lib/config.ts` (`VIDEO_PROXY_BASE`, `PROXY_HOSTS`, `needsProxy`) has **zero
  importers** — fully dead.
- `lib/api.ts:285` `getProxyUrl()` is now an identity no-op (`return videoUrl;`)
  but is still called in 3 places in the watch screen, implying a transform that
  no longer happens — misleading to readers.
- `server/`, `hf-space/`, `proxy/`, and `render.yaml` are the deprecated backend,
  explicitly marked "no longer used / safe to remove in a cleanup pass" in
  `CLAUDE.md`.

Removing this reduces the surface a future reader has to understand, and kills a
stale default URL (`xpirox-pantoufa.hf.space`) that points at a Space slated for
deletion. Pure deletion — no behavior change.

## Current state

### `lib/config.ts` (entire file is dead)

Exports `VIDEO_PROXY_BASE`, `PROXY_HOSTS` (a regex), and `needsProxy(url)`.
Confirmed unused: `grep -rn "lib/config\|from \"./config\"\|from \"../lib/config\"\|needsProxy\|VIDEO_PROXY_BASE" lib app components` returns only definitions inside `lib/config.ts` itself.

### `lib/api.ts:285-287` (`getProxyUrl` is identity)

```ts
export function getProxyUrl(videoUrl: string): string {
  return videoUrl;
}
```

### `app/watch/[episode].tsx` — the only caller (4 references)

- Import (line ~20):
  `import { fetchVideoServers, resolveVideo, getProxyUrl, fetchAnime3rbServers, fetchAnime3rbServersByUrl, prefetchAnime3rbServers } from "../../lib/api";`
- Usage line ~543: `const fresh = getProxyUrl(r.data.videoUrl);`
- Usage line ~1466: `i === idx ? { ...s, status: "playing", videoUrl: getProxyUrl(r.data!.videoUrl) } : s));`
- Usage line ~1515: `i === idx ? { ...s, status: "playing", videoUrl: getProxyUrl(r.data!.videoUrl) } : s));`

Since `getProxyUrl(x) === x`, every call can be replaced by its argument.

### Deprecated backend directories (per `CLAUDE.md`)

`server/`, `hf-space/`, `proxy/`, and `render.yaml` at the repo root. App code lives
in `app/`, `lib/`, `components/` and does not import from any of these.

### Repo conventions

- Conventional Commits (`git log`: `chore: ...`, `fix(...): ...`).
- Strict TypeScript. Removing an unused export must not leave dangling imports.

## Commands you will need

| Purpose          | Command                                                                 | Expected on success |
|------------------|-------------------------------------------------------------------------|---------------------|
| Find references  | `grep -rn "getProxyUrl\|needsProxy\|VIDEO_PROXY_BASE\|lib/config" lib app components` | only the lines this plan expects |
| Find dir imports | `grep -rn "from \"\.\./server\|/hf-space/\|/proxy/\|render.yaml" lib app components app.config.js eas.json` | no matches |
| Typecheck        | `npx tsc --noEmit`                                                       | exit 0, no errors   |
| Tests            | `npm test`                                                              | typecheck clean, `22 passed`, `14 passed` |

## Scope

**In scope**:
- `lib/config.ts` — delete the file.
- `lib/api.ts` — delete the `getProxyUrl` function.
- `app/watch/[episode].tsx` — drop the `getProxyUrl` import + inline its 3 call-sites.
- `server/`, `hf-space/`, `proxy/`, `render.yaml` — delete (directories + file).
- `CLAUDE.md` — remove the now-obsolete "deprecated server" / cleanup-pass notes.

**Out of scope**:
- `app/scraper-debug.tsx` and the scraper itself — unrelated.
- `landing/` — that is the live download page, NOT backend; keep it.
- `supabase/` — the edge functions are live; keep them.
- Any behavior change to playback. This is deletion only.

## Git workflow

- Branch: `advisor/002-dead-proxy-cleanup`
- Example commit: `chore: remove dead video-proxy code and deprecated backend dirs`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Confirm `lib/config.ts` is unreferenced, then delete it

Run: `grep -rn "lib/config\|needsProxy\|VIDEO_PROXY_BASE\|PROXY_HOSTS" lib app components`

Expected: matches ONLY inside `lib/config.ts`. If anything outside that file
references these, **STOP** (the proxy is still wired somewhere — drift).

Then delete the file: `git rm lib/config.ts` (or delete it).

**Verify**: `npx tsc --noEmit` → 0 errors (nothing imported it).

### Step 2: Inline + remove `getProxyUrl`

In `app/watch/[episode].tsx`:
- Remove `getProxyUrl,` from the `../../lib/api` import (line ~20).
- Line ~543: `const fresh = r.data.videoUrl;`
- Lines ~1466 and ~1515: replace `getProxyUrl(r.data!.videoUrl)` with `r.data!.videoUrl`.

In `lib/api.ts`: delete the `getProxyUrl` function (lines 285-287) and its
2-line comment header if it has one.

Confirm no other caller remains:
`grep -rn "getProxyUrl" lib app components` → **no matches**.

**Verify**: `npx tsc --noEmit` → 0 errors.

### Step 3: Delete the deprecated backend directories

First prove nothing in the app references them:
`grep -rn "\.\./server\|/hf-space\|/proxy/\|render\.yaml" lib app components app.config.js eas.json`
Expected: no matches. If any match, **STOP** and report which file references them.

Then delete:
- `git rm -r server hf-space proxy`
- `git rm render.yaml`

(If `git rm` complains a path is untracked, delete it with `rm -r` instead.)

**Verify**: `npm test` → typecheck clean, `22 passed`, `14 passed`. `git status`
shows only the intended deletions plus the edited files.

### Step 4: Update `CLAUDE.md`

Remove the now-stale references to the deprecated backend so the handoff doc
matches reality. Specifically:
- The "### Server (deprecated)" subsection.
- The two "Pending" bullets about deleting `server/`, `hf-space/`, `render.yaml`.
- Leave everything about the in-app scraper, Supabase, and known issues intact.

Do not invent new content — only delete the obsolete lines.

**Verify**: `git diff CLAUDE.md` shows only deletions of backend-cleanup notes.

## Test plan

No new tests — this is deletion of unused code. Regression protection is the
existing suite plus the typecheck:

- `npx tsc --noEmit` → 0 errors.
- `npm test` → typecheck clean, `22 passed`, `14 passed`.
- `grep -rn "getProxyUrl\|needsProxy\|VIDEO_PROXY_BASE" lib app components` → no matches.

## Done criteria

ALL must hold:

- [ ] `lib/config.ts` no longer exists.
- [ ] `getProxyUrl` is gone from `lib/api.ts` and `grep -rn "getProxyUrl"` over `lib app components` returns nothing.
- [ ] `server/`, `hf-space/`, `proxy/`, `render.yaml` no longer exist.
- [ ] `npx tsc --noEmit` exits 0.
- [ ] `npm test` exits 0.
- [ ] `landing/` and `supabase/` are untouched (`git status`).
- [ ] `plans/README.md` status row for 002 updated.

## STOP conditions

Stop and report back if:

- Step 1 or Step 3 grep finds a reference to the supposedly-dead code/dirs from
  inside `lib/`, `app/`, `components/`, `app.config.js`, or `eas.json`.
- Removing `getProxyUrl` changes the type at a call-site (it should not — it
  returns `string`, same as its argument).
- `npx tsc --noEmit` reports any error after a deletion.

## Maintenance notes

- After this lands, there is no remote proxy concept left in the app. If a future
  provider ever needs Referer rewriting that the native player can't do, that's a
  new design decision — don't resurrect `lib/config.ts` from git blame without
  re-evaluating whether an in-app fetch+rewrite is simpler.
- Reviewer should confirm the diff is deletions only, with no playback-path logic
  altered beyond unwrapping the identity `getProxyUrl` calls.

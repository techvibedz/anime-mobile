# Plan 001: Finish the download server/quality picker and restore a green typecheck

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat e619caf..HEAD -- components/DownloadPicker.tsx lib/api.ts lib/downloads.ts app/anime/\[id\].tsx app/watch/\[episode\].tsx package.json`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug / dx / direction
- **Planned at**: commit `e619caf`, 2026-06-26

## Why this matters

`components/DownloadPicker.tsx` was committed (commit "chore: add DownloadPicker")
but it imports two symbols that **do not exist** in `lib/api.ts`
(`listDownloadServers`, `DownloadServer`) and passes a `server` field that
`startDownload` ignores. As a result:

1. `npx tsc --noEmit` fails with 4 errors — the repo's typecheck baseline is red,
   and broken code reached `master`.
2. The picker is dead: it is imported nowhere, so the "choose download server +
   quality" feature it was meant to provide does not work. Downloads currently
   always auto-pick the best quality via `resolveDownloadUrl`.

This plan **finishes the feature** (the chosen direction): implement
`listDownloadServers`, thread a chosen `server` through
`startDownload` → `resolveDownloadUrl`, and wire the existing
`DownloadPicker` modal into the two download buttons (anime detail grid +
watch screen). The final step adds `tsc --noEmit` to the `test` script so a
red typecheck can never merge unnoticed again.

## Current state

### `components/DownloadPicker.tsx` (already written, currently broken)

It expects this API surface (lines 10, 31, 54-59):

```ts
import { listDownloadServers, type DownloadServer } from "../lib/api";
// ...
const [servers, setServers] = useState<DownloadServer[] | null>(null);
listDownloadServers({
  episodeHref: meta.episodeHref, url4up: meta.url4up, url3rb: meta.url3rb,
  epNum: meta.epNum, animeTitle: meta.animeTitle,
}).then((list) => alive && setServers(list))
// on pick:
startDownload({ ...meta, server: { name: s.name, iframeUrl: s.iframeUrl, provider: s.provider, quality: s.quality } });
```

So `DownloadServer` must be `{ name: string; iframeUrl: string; provider: string; quality: string }`
and the picker renders `s.quality === "FHD"` as the privileged pill. The picker
also reads `meta.episodeHref/url4up/url3rb/epNum/animeTitle` — all already on
`DownloadMeta` **except** `epNum`/`animeTitle`, which it derives. NOTE: the
picker calls `listDownloadServers` with `epNum`/`animeTitle` keys, so those must
be accepted by `listDownloadServers` (they are — same shape as
`resolveDownloadUrl`). The picker passes those from `meta`, so `DownloadMeta`
already carries `epNum` and `animeTitle`? **It does not carry `animeTitle` under
that name** — verify: `DownloadMeta.animeTitle` exists (yes, line 42). `epNum`
exists (line 43). Good.

### `lib/api.ts` — existing download helpers (lines 1353-1415)

```ts
const DL_RANK: Record<string, number> = { vid3rb: 0, mp4upload: 1 };

function dlQualityScore(name: string): number {
  const n = (name || "").toLowerCase();
  if (n.includes("fhd") || n.includes("1080")) return 3;
  if (n.includes("hd") || n.includes("720")) return 2;
  if (n.includes("sd") || n.includes("480") || n.includes("360")) return 0;
  return 1;
}

function dlHeaders(provider: string): Record<string, string> { /* ... */ }

export async function resolveDownloadUrl(opts: {
  episodeHref: string; url4up?: string; url3rb?: string;
  epNum?: number | null; animeTitle?: string | null;
}): Promise<{ url: string; headers: Record<string, string>; type: "mp4" } | null> {
  const { episodeHref, url4up, url3rb, epNum, animeTitle } = opts;
  const cands: { name: string; iframeUrl: string; provider: string }[] = [];

  // anime3rb (vid3rb → direct 1080p .mp4) — the best download source.
  try {
    let a3: RawServer[] = [];
    if (url3rb) a3 = await fetchAnime3rbServersByUrl(url3rb);
    else if (animeTitle && epNum != null) a3 = await fetchAnime3rbServers(animeTitle, epNum);
    for (const s of a3) cands.push({ name: s.name, iframeUrl: s.iframeUrl, provider: s.provider });
  } catch {}

  // Primary (witanime/anime4up) — for the mp4upload server.
  try {
    const res = await fetchVideoServers(episodeHref, url4up);
    if (res?.success) for (const s of res.data.servers) cands.push({ name: s.name, iframeUrl: s.iframeUrl, provider: s.provider });
  } catch {}

  const downloadable = cands
    .filter((c) => c.provider in DL_RANK && c.iframeUrl)
    .sort((a, b) => (DL_RANK[a.provider] - DL_RANK[b.provider]) || (dlQualityScore(b.name) - dlQualityScore(a.name)));

  for (const c of downloadable) {
    const r = await resolveVideo(c.iframeUrl, c.provider).catch(() => null);
    const url = r?.success ? r.data?.videoUrl : null;
    if (url && r!.data!.type !== "hls" && !/\.m3u8(\?|$)/i.test(url)) {
      return { url, headers: dlHeaders(c.provider), type: "mp4" };
    }
  }
  return null;
}
```

`RawServer` is defined in `lib/scraper/index.ts:230` as
`{ id: string; name: string; iframeUrl: string; provider: string }` and is
already imported into `api.ts` (line 20).

### `lib/downloads.ts` — `DownloadMeta` + `startDownload` (lines 41-50, 139-177)

```ts
export interface DownloadMeta {
  animeTitle: string; episodeTitle: string; epNum: number | null;
  image: string; animeHref: string; episodeHref: string;
  url4up?: string; url3rb?: string;
}

export async function startDownload(meta: DownloadMeta): Promise<string> {
  // ...
  const resolved = await resolveDownloadUrl({
    episodeHref: meta.episodeHref, url4up: meta.url4up, url3rb: meta.url3rb,
    epNum: meta.epNum, animeTitle: meta.animeTitle,
  });
  // ...
}
```

### Download trigger call-sites (to be re-wired to open the picker)

`app/anime/[id].tsx:613-626` — `onDownloadEp` calls `startDownload(...)` directly.
`app/watch/[episode].tsx:1908-1926` — `onDownload` calls `startDownload(...)` directly
(then `setDownloadStatus("resolving")`).

### Repo conventions

- TypeScript strict mode is on (`tsconfig.json`). No `any` without reason.
- All UI strings come from `lib/i18n.ts` via `import { t } from "../lib/i18n"`.
  The picker's keys (`chooseDownloadServer`, `chooseDownloadServerSub`,
  `loadingServers`, `downloadNoServer`, `cancel`) already exist there.
- Theme tokens come from `lib/theme.ts` (`C`, `R`). Do not hardcode colors.
- Match the existing comment density (these files explain *why*, briefly).

## Commands you will need

| Purpose   | Command                 | Expected on success            |
|-----------|-------------------------|--------------------------------|
| Typecheck | `npx tsc --noEmit`      | exit 0, **no** errors          |
| Tests     | `npm test`              | `22 passed` then `14 passed`   |

There is no lint step and no native build in this workflow. Do **not** run
`expo`/`eas`/`prebuild`.

## Scope

**In scope** (the only files you may modify):
- `lib/api.ts` — add `DownloadServer` type + `listDownloadServers`; extend `resolveDownloadUrl` to honor a chosen server.
- `lib/downloads.ts` — add optional `server` to `DownloadMeta`; pass it through `startDownload`.
- `app/anime/[id].tsx` — open the picker from `onDownloadEp`; mount `<DownloadPicker>`.
- `app/watch/[episode].tsx` — open the picker from `onDownload`; mount `<DownloadPicker>`.
- `package.json` — add `tsc --noEmit` to the `test` script.

**Out of scope** (do NOT touch):
- `components/DownloadPicker.tsx` — it is already correct; only the API it imports is missing. Changing it is a sign you took a wrong turn.
- `lib/i18n.ts` — all needed keys already exist.
- Any other screen, the scraper, or the notifier.

## Git workflow

- Branch: `advisor/001-download-picker`
- Commit style is Conventional Commits (see `git log`: `fix(updates): ...`, `chore: ...`). Example final message: `feat(downloads): wire server/quality picker + add tsc gate`.
- Do NOT push or open a PR unless the operator instructs it.

## Steps

### Step 1: Add `DownloadServer` + `listDownloadServers` to `lib/api.ts`

Just above `export async function resolveDownloadUrl` (line 1379), add:

```ts
export type DownloadServer = { name: string; iframeUrl: string; provider: string; quality: string };

// Quality label for the picker pill. Mirrors dlQualityScore's buckets.
function dlQualityLabel(name: string): string {
  const s = dlQualityScore(name);
  return s === 3 ? "FHD" : s === 2 ? "HD" : s === 0 ? "SD" : "";
}

// Cheap server-list scrape for the download picker: gathers the SAME downloadable
// candidates resolveDownloadUrl uses, but WITHOUT resolving the .mp4 (that happens
// lazily in startDownload once the user picks). Sorted best-first.
export async function listDownloadServers(opts: {
  episodeHref: string; url4up?: string; url3rb?: string;
  epNum?: number | null; animeTitle?: string | null;
}): Promise<DownloadServer[]> {
  const { episodeHref, url4up, url3rb, epNum, animeTitle } = opts;
  const cands: { name: string; iframeUrl: string; provider: string }[] = [];
  try {
    let a3: RawServer[] = [];
    if (url3rb) a3 = await fetchAnime3rbServersByUrl(url3rb);
    else if (animeTitle && epNum != null) a3 = await fetchAnime3rbServers(animeTitle, epNum);
    for (const s of a3) cands.push({ name: s.name, iframeUrl: s.iframeUrl, provider: s.provider });
  } catch {}
  try {
    const res = await fetchVideoServers(episodeHref, url4up);
    if (res?.success) for (const s of res.data.servers) cands.push({ name: s.name, iframeUrl: s.iframeUrl, provider: s.provider });
  } catch {}
  return cands
    .filter((c) => c.provider in DL_RANK && c.iframeUrl)
    .sort((a, b) => (DL_RANK[a.provider] - DL_RANK[b.provider]) || (dlQualityScore(b.name) - dlQualityScore(a.name)))
    .map((c) => ({ name: c.name, iframeUrl: c.iframeUrl, provider: c.provider, quality: dlQualityLabel(c.name) }));
}
```

**Verify**: `npx tsc --noEmit` → the two `DownloadPicker.tsx(10,...)` errors
(`has no exported member 'listDownloadServers' / 'DownloadServer'`) are gone.
Two errors about `server` / implicit `any` may remain until Step 2-3.

### Step 2: Let `resolveDownloadUrl` honor a chosen server

Change the `resolveDownloadUrl` signature to accept an optional `server` and, when
present, try it FIRST (falling back to the existing auto-pick if it fails to yield
a progressive mp4 — so a flaky pick never leaves the user with nothing):

In the `opts` type add: `server?: { iframeUrl: string; provider: string } | null;`

Then, at the very start of the function body (right after destructuring), add:

```ts
  // User-chosen server (from the download picker) takes priority. If it resolves
  // to a progressive mp4, use it; otherwise fall through to the auto-pick below.
  if (opts.server?.iframeUrl && opts.server.provider in DL_RANK) {
    const r = await resolveVideo(opts.server.iframeUrl, opts.server.provider).catch(() => null);
    const url = r?.success ? r.data?.videoUrl : null;
    if (url && r!.data!.type !== "hls" && !/\.m3u8(\?|$)/i.test(url)) {
      return { url, headers: dlHeaders(opts.server.provider), type: "mp4" };
    }
  }
```

(Add `server` to the destructuring or read it as `opts.server` — either is fine;
`opts.server` keeps the diff smaller.)

**Verify**: `npx tsc --noEmit` → no new errors introduced by this file.

### Step 3: Thread `server` through `DownloadMeta` → `startDownload`

In `lib/downloads.ts`:

- Add to `DownloadMeta` (after `url3rb?: string;`):
  ```ts
  /** Optional user-chosen server from the download picker; auto-picks if absent. */
  server?: { name: string; iframeUrl: string; provider: string; quality: string };
  ```
- In `startDownload`, pass it into the `resolveDownloadUrl` call:
  ```ts
  const resolved = await resolveDownloadUrl({
    episodeHref: meta.episodeHref, url4up: meta.url4up, url3rb: meta.url3rb,
    epNum: meta.epNum, animeTitle: meta.animeTitle,
    server: meta.server,
  });
  ```
  (`resolveDownloadUrl`'s `server` type is `{ iframeUrl; provider }`; the wider
  picker object is assignable to it.)

`DownloadItem` and `retryDownload` do **not** need the server — a retry simply
auto-picks again. Leave them unchanged.

**Verify**: `npx tsc --noEmit` → the `DownloadPicker.tsx` `server` error and the
implicit-`any` error are now gone. Expected: **0 errors total.** If any error
remains, STOP (see STOP conditions).

### Step 4: Wire the picker into the anime detail grid (`app/anime/[id].tsx`)

- Add the import near the other component imports:
  `import { DownloadPicker } from "../../components/DownloadPicker";`
  and extend the existing downloads import to include the type:
  `import { startDownload, getDownloads, subscribeDownloads, type DownloadStatus, type DownloadMeta } from "../../lib/downloads";`
- Add picker state next to the `downloads` state (near line 602):
  ```ts
  const [dlPicker, setDlPicker] = useState<DownloadMeta | null>(null);
  ```
- Change `onDownloadEp` (lines 613-626) so that instead of calling
  `startDownload({...})` it builds the same meta object and opens the picker:
  ```ts
  const onDownloadEp = useCallback((ep: GridEpisode) => {
    const primary = ep.href || ep.href4up || ep.href3rb;
    if (!primary) return;
    setDlPicker({
      animeTitle,
      episodeTitle: ep.title || `${t.episode} ${ep.number}`,
      epNum: ep.number ?? null,
      image: poster,
      animeHref,
      episodeHref: primary,
      url4up: ep.href4up || undefined,
      url3rb: ep.href3rb || undefined,
    });
  }, [animeTitle, poster, animeHref]);
  ```
- Mount the modal once, inside the screen's returned JSX tree (anywhere inside the
  root container is fine — place it just before the closing tag of the main
  returned element):
  ```tsx
  <DownloadPicker visible={!!dlPicker} meta={dlPicker} onClose={() => setDlPicker(null)} />
  ```
  The picker calls `startDownload` itself on pick, so `startDownload` no longer
  needs to be called from `onDownloadEp`. The `startDownload` import is now unused
  in this file — **remove it from the import** to keep tsc clean (it will warn as
  an unused import only if `noUnusedLocals` is on; if tsc stays green either way,
  removal is still preferred for tidiness).

**Verify**: `npx tsc --noEmit` → 0 errors.

### Step 5: Wire the picker into the watch screen (`app/watch/[episode].tsx`)

- Add `import { DownloadPicker } from "../../components/DownloadPicker";` and add
  `type DownloadMeta` to the existing `../../lib/downloads` import.
- Add state near `downloadStatus` (around line 1891):
  ```ts
  const [dlPicker, setDlPicker] = useState<DownloadMeta | null>(null);
  ```
- In `onDownload` (lines 1908-1926), replace the `startDownload({...})` +
  `setDownloadStatus("resolving")` block with opening the picker (do NOT set
  `"resolving"` here anymore — the status flips when the user actually picks and
  `startDownload` runs, which the `subscribeDownloads` effect already tracks):
  ```ts
  setDlPicker({
    animeTitle: animeTitle || (animeTitleParam ? decodeURIComponent(animeTitleParam) : ""),
    episodeTitle: title || "",
    epNum: paramEpNum,
    image: imgParam ? decodeURIComponent(imgParam) : "",
    animeHref: animeParam ? decodeURIComponent(animeParam) : animeHref,
    episodeHref: decodeURIComponent(episode),
    url4up: (url4up ? decodeURIComponent(url4up) : undefined) || currentUp4Href || undefined,
    url3rb: url3rb ? decodeURIComponent(url3rb) : undefined,
  });
  ```
  Keep the early-return that jumps to `/downloads` when a download is already
  completed/in-flight.
- Mount `<DownloadPicker visible={!!dlPicker} meta={dlPicker} onClose={() => setDlPicker(null)} />`
  inside the screen's returned JSX (near the other top-level modals/overlays).
- Remove the now-unused `startDownload` from the `../../lib/downloads` import if
  it is no longer referenced anywhere else in the file (search the file for
  `startDownload` first — `getDownloadByEpisode`/`subscribeDownloads` stay).

**Verify**: `npx tsc --noEmit` → 0 errors. `npm test` → unchanged (`22 passed`, `14 passed`).

### Step 6: Add the typecheck gate to `package.json`

Current `test` script (line 11):

```json
"test": "npx --yes tsx lib/relations.test.ts && npx --yes tsx lib/fuzzy.test.ts"
```

Change it to run the typecheck first so a red `tsc` fails the suite:

```json
"test": "npx --yes tsc --noEmit && npx --yes tsx lib/relations.test.ts && npx --yes tsx lib/fuzzy.test.ts"
```

**Verify**: `npm test` → typecheck passes (no output), then `22 passed`, then `14 passed`. Exit 0.

## Test plan

There is no UI test harness in this repo (tests are plain `tsx` scripts for pure
logic — `lib/relations.test.ts`, `lib/fuzzy.test.ts`). Adding a React Native
component test harness is out of scope and not worth it for this change.

Verification is the typecheck + existing unit tests + a manual smoke note for the
reviewer (below). Do **not** add a test framework.

- `npx tsc --noEmit` → 0 errors (was 4).
- `npm test` → typecheck clean, `22 passed`, `14 passed`.

Manual smoke (reviewer, on a dev build — not required to pass this plan): tapping
download on a detail-grid episode and on the watch screen opens the picker;
choosing a server starts the download; the existing progress UI still updates.

## Done criteria

ALL must hold:

- [ ] `npx tsc --noEmit` exits 0 with no errors.
- [ ] `npm test` exits 0 and runs the typecheck first.
- [ ] `grep -rn "listDownloadServers" lib/api.ts` returns the new export.
- [ ] `components/DownloadPicker.tsx` is unchanged (`git diff --stat` shows it not modified).
- [ ] `DownloadPicker` is imported in BOTH `app/anime/[id].tsx` and `app/watch/[episode].tsx`.
- [ ] No files outside the in-scope list are modified (`git status`).
- [ ] `plans/README.md` status row for 001 updated to DONE.

## STOP conditions

Stop and report back (do not improvise) if:

- After Step 3, `npx tsc --noEmit` still reports errors in `DownloadPicker.tsx` —
  the component's expected shape differs from this plan's excerpts (drift).
- `GridEpisode` in `app/anime/[id].tsx` has no `href3rb`/`href4up`/`number`
  fields matching the excerpt (the screen changed since this plan).
- The watch screen's `onDownload` no longer matches the excerpt at lines 1908-1926.
- Any step's typecheck fails twice after a reasonable fix attempt.
- You find yourself needing to edit `components/DownloadPicker.tsx`,
  `lib/i18n.ts`, or any file not in scope.

## Maintenance notes

- The picker resolves the chosen server's `.mp4` lazily inside `startDownload`
  (via `resolveDownloadUrl`'s new `server` branch). If a future change makes
  `resolveVideo` return HLS for these providers, the chosen-server branch will
  fall through to auto-pick — intended.
- `retryDownload` deliberately auto-picks (it does not persist the chosen server
  on `DownloadItem`). If product wants retries to honor the original choice, add
  `server` to `DownloadItem` and pass it back through — deferred as not worth the
  storage churn now.
- Reviewer should confirm the `<DownloadPicker>` modal is mounted exactly once per
  screen and that `startDownload` is no longer called directly in the two screens
  (the picker owns that call now).

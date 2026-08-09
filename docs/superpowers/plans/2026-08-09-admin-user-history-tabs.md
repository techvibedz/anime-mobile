# Admin User History Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate admin user usage and watch history into tabs, recover missing posters from existing history data, make history rows search by anime title, and publish the result to Android preview runtime `3.3.1`.

**Architecture:** Keep both existing admin RPC calls and all profile-level summary data unchanged. Add one optional fallback poster column to the admin history RPC, resolve it in the pure row mapper, and render the two datasets behind local presentation-only tab state. Reuse the existing poster optimizer and search query route.

**Tech Stack:** Expo Router, React Native, TypeScript, expo-image, Supabase PostgreSQL RPCs, EAS Update

---

## File Map

- Modify `lib/adminHistory.ts`: accept `image_fallback` and choose the first non-empty poster URL.
- Modify `lib/adminHistory.test.ts`: prove stored-image precedence and fallback recovery.
- Modify `supabase/admin-watch-history.sql`: return the newest valid poster for the same anime when a row has none.
- Modify `lib/i18n.ts`: add concise Arabic labels for the two tabs.
- Modify `app/user/[id].tsx`: add default usage tab, history tab, poster retry, and search navigation.
- No new runtime dependency or reusable component file.

### Task 1: Recover Missing History Posters

**Files:**
- Modify: `lib/adminHistory.test.ts`
- Modify: `lib/adminHistory.ts`
- Modify: `supabase/admin-watch-history.sql`

- [ ] **Step 1: Write failing mapper tests**

Add `image_fallback` to the existing null-image fixture and add a stored-image precedence assertion:

```ts
assert.equal(
  mapAdminHistoryRow({ image: null, image_fallback: "https://img.example/fallback.jpg" }).image,
  "https://img.example/fallback.jpg",
);

assert.equal(
  mapAdminHistoryRow({
    image: "https://img.example/stored.jpg",
    image_fallback: "https://img.example/fallback.jpg",
  }).image,
  "https://img.example/stored.jpg",
);
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npx --yes tsx lib/adminHistory.test.ts`

Expected: FAIL because `AdminHistoryRow` does not accept `image_fallback` and the mapper returns an empty image.

- [ ] **Step 3: Implement fallback selection in the mapper**

Extend `AdminHistoryRow` and update the image mapping:

```ts
export interface AdminHistoryRow {
  episode_href?: string | null;
  episode_title?: string | null;
  anime_title?: string | null;
  anime_href?: string | null;
  image?: string | null;
  image_fallback?: string | null;
  position_ms?: number | string | null;
  duration_ms?: number | string | null;
  completed?: boolean | null;
  updated_at?: string | null;
}

function firstImage(primary?: string | null, fallback?: string | null): string {
  return primary?.trim() || fallback?.trim() || "";
}
```

In `mapAdminHistoryRow`, replace the current image field with:

```ts
image: firstImage(row.image, row.image_fallback),
```

- [ ] **Step 4: Run the focused test and verify success**

Run: `npx --yes tsx lib/adminHistory.test.ts`

Expected: `adminHistory mapper tests passed`.

- [ ] **Step 5: Extend the admin RPC with a fallback image**

In `supabase/admin-watch-history.sql`, drop and recreate only `admin_user_watch_history(uuid)` because PostgreSQL cannot change an existing function return shape with `create or replace`. Keep the current admin-email check and add `image_fallback text` immediately after `image text` in the return table. Use this select expression after `h.image`:

```sql
(
  select candidate.image
  from public.watch_history candidate
  where lower(btrim(candidate.anime_title)) = lower(btrim(h.anime_title))
    and nullif(btrim(candidate.image), '') is not null
  order by (candidate.user_id = h.user_id) desc, candidate.updated_at desc
  limit 1
) as image_fallback,
```

The function replacement starts with:

```sql
drop function if exists public.admin_user_watch_history(uuid);

create function public.admin_user_watch_history(p_user_id uuid)
returns table (
  episode_href text,
  episode_title text,
  anime_title text,
  anime_href text,
  image text,
  image_fallback text,
  position_ms bigint,
  duration_ms bigint,
  completed boolean,
  updated_at timestamptz
)
```

After creation, retain:

```sql
revoke execute on function public.admin_user_watch_history(uuid) from public, anon;
grant execute on function public.admin_user_watch_history(uuid) to authenticated;
```

- [ ] **Step 6: Apply and verify the RPC in project `iwrphgttbjqifstqttqm`**

Use the locally authenticated Supabase management token without printing it:

```powershell
$tokenPath = "$env:USERPROFILE\.supabase\access-token"
$token = if ($env:SUPABASE_ACCESS_TOKEN) { $env:SUPABASE_ACCESS_TOKEN } else { [IO.File]::ReadAllText($tokenPath).Trim() }
$sql = [IO.File]::ReadAllText("supabase/admin-watch-history.sql")
$body = @{ query = $sql } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "https://api.supabase.com/v1/projects/iwrphgttbjqifstqttqm/database/query" -Headers @{ Authorization = "Bearer $token" } -ContentType "application/json" -Body $body
```

Verify admin execution and fallback values with the same endpoint and this query body:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"zlabia66@gmail.com"}', true);
select image, image_fallback
from public.admin_user_watch_history((select id from auth.users order by created_at limit 1))
where nullif(btrim(image_fallback), '') is not null
limit 1;
rollback;
```

Verify authorization with a second query body:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"not-admin@example.com"}', true);
select * from public.admin_user_watch_history((select id from auth.users order by created_at limit 1));
rollback;
```

Expected: the admin query succeeds; the non-admin query fails with `admin only`.

- [ ] **Step 7: Inspect the focused diff**

Run: `git diff -- lib/adminHistory.ts lib/adminHistory.test.ts supabase/admin-watch-history.sql`

Expected: only fallback-image mapping, tests, and the secured RPC return column changed. Do not commit unless the user requests it.

### Task 2: Add Profile Tabs And Searchable History Rows

**Files:**
- Modify: `lib/i18n.ts`
- Modify: `app/user/[id].tsx`

- [ ] **Step 1: Add tab labels**

Add these keys beside the existing per-user admin strings in `lib/i18n.ts`:

```ts
userUsageTab: "وقت الاستخدام",
userHistoryTab: "سجل المشاهدة",
```

- [ ] **Step 2: Add local tab state and poster sizing import**

In `app/user/[id].tsx`, import `posterUrl`:

```ts
import { posterUrl } from "../../lib/img";
```

Add the local tab type above the screen and initialize it inside the screen:

```ts
type ProfileTab = "usage" | "history";

const [activeTab, setActiveTab] = useState<ProfileTab>("usage");
```

This state is intentionally not persisted, so every mount starts on Spend Time.

- [ ] **Step 3: Add the existing editorial tab treatment**

Insert this control after the chat button and before either list:

```tsx
<View style={s.tabBar} accessibilityRole="tablist">
  {([
    { key: "usage" as const, label: t.userUsageTab },
    { key: "history" as const, label: t.userHistoryTab },
  ]).map((tab) => {
    const active = activeTab === tab.key;
    return (
      <Pressable
        key={tab.key}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        onPress={() => setActiveTab(tab.key)}
        style={[s.tabItem, active && s.tabItemActive]}
      >
        <Text style={[s.tabText, active && s.tabTextActive]}>{tab.label}</Text>
      </Pressable>
    );
  })}
</View>
```

Add styles matching `app/anime/[id].tsx`:

```ts
tabBar: {
  flexDirection: "row", marginTop: 18,
  borderBottomWidth: 1, borderBottomColor: C.line,
},
tabItem: {
  flex: 1, alignItems: "center", justifyContent: "center",
  paddingVertical: 13, borderBottomWidth: 2,
  borderBottomColor: "transparent", marginBottom: -1,
},
tabItemActive: { borderBottomColor: C.ember },
tabText: { color: C.textMuted, fontSize: 14, fontFamily: "Cairo_600SemiBold" },
tabTextActive: { color: C.bone, fontFamily: "Cairo_700Bold" },
```

- [ ] **Step 4: Render only the selected list**

Immediately before the current daily conditional beginning with `{!loaded ? (`, insert:

```tsx
{activeTab === "usage" && (
  <View style={s.tabContent}>
```

Immediately after that conditional's final `)}`, insert:

```tsx
  </View>
)}
```

Delete the standalone history heading:

```tsx
<Text style={s.sectionTitle}>{t.userHistoryTitle}</Text>
```

Immediately before the history conditional beginning with `{!historyLoaded ? (`, insert:

```tsx
{activeTab === "history" && (
  <View style={s.tabContent}>
```

Immediately after that conditional's final `)}`, insert:

```tsx
  </View>
)}
```

Remove the standalone `sectionTitle` before history because the active tab now labels that content. Add:

```ts
tabContent: { paddingTop: 16 },
```

- [ ] **Step 5: Add optimized-to-raw poster retry**

Add this local component above `Summary`:

```tsx
function HistoryPoster({ image }: { image: string }) {
  const raw = image.trim();
  const optimized = posterUrl(raw, 62);
  const [useRaw, setUseRaw] = useState(false);
  const [failed, setFailed] = useState(false);
  const uri = failed ? undefined : useRaw ? raw || undefined : optimized;

  if (!uri) {
    return (
      <View style={[s.historyImage, s.historyImageFallback]}>
        <Ionicons name="film-outline" size={22} color={C.textMuted} />
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={s.historyImage}
      contentFit="cover"
      cachePolicy="memory-disk"
      transition={120}
      onError={() => {
        if (!useRaw && optimized !== raw) setUseRaw(true);
        else setFailed(true);
      }}
    />
  );
}
```

Replace the inline image/fallback branch in each history row with:

```tsx
<HistoryPoster key={entry.image} image={entry.image} />
```

- [ ] **Step 6: Make history rows search by anime title**

Replace each history row root `View` with:

```tsx
<Pressable
  key={entry.episodeHref}
  disabled={!entry.animeTitle}
  accessibilityRole="button"
  accessibilityLabel={entry.animeTitle}
  onPress={() => router.push(`/(tabs)/search?q=${encodeURIComponent(entry.animeTitle)}`)}
  style={({ pressed }) => [s.historyRow, pressed && s.historyRowPressed]}
>
```

Close it with `</Pressable>` and add:

```ts
historyRowPressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
```

- [ ] **Step 7: Type-check and run the focused mapper test**

Run: `npx --yes tsc --noEmit`

Expected: exit code 0.

Run: `npx --yes tsx lib/adminHistory.test.ts`

Expected: `adminHistory mapper tests passed`.

- [ ] **Step 8: Inspect the UI diff**

Run: `git diff -- app/user/[id].tsx lib/i18n.ts`

Expected: two tabs, conditional list rendering, poster retry, and search navigation only. Do not commit unless the user requests it.

### Task 3: Full Verification And Preview OTA

**Files:**
- Verify only: all modified files

- [ ] **Step 1: Run the complete project test gate**

Run: `npm test`

Expected: TypeScript succeeds and every listed test ends with zero failures.

- [ ] **Step 2: Confirm OTA target before publishing**

Run: `npx eas channel:view preview --json --non-interactive`

Expected: preview points to branch `preview`; the current Android update reports runtime `3.3.1`.

- [ ] **Step 3: Publish the Android OTA**

Run:

```powershell
$env:EAS_NO_VCS='1'; npx eas update --branch preview --platform android --message "fix: tabbed admin watch history" --non-interactive
```

Expected: a new Android update group is created for runtime `3.3.1` on branch `preview`.

- [ ] **Step 4: Verify the published update**

Run: `npx eas channel:view preview --json --non-interactive`

Expected: the newest preview update message is `fix: tabbed admin watch history`, platform is Android, and runtime is `3.3.1`.

- [ ] **Step 5: Report without committing**

Report the test result, Supabase authorization check, EAS update group ID, and the fact that all changes remain uncommitted. Do not alter or stage the pre-existing scraper files.

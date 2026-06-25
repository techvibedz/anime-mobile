# Pantoufa — Server Push Notifications (1.4.0)

New-episode notifications that arrive **even when the app is closed**, with the
**anime cover image**, delivered via Expo Push from a Supabase Edge Function
that reads airing data from **AniList**.

> Why a server: the app's sources (witanime/anime4up) are behind Cloudflare,
> which blocks datacenter IPs, so a server can't scrape them. AniList is a free
> open API (airing schedule + cover art) a server *can* use. Titles are matched
> best-effort from the witanime href slug (romaji/English) → AniList; obscure or
> Arabic-only titles may not resolve.

Code already in the repo:
- `supabase/notifications.sql` — `push_tokens`, `anime_mappings`, `notified_episodes`
- `supabase/functions/episode-notifier/index.ts` — the scheduled push job
- `lib/push.ts` — `registerPushTokenAsync` / `unregisterPushTokenAsync`
- `lib/auth.tsx` — registers the device token on sign-in, removes it on sign-out

## What YOU need to do (consoles + credentials)

### 1. Firebase (required for Android push delivery)
1. https://console.firebase.google.com → **Add project** (any name).
2. Add an **Android app** with package name **`com.anime.mobile`**.
3. Download **`google-services.json`** → put it in the repo root.
4. Firebase → Project settings → **Service accounts** → generate a private key
   (JSON) — this is the **FCM V1 service account** for Expo.

### 2. EAS credentials (so Expo Push can deliver to Android)
```
eas credentials            # platform: Android → "Google Service Account" → "FCM V1"
```
Upload the service-account JSON from step 1.4 when prompted.

### 3. app.json (only AFTER google-services.json exists)
Add inside `"android"`:
```json
"googleServicesFile": "./google-services.json"
```
(Leaving this out until the file exists keeps builds from failing. `google-services.json`
is git-ignored — don't commit it.)

### 4. Build 1.4.0
Bump `version` to `1.4.0` in `app.json`, then:
> Note: `runtimeVersion` is now `{ "policy": "fingerprint" }` — do NOT bump it by
> hand. Expo derives it from native code, so all builds with the same native
> fingerprint share one runtime and a single OTA reaches them. To reach users on
> OLD pre-fingerprint APKs, use `npm run publish-ota "<msg>"` (republishes to the
> legacy runtimes listed in `scripts/publish-ota.sh`).
```
npx eas build --platform android --profile preview --non-interactive --no-wait
```
(Push token registration only works in this build — the current 1.3.2 binary has
no FCM credentials, so `getExpoPushTokenAsync` no-ops there.)

### 5. Supabase — schema + function + schedule
```
# schema
supabase db push          # or paste supabase/notifications.sql into SQL Editor

# function (service role key is auto-injected at runtime)
supabase functions deploy episode-notifier --no-verify-jwt
```
Schedule it every 15 min (SQL Editor — needs pg_cron + pg_net, both enable-able
under Database → Extensions):
```sql
select cron.schedule(
  'episode-notifier',
  '*/15 * * * *',
  $$ select net.http_post(
       url := 'https://<PROJECT_REF>.functions.supabase.co/episode-notifier',
       headers := '{"Content-Type":"application/json"}'::jsonb
     ); $$
);
```
Replace `<PROJECT_REF>` with `iwrphgttbjqifstqttqm`.

## Test
1. Install the 1.4.0 APK, sign in → a row appears in `push_tokens`.
2. Manually invoke once to seed (no push on first sight of each anime):
   `supabase functions invoke episode-notifier`
3. When AniList reports a newer episode for a followed anime, the next run pushes
   it (title + episode + cover image), even with the app closed.

## Notes
- First run per anime is **seeded silently** (no backlog flood); only episodes
  airing *after* that notify.
- `notified_episodes` dedups per user, so re-runs never double-notify.
- In-app notification center (`lib/notifications.ts`) still works as before while
  the app is open; this server path is the closed-app + image layer.

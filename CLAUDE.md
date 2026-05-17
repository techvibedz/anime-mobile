# Pantoufa — Session handoff

## Current state (2026-05-17)

### Supabase
- ✅ Project: `iwrphgttbjqifstqttqm` — https://iwrphgttbjqifstqttqm.supabase.co
- ✅ Schema applied (`favorites`, `watch_history`, RLS, indexes)
- ✅ Anon key in `.env` and `eas.json` build envs
- ✅ Google OAuth provider enabled in Supabase dashboard
- ✅ Redirect URLs allowlisted: `anime-mobile://auth-callback`, `anime-mobile://*`, `exp://*`

### Mobile app
- ✅ Auth screens (welcome/login/register/forgot) + AuthProvider + AuthGate
- ✅ Cloud sync for favorites + history (`pullFromCloud` + push)
- ✅ Icons + splash + scheme + plugins wired
- ✅ `lib/api.ts` reads `EXPO_PUBLIC_API_BASE` env var (falls back to LAN IP for dev)

### Server (Express + Puppeteer)
- ✅ Cross-platform `chrome-manager.js` (Linux + Windows; respects `CHROME_BIN`, `SKIP_PREWARM`)
- ✅ `server/Dockerfile` + `.dockerignore` ready (Node 20 + Chromium + Arabic/CJK fonts)
- ✅ `hf-space/Dockerfile` + `hf-space/README.md` — for Hugging Face Docker Space deploy
- ✅ `server/DEPLOY.md` — Hugging Face Spaces deploy guide
- ⚠️ Render free tier was tried first — OOMs on 512MB. HF Spaces (16GB free) is the target.
- ❌ **Not yet deployed** — user needs to run through `server/DEPLOY.md`

## Pending work

1. **User runs `server/DEPLOY.md`** — signs up for Oracle Cloud, provisions ARM VM, deploys Docker container, sets up Caddy + DuckDNS for HTTPS
2. **Update `eas.json`** — add `EXPO_PUBLIC_API_BASE=https://<duckdns-subdomain>.duckdns.org` to both `preview` and `production` env blocks
3. **Rebuild APK** — `eas build -p android --profile preview`
4. Test on phone — auth screens should appear; content should load over the deployed server

## Known minor issues

- `lib/updater.ts:60` — pre-existing tsc error (`runtimeVersion` not on `EmbeddedManifest`). Unrelated to recent changes. expo-updates type drift; runtime is fine.

## Do not

- Don't re-apply Supabase schema — already live
- Don't regenerate auth screens, icons, or sync libs
- Don't commit `.env` — already in `.gitignore`
- Don't add `EXPO_PUBLIC_*` directly to `.env` for the APK — EAS cloud builds need them in `eas.json` `env` blocks (already done for Supabase keys)

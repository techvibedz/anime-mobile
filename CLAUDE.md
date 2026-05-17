# Pantoufa — Session handoff

## Current architecture (2026-05-17)

**Backend-free.** All scraping is done in-app via a hidden WebView. The phone's
residential IP bypasses Cloudflare; the WebView is a real browser so it solves
CF challenges naturally. No server, no hosting, no payment.

### Mobile app
- ✅ Supabase auth + cloud sync (favorites, watch history)
- ✅ Auth screens, AuthGate, AuthProvider
- ✅ Icons, splash, scheme
- ✅ `lib/scraper/` — in-app scraping system
  - `bus.ts` — singleton job queue, promise-based
  - `ScraperHost.tsx` — hidden 1×1 WebView mounted at root, processes jobs serially
  - `scripts.ts` — all extractor JS strings (home/episodes/search/recent/genre/all-anime/video-servers/video-url)
  - `index.ts` — typed scraper API
- ✅ `lib/api.ts` — same public function signatures as before; delegates to scraper
- ✅ Debug screen at `/scraper-debug` (accessible via "Scraper PoC" link on welcome)

### Server (deprecated)
- ⚠️ `server/` is no longer used by the app
- ⚠️ HF Space at `xpirox/pantoufa-server` is no longer needed — safe to delete
- Server code kept in repo for reference; can be removed in a cleanup pass

### Supabase
- Project: `iwrphgttbjqifstqttqm`
- Schema applied (`favorites`, `watch_history`, RLS)
- Google OAuth configured

## Known issues

- `lib/updater.ts:60` — pre-existing TS error on `runtimeVersion`, unrelated
- First scrape after app start is slow (~10-15s) due to WebView cold start + CF clear
- Subsequent scrapes are faster (~3-8s) since cookies are cached
- Bus processes jobs serially — home page (wit + 4up) takes ~20s end-to-end on first load

## Pending

- Test the full in-app rewrite on a real APK build
- If video extraction fails on some providers, consider per-provider extraction scripts in `scripts.ts`
- Delete the HF Space (Settings → Delete this Space) once app is confirmed working
- Eventually remove `server/`, `hf-space/`, `render.yaml` from repo (cleanup pass)
- Remove the "Scraper PoC" link from `app/(auth)/welcome.tsx` after PoC validation

## Do not

- Don't re-add a server URL env var — the app is intentionally backend-free now
- Don't commit `.env`

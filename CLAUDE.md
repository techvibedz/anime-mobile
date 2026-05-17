# Pantoufa — Session handoff (Supabase setup)

The frontend Supabase integration was scaffolded in the previous session. The next session needs to finish setup using the Supabase MCP (now connected).

## State as of handoff

- ✅ `lib/supabase.ts`, `lib/auth.tsx` — Supabase client + AuthProvider
- ✅ `app/(auth)/{welcome,login,register,forgot}.tsx` — auth screens (red/violet glass design)
- ✅ `lib/favorites.ts` + `lib/history.ts` — cloud sync wired (push + pullFromCloud)
- ✅ `app/_layout.tsx` — AuthGate redirects unauthenticated users to `/(auth)/welcome`
- ✅ `assets/{icon,adaptive-icon,splash,favicon}.png` — generated via `scripts/generate-icons.js`
- ✅ `supabase/schema.sql` — `favorites` + `watch_history` tables with RLS
- ✅ `app.json` — icon/splash/scheme/plugins wired
- ✅ `.env` exists with `EXPO_PUBLIC_SUPABASE_URL=https://iwrphgttbjqifstqttqm.supabase.co`
- ❌ `.env` — anon key still empty
- ❌ Supabase database — schema not yet applied
- ❌ Google OAuth provider — not yet configured (optional, can wait)

## What to do on session resume

1. **Verify Supabase MCP tools are available** via ToolSearch (`mcp__supabase__*`)
2. **Apply the schema** — read `supabase/schema.sql` and run via `mcp__supabase__apply_migration` (name it `init_pantoufa_schema`)
3. **Fetch the anon key** — use `mcp__supabase__get_project_url` or `mcp__supabase__get_anon_key` (whichever the MCP exposes). Write it into `.env` replacing the empty `EXPO_PUBLIC_SUPABASE_ANON_KEY=` line. Don't overwrite the URL.
4. **Verify tables exist** — `mcp__supabase__list_tables` should now include `favorites` and `watch_history`
5. **TypeScript check** — `npx --prefix C:/anime-mobile tsc --noEmit --project C:/anime-mobile/tsconfig.json` (must be clean)
6. **Report status** to the user — list what was applied and tell them to run `npx expo start -c` to test

## Supabase project

- Project ref: `iwrphgttbjqifstqttqm`
- URL: https://iwrphgttbjqifstqttqm.supabase.co

## Do not

- Don't re-create auth screens or sync libs — already done
- Don't regenerate icons — already done
- Don't apply schema by asking the user to paste SQL — use the MCP directly
- Don't commit `.env` — already in `.gitignore`

# Pantoufa Server — Render free tier deploy

Goal: deploy this Express + Puppeteer server to **Render free tier** with HTTPS,
get a public URL, then bake that URL into the mobile APK build.

**Trade-offs of free tier:**
- 512 MB RAM cap (Chrome is tuned with `--single-process` and pre-warm disabled to fit)
- Sleeps after 15 min of no traffic → first request after sleep takes ~45 s (cold start + Chrome boot)
- 750 build-hours/month (way more than enough)
- No credit card required
- Auto-HTTPS on `<your-service>.onrender.com`

---

## 1. Push the repo to GitHub (5 min)

Render deploys from a GitHub repo. If your code isn't pushed yet:

```bash
cd C:\anime-mobile
git status
# If there are uncommitted changes, commit them:
git add server/Dockerfile server/.dockerignore server/render.yaml server/DEPLOY.md server/lib/chrome-manager.js lib/api.ts eas.json .env.example
git commit -m "Add Render deploy config + cross-platform chrome-manager"
git push
```

> Don't commit `.env` — only `.env.example` (already gitignored).

---

## 2. Sign up for Render (2 min)

1. Go to https://render.com
2. Click **Get Started** → **Sign in with GitHub** (recommended — auto-authorizes repo access)
3. No credit card. No verification email loops.

---

## 3. Deploy via Blueprint (5 min)

The repo includes `render.yaml` at the **repo root** so Render configures everything for you.

1. Render dashboard → **New +** → **Blueprint**
2. Connect your `techvibedz/anime-mobile` repo (authorize if asked)
3. Render reads `server/render.yaml` → click **Apply**
4. Wait ~5–8 minutes for the first Docker build (Chromium install is the slow step)
5. When the service status flips to **Live**, copy the URL — something like:
   ```
   https://pantoufa-server.onrender.com
   ```

If Render doesn't auto-detect the blueprint at `server/render.yaml`, do it manually:

1. **New +** → **Web Service** → connect repo
2. **Root Directory**: `server`
3. **Runtime**: Docker
4. **Plan**: Free
5. **Region**: Frankfurt (closest to you)
6. **Health Check Path**: `/api/health`
7. **Environment Variables**:
   - `NODE_ENV` = `production`
   - `SKIP_PREWARM` = `1`
   - `PORT` = `3001`
8. **Create Web Service**

---

## 4. Verify the deploy (1 min)

From your laptop:

```bash
curl https://pantoufa-server.onrender.com/api/health
# → {"status":"ok","timestamp":"..."}
```

Hit a real endpoint to confirm Chrome launches:

```bash
curl https://pantoufa-server.onrender.com/api/merged/home
# First call: ~30s (cold start + Chrome boot)
# Subsequent calls: ~2-5s
```

If you see `{"success":true,...}` you're live.

---

## 5. Bake the URL into the APK (3 min)

Edit `C:\anime-mobile\eas.json` — add `EXPO_PUBLIC_API_BASE` to **both** `preview` and `production` `env` blocks:

```json
"env": {
  "EXPO_PUBLIC_SUPABASE_URL": "https://iwrphgttbjqifstqttqm.supabase.co",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY": "eyJ...",
  "EXPO_PUBLIC_API_BASE": "https://pantoufa-server.onrender.com"
}
```

Then rebuild:

```bash
cd C:\anime-mobile
eas build -p android --profile preview
```

Install the new APK — auth screens appear, content loads from anywhere.

---

## Operational notes

- **Logs**: Render dashboard → your service → **Logs** tab (live tail)
- **Manual deploy**: Render dashboard → **Manual Deploy** → **Deploy latest commit** (also auto-deploys on every push)
- **If the service stays slow / OOMs**:
  - Render free tier is genuinely tight on RAM. Watch logs for "killed" or 137 exit codes.
  - If it OOMs often, the realistic upgrade is Render's **Starter plan ($7/mo)** → 512MB → 2GB, no sleep
- **Keep-alive trick** (avoids cold starts): set up a free monitor at https://uptimerobot.com to ping `https://pantoufa-server.onrender.com/api/health` every 5 minutes. The service then never sleeps.
  - ⚠️ This burns through your 750 free hours/month (744 hrs in a 31-day month — you'll be right at the limit). If the service exceeds 750hrs it just stops until next month.
- **Cold start UX**: in the mobile app, you may want to show a friendly "waking server up..." message after 10s of no response. Optional polish.

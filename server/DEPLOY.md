# Pantoufa Server — Hugging Face Spaces deploy

Goal: deploy this Express + Puppeteer server to a **Hugging Face Docker Space**
(free, 16 GB RAM, 2 vCPU, auto-HTTPS), then bake the URL into the mobile APK.

**Why HF Spaces over Render:**
- 16 GB RAM (vs Render free's 512 MB) — Chrome runs comfortably
- 2 vCPUs (vs 0.1)
- No credit card required
- Auto-HTTPS at `https://<user>-pantoufa-server.hf.space`
- Sleeps only after **48 hours** of zero traffic (vs Render free's 15 min)

**One caveat:** HF Spaces are designed for ML/AI demos. A scraper backend is
unusual usage. Risk of takedown is low but non-zero — if HF flags it, fall
back to a paid host.

---

## 1. Sign up for Hugging Face (2 min)

1. Go to https://huggingface.co/join
2. Sign up with email or Google/GitHub. No credit card.
3. Verify email.

---

## 2. Create a Docker Space (2 min)

1. Click your avatar → **+ New Space**
2. Owner: your username
3. Space name: `pantoufa-server`
4. License: pick anything (e.g. `mit`)
5. **Select the Space SDK**: **Docker** → **Blank**
6. Space hardware: **CPU basic** (free, 2 vCPU + 16 GB RAM)
7. Visibility: **Public** (private requires Pro)
8. Click **Create Space**

You now have an empty Space at `https://huggingface.co/spaces/<your-user>/pantoufa-server`.

---

## 3. Push the Space files (5 min)

The repo already includes the two files HF needs in `hf-space/`:
- `Dockerfile` — installs Chromium, clones the server from GitHub, runs it
- `README.md` — required HF frontmatter (port, name, etc.)

Clone the empty Space repo and copy these files in:

```bash
# Pick any working dir
cd C:\
git clone https://huggingface.co/spaces/<your-user>/pantoufa-server hf-pantoufa
cd hf-pantoufa

# Copy the two files from anime-mobile
copy C:\anime-mobile\hf-space\Dockerfile .
copy C:\anime-mobile\hf-space\README.md .

# Push to HF
git add Dockerfile README.md
git commit -m "Initial Docker space"
git push
```

If `git push` asks for credentials:
- Username: your HF username
- Password: a **Write access token** from https://huggingface.co/settings/tokens
  (create one with "Write" role; HF stopped accepting account passwords for git)

---

## 4. Watch the build (~5-8 min)

1. Go to your Space page
2. Top tab **Logs** → watch the Docker build (Chromium install is the slow step)
3. When you see `Server running on http://localhost:3001` and `[Chrome] Ready`,
   it's live
4. Top tab **App** to see the running container

Your URL will be:
```
https://<your-user>-pantoufa-server.hf.space
```

---

## 5. Verify the deploy (1 min)

```powershell
curl.exe https://<your-user>-pantoufa-server.hf.space/api/health
# → {"status":"ok","timestamp":"..."}

curl.exe --max-time 60 "https://<your-user>-pantoufa-server.hf.space/api/merged/home"
# First call: ~10s (Chrome is already warm from boot)
# → {"success":true,...}
```

---

## 6. Bake the URL into the APK (3 min)

Edit `C:\anime-mobile\eas.json` and add `EXPO_PUBLIC_API_BASE` to **both**
`preview` and `production` `env` blocks:

```json
"env": {
  "EXPO_PUBLIC_SUPABASE_URL": "https://iwrphgttbjqifstqttqm.supabase.co",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY": "eyJ...",
  "EXPO_PUBLIC_API_BASE": "https://<your-user>-pantoufa-server.hf.space"
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

- **Update server code**: push to `techvibedz/anime-mobile` on GitHub, then on
  the HF Space go to **Settings → Factory rebuild**. The Dockerfile re-clones
  from the GitHub master branch on each rebuild.
- **Logs**: Space page → **Logs** tab (live tail)
- **Restart without rebuild**: **Settings → Restart this Space**
- **Sleep**: free CPU Spaces sleep after 48 hours of zero traffic. First
  request after sleep wakes the container in ~30 s. UptimeRobot ping every
  6 hours keeps it permanently warm.
- **Region**: HF Spaces are hosted in the US — expect ~150-250 ms round-trip
  from Algeria. Fine for an API, but if you ever care about latency, switch
  to a paid plan with EU region.

---

## Cleaning up the old Render deploy

The Render service you created earlier can be deleted:
1. Render dashboard → `pantoufa-server` → **Settings** → scroll to **Delete Service**
2. (Optional) delete the `render.yaml` from the repo root if you no longer need it.

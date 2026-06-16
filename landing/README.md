# Pantoufa — Landing Page

Static, dependency-free landing page (Arabic RTL) for the Pantoufa anime app.
Anime hero art generated with Higgsfield (soul_2).

## Files
- `index.html` — markup
- `styles.css` — all styling + animations
- `app.js` — particles, scroll reveal, tilt, and **live auto-update**
- `assets/` — `logo.png`, `favicon.png`, `hero.jpg`

## Live auto-update (no redeploy on new versions)
On every visit, `app.js` fetches:

```
https://raw.githubusercontent.com/techvibedz/anime-mobile/master/version.json
```

and uses it to set:
- the download button `href` → `apk_url`
- the version chip / button label → `version`
- the release-notes line → `release_notes`

So when you ship a new APK and bump `version.json` (already part of the release
flow), the page updates itself — **no rebuild, no redeploy needed.**
If the fetch fails, buttons fall back to the GitHub "latest release" page.

## Deploy (pick one)
- **Vercel / Netlify:** drag-drop this `landing/` folder, or point the project at it.
- **GitHub Pages:** move/copy these files to `/docs` on `master`, then
  Settings → Pages → Source: `master` `/docs`.
- **Any static host / Cloudflare Pages:** upload the folder as-is.

No build step. Just serve the folder.

## Local preview
Open `index.html` directly, or:
```
npx serve landing
```

---
title: Pantoufa Server
emoji: 🎬
colorFrom: red
colorTo: purple
sdk: docker
app_port: 3001
pinned: false
short_description: Express + Puppeteer backend for the Pantoufa anime app
---

# Pantoufa Server

Backend API for the [Pantoufa](https://github.com/techvibedz/anime-mobile) mobile app.

This Space builds from the `master` branch of `techvibedz/anime-mobile` on each
factory rebuild. To deploy updates: push to GitHub, then in this Space click
**Settings → Factory rebuild**.

## Endpoints

- `GET /api/health` — health check
- `GET /api/merged/home` — featured + sections
- `GET /api/merged/search?q=` — search
- `GET /api/merged/episodes?url=` — anime detail + episode list
- `GET /api/merged/extract-video?url=` — video servers
- `GET /api/resolve-video?url=` — resolve to direct m3u8/mp4
- `GET /api/proxy-video?url=` — proxy mp4upload CDN

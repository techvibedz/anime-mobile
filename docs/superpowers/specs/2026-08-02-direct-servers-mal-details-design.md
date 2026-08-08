# Direct Servers And MAL Details Repair

## Goal

Restore reliable direct playback and anime enrichment after the v3.3.0 changes, without publishing an OTA update, changing app versions, or modifying release files.

## Server Discovery

- Decode both Witanime registry layouts: the previous `_zX`/`_zK` pair and the current `_zH`/`_zW` pair.
- Keep the existing Anime4up static server parser as a source of candidate embeds.
- Classify `app.videas.fr` separately so its static MP4 can use native playback.
- Fix mp4upload media matching to require an actual `.mp4` URL path. A hostname containing `mp4upload.com` must not make CSS or JavaScript assets look playable.

## Server Visibility

The picker will use a provider allowlist backed by live direct-media tests. It will show:

- Anime3rb/vid3rb
- streamwish-family hosts
- videa.hu
- app.videas.fr

It will hide providers currently requiring an embed page or failing native media validation, including mp4upload, Dailymotion, VOE, DoodStream, OK.ru, Yonaplay, generic/unknown hosts, and Anime4up first-party embed pages. Mp4upload extraction remains supported, but repeated live CDN timeouts keep it hidden until media validation is consistently reliable. A provider can be restored later only after a direct extractor and media validation test pass.

## MAL And Details

- Keep Jikan title search as the primary enrichment path.
- If Jikan title search fails, use AniList title matching to obtain the correct `idMal` and structured details.
- Fetch `https://myanimelist.net/anime/<idMal>` and parse the actual MAL score and information fields.
- Never label AniList's `averageScore` as a MAL score.
- If direct MAL is unavailable, show AniList-derived details but leave the MAL badge empty.
- Cache successful enrichment only; transient empty results remain retryable.

## Verification

- Add parser regression checks for the new Witanime registry aliases and the mp4upload CSS false positive.
- Add MAL HTML parser checks and a fallback-flow check where Jikan fails.
- Run the existing full test command.
- Test current provider samples and require a successful direct media response, preferably an HTTP Range response, before keeping a provider visible.
- Do not run the OTA publish command or alter `app.json`, `package.json` version, or `version.json`.

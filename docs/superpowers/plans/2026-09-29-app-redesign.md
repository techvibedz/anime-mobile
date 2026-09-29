# Pantoufa redesign

**Goal:** Redesign every screen locally for Expo testing, preserving the exact palette and existing functionality.

**Architecture:** Recompose route layouts and reuse existing chrome, poster slots and state views. No new dependencies or changes to scraping, authentication, playback, downloads or admin permissions.

**Direction contract:** A personal screening room. Dark tonal panels, artwork-led browsing, generous Arabic typography, restrained periwinkle/mint accents, 48dp controls and permanently labeled main navigation. The first viewport has a compact masthead, featured art with protected title/playback actions, then an unboxed resume rail. Candidate 4, seed a7fa0be3, code-led; user selected “Straight to Expo”.

**Finish:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

- [x] Shared chrome, posters, navigation, and states.
- [x] Home, discovery, library, details, player.
- [x] Welcome, login, registration, recovery.
- [x] All catalog, account, social, news, admin and diagnostic routes.
- [x] Typecheck, existing regression checks and local Android Metro bundle.
- [x] Local Expo development server on port 8081. No publish, release, version bump or commit.

## Verification

`npm test`, `npx tsc --noEmit`, `node scripts/check-ui-dev.cjs`, and Android
`expo export` passed. The export is a local bundle check in the approved temp
directory, not a release. Expo Go is serving at `exp://192.168.1.3:8081`.
There are no connected ADB devices and no configured AVDs, so native visual
verification is pending the user's device review. Source review and design
documentation were performed inline; no subagents or new image assets were used.

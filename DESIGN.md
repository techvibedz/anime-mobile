# Design

Visual system for Pantoufa. Register: **spatial** (glass panels floating in depth).
Identity: **HOLO SPATIAL** — a from-scratch language that replaced "SUMI — Ink &
Ember". Vibe: Apple Vision Pro / visionOS — a neutral near-black void with
translucent LIGHT glass panels, heavy blur, soft periwinkle→mint iridescence, and
generous rounding. Dimensional and layered where Sumi was flat editorial print.

> Supersedes the Sumi (Ink & Ember) and Void docs. Tokens below mirror
> `lib/theme.ts`, the single source of truth. Token *names* were kept stable
> across Sumi→Holo so screens re-skin via cascade; only the values changed. The
> `ember`/`violet` aliases now resolve to the Holo **periwinkle** accent.

## Color

Neutral void + a two-hue periwinkle/mint accent. Contrast is against `bg` (#08090C).

### Backgrounds — the void + glass panels
- `bg` / `ink` #08090C — neutral near-black canvas (OLED-true)
- `bgDeep` #050507 — deepest void
- `surface` / `inkRaised` #14161C — opaque raised panel (cards/fallbacks, safe default)
- `surfaceLight` / `inkHigh` #1C1F27 — pressed / elevated opaque
- `surfaceGlass` rgba(255,255,255,0.08), `glass` rgba(255,255,255,0.07) — TRUE glass;
  pair with `expo-blur` `BlurView` for the visionOS frosted-panel look
- `player` #000000, `playerSheet` #0A0B0F — true-black video + sheets

### Accent — two-hue iridescence
- `accent` / `ember` / `periwinkle` #8B93FF — Play · active · live · primary CTA.
  Light periwinkle → use `textOnAccent` #0A0B12 (dark ink) for labels on it.
- `mint` #5EEAD4 — secondary hue; pairs with periwinkle in gradients/glows.
- `accentSoft` rgba(139,147,255,0.14), `accentGlow` rgba(139,147,255,0.30).
- Gradients: periwinkle→mint (`meshViolet`/`meshPink`) carry the spatial shimmer.

### Semantic (one meaning each)
- `gold` #FFCE5C (ratings), `success` #4ADE80, `cyan`/`mint` #5EEAD4 (source tag),
  `error` #FF6B6B.

### Text — pure-white ramp (AA-verified on the void)
- `text` / `bone` #FFFFFF (~19:1) — headings, primary
- `textSecondary` #B4B8C5 (~9:1) — secondary/meta
- `textMuted` #8A8F9E (~5.2:1) — lowest readable (AA floor)
- `textFaint` #4A4E5A — DECORATIVE ONLY (idle icons, hairlines). Never text.
- Over artwork: lay a scrim so text clears 4.5:1 against the darkened plate.

## Typography — clean spatial sans

Kept from Sumi (families are bundled in the APK — OTA can't add fonts — and the
measures are proven). Holo carries identity through color/glass/depth/rounding,
not a type overhaul.
- **Outfit** (`F.display` = Outfit_900Black) — Latin display/headings.
- **DM Sans** (`F.body…`) — Latin body/labels.
- **Cairo** (`AR.*`) — ALL static Arabic chrome (Outfit can't render Arabic;
  Latin fonts under-measure Arabic and spill in RTL rows).
- Scale `T`: `display 40/−1.0 · h1 30/−0.7 · h2 21 · body 14/23`.

## Spacing & Radius

- `S` 4pt scale, generous spatial rhythm (`marginSection 34`).
- `R` **soft visionOS rounding** (bigger than Sumi's crisp print): posters
  `R.lg 16`, sheets `R.xl 22`, chips `R.sm 12`, pills `R.pill 100`. Glass reads as
  pebbles floating in depth.
- Touch targets ≥44.

## Elevation — depth + gentle bloom

- `ELEVATION_CARD` — soft ambient float (glass hovers over the void; offset y10,
  radius 24).
- `ELEVATION_GLOW` / `_VIOLET` — **soft periwinkle bloom** on active/elevated glass
  (visionOS light-spill). Holo permits a gentle colored halo (Sumi banned it).
- `ELEVATION_NAV` — upward shadow for floating nav / sheets.

## Motion — motion-forward

Holo leans into motion (the identity is "heavily animated"). Use **Reanimated**
(already a dep) on the UI thread for 60fps:
- Staggered fade+rise entrances on rails/cards; parallax on the hero; spring on
  press (scale ~0.97); shared-element-feel transitions where cheap.
- Reduced motion REQUIRED — `lib/motion.ts` `useReducedMotion()` gates
  carousels/parallax/stagger. Never gate content visibility on a transition.

## Components & Patterns (Holo)

- **Masthead** — bone wordmark led by a periwinkle spark; sits on a frosted
  `BlurView` bar that fades in over the hero.
- **Marquee hero** — full-bleed art, AA scrim, big bone display title, genres as
  glass chips, periwinkle→mint gradient Play + frosted-glass ghost My List.
- **Section header** — periwinkle marginal mark + heavy bone title; "see all" ash.
- **Poster card** — artwork-first, `R.lg` soft, glass rim border, ambient float +
  optional periwinkle bloom on press; rank as oversized numeral.
- **Floating nav** — frosted `BlurView` bar + rim hairline; active tab = light
  glass chip with periwinkle icon/label + a small periwinkle spark dot.
- **Glass** — the Holo signature. Frosted `BlurView` panels for bars, sheets,
  chips, and over-art overlays — purposeful depth, not flat fills everywhere.

## RTL & i18n

RTL-first. Static Arabic → `AR.*` (Cairo). Avoid `gap` with `row-reverse`
(RN 0.81 Yoga bug — use margins). Numerals/romaji on Latin stack.

## Absolute bans

- No neon (Holo bloom is SOFT, low-opacity — not a hard glow). No gradient text.
- No periwinkle as a default surface/border fill — the accent marks the
  privileged action/state only. No muted text below the AA floor. No nested cards.
- White text directly on the periwinkle accent (too low contrast) — use
  `textOnAccent` dark ink instead.

## Styling mechanism

Migrating to **NativeWind** (`className`), token values mirrored in
`tailwind.config.js`. Hybrid by necessity: `className` for the static skin
(color/radii/spacing/border/type); `style` retained for dynamic props (width,
aspectRatio), RN shadows (`ELEVATION_*`), `textShadow`, `absoluteFill`, and
third-party components (`expo-image`, `LinearGradient`, `BlurView`).

## Rollout status

- ✅ Token core swapped to Holo (`lib/theme.ts` + `tailwind.config.js`) — whole app
  cascades to the new palette/radii/elevation. `tsc` green.
- ✅ NativeWind wired (`tailwind.config.js` was the missing piece); `CatalogCard`
  piloted to `className`.
- ⏳ Per-screen structural recompose (real `BlurView` glass + Reanimated motion),
  in priority order: home → anime detail → search → my-list → watch/player →
  downloads → auth → the rest. Plus a sweep of hardcoded rgba values that don't
  cascade (`CatalogCard` badge, `MalRating`, `title/[id]`).

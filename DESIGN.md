# Design

Visual system for Pantoufa. Register: **product** (design serves the content).
Identity: **SUMI — Ink & Ember**. A from-scratch language that replaced the old
neon-on-navy "Void". Vibe: an editorial film-house / cinema journal — warm
ink-black paper, bone-white type, a single ember spark. High-contrast, type-led,
hairlines instead of glow. Deliberately departs from the AI-default "dark-navy +
neon + glass" anime app.

> Supersedes both the original green `#06C149` doc AND the interim quieter-Void
> doc. Tokens below mirror `lib/theme.ts`, the single source of truth. Token
> *names* were kept stable across the Void→Sumi switch so screens re-skin via
> cascade; only the values changed.

## Color

Warm ink ramp + one ember accent. Contrast ratios are against `bg` (#0A0A0B).

### Backgrounds — tonal steps, not glass
- `bg` / `ink` #0A0A0B — warm near-black canvas (OLED-true)
- `bgDeep` #050506 — deepest void
- `surface` / `inkRaised` #141416 — cards, rails, sheets
- `surfaceLight` / `inkHigh` #1C1C1F — pressed / elevated
- `player` #000000, `playerSheet` #0C0C0E — true-black video + sheets

### Accent — EMBER (the single spark)
- `accent` / `ember` #FF5A2C — Play · active · live · primary CTA only. Never a
  default surface/border fill. Reserved so one ember reads as emphasis.
- `accentSoft` rgba(255,90,44,0.12), `accentGlow` rgba(255,90,44,0.22)
- `violet*` names survive but now resolve to the ember family (#FF7A4F) — Sumi is
  single-accent; old call sites stay coherent.

### Semantic (one meaning each)
- `gold` #E8B84B (ratings), `success` #34D17E, `cyan` #5FC6D8 (Embed source tag),
  `error` #FF5747.

### Text — warm editorial ramp (AA-verified on ink)
- `text` / `bone` #F4F1EA (~17:1) — headings, primary
- `textSoft` rgba(244,241,234,0.86) — body
- `textSecondary` / ash #A8A29A (~7:1) — secondary/meta
- `textMuted` #8C867D (~4.9:1) — lowest readable (AA floor)
- `textFaint` #565049 — DECORATIVE ONLY (idle icons, hairlines). Never text.
- Over artwork: lay a scrim so text clears 4.5:1 against the darkened plate.

## Typography — type-led

Paired on a contrast axis; never two similar sans.
- **Outfit** (`F.display` = Outfit_900Black) — Latin display/headings, heavy + tight.
- **DM Sans** (`F.body…`) — Latin body/labels (humanist contrast pair).
- **Cairo** (`AR.*`) — ALL static Arabic chrome (incl. Arabic headings; Outfit
  can't render Arabic). Latin fonts under-measure Arabic and spill in RTL rows.
- Scale `T`: bigger + tighter at the top — `display 40/−1.0 · h1 30/−0.7 · h2 21 ·
  body 14/23`. New `T.index` numeral (01/02…) is a Sumi section signature.
- *(A true editorial serif display would be ideal but needs an APK build to
  bundle a font — OTA can't add one. Grotesk carries the editorial weight now.)*

## Spacing & Radius

- `S` 4pt scale, generous editorial rhythm (`marginSection 34`, section gaps >>
  in-card gaps).
- `R` crisper / more print than Void: posters `R.lg 10`, sheets `R.xl 14`,
  pills `R.pill 100`. Less bubbly.
- Touch targets ≥44.

## Elevation — hairlines, no glow

- `ELEVATION_CARD` — soft ambient black lift (the only shadow Sumi leans on).
- `ELEVATION_GLOW` / `_VIOLET` — names survive but now resolve to a **neutral
  ambient lift** (no colored halo), so every inherited "glow" call site is a clean
  shadow. Ember is carried by fill/text/indicators, never by a halo.
- `ELEVATION_NAV` — upward shadow for floating nav / sheets.

## Motion

- Ease-out + light spring on press. Reduced motion REQUIRED — `lib/motion.ts`
  `useReducedMotion()` gates carousels/shimmers (already wired: home hero,
  Shimmer, search skeleton). Never gate content visibility on a transition.

## Components & Patterns (Sumi)

- **Masthead** — bone wordmark led by an ember spark mark.
- **Marquee hero** — full-bleed art, AA scrim, big bone display title, genres as
  hairline outline tags, ember Play + ghost (outline) My List.
- **Section header** — crisp 3px ember marginal rule + heavy bone Cairo title;
  "see all" stays ash (ember reserved).
- **Poster card** — artwork-first, `R.lg` crisp, hairline border, ambient lift,
  no per-card glow; rank as oversized editorial numeral.
- **Floating nav** — flat ink bar + hairline; active tab = quiet ink-high chip
  with ember icon/label + a small ember spark dot (not a filled accent blob).
- **Sidebar** — right-aligned RTL list, ember active rule on the reading edge.
- **Glass** — purposeful on player/over-art overlays only, not decorative.

## RTL & i18n

RTL-first. Static Arabic → `AR.*` (Cairo). Avoid `gap` with `row-reverse`
(RN 0.81 Yoga bug — use margins). Numerals/romaji on Latin stack.

## Absolute bans

- No colored glow anywhere (Sumi is hairlines + ambient shadow).
- No gradient text. No accent as default surface/border fill — ember marks the
  privileged action only. No muted text below the AA floor. No nested cards.
- No side-stripe (>1px colored) accents on cards/rows (the sidebar active rule is
  an intentional edge indicator, not a card stripe).

## Rollout status

Proof shipped: `lib/theme.ts` (Sumi tokens, cascades everywhere), floating nav,
sidebar crisp pass, and the **Home** screen recomposed editorially. Remaining
screens adopt the palette via cascade; their per-screen structural recompose
(detail, search, my-list, downloads, player, auth) is the next pass — plus a
sweep of the last few hardcoded old-navy rgba values (CatalogCard, MalRating,
title/[id]).

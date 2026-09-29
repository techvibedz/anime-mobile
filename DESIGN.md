---
name: Pantoufa
description: A personal screening room, in the original dark, periwinkle and mint palette.
colors:
  bg: "#08090C"
  bg-deep: "#050507"
  surface: "#14161C"
  surface-container: "#101218"
  surface-light: "#1C1F27"
  accent: "#8B93FF"
  mint: "#5EEAD4"
  text: "#FFFFFF"
  text-secondary: "#B4B8C5"
  text-muted: "#8A8F9E"
  text-on-accent: "#0A0B12"
  gold: "#FFCE5C"
  success: "#4ADE80"
  error: "#FF6B6B"
typography:
  display:
    fontFamily: Cairo_700Bold
    fontSize: "36px"
    lineHeight: "52px"
    fontWeight: 700
  headline:
    fontFamily: Cairo_700Bold
    fontSize: "30px"
    lineHeight: "44px"
    fontWeight: 700
  title:
    fontFamily: Cairo_700Bold
    fontSize: "22px"
    lineHeight: "34px"
    fontWeight: 700
  body:
    fontFamily: Cairo_500Medium
    fontSize: "14px"
    lineHeight: "24px"
    fontWeight: 500
rounded:
  sm: "12px"
  md: "14px"
  lg: "16px"
  xl: "22px"
spacing:
  sm: "8px"
  md: "12px"
  lg: "16px"
  content: "20px"
  section: "34px"
  touch: "48px"
  input: "56px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.text-on-accent}"
    rounded: "{rounded.md}"
    height: "56px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    height: "56px"
---

# Design System: Pantoufa

## Overview

**Creative North Star: "The Personal Screening Room"**

A cinematic, content-first mobile interface for relaxed night viewing. Anime
artwork carries the visual energy; navigation and account tools use calm tonal
surfaces, readable Arabic typography and generous separation between sections.
This redesign replaces the ornamental Holo glass treatment while preserving
every existing color value in `lib/theme.ts`.

**Key Characteristics:** artwork-first, restrained accents, visible navigation
labels, confident typography, comfortable controls.

## Colors

`lib/theme.ts` is the source of truth. The complete `C` palette is unchanged,
including compatibility aliases (`ember`, `violet`, `ink`) and overlay tokens.
`tailwind.config.js` mirrors the NativeWind subset.

Periwinkle marks playback, primary actions and selection. Mint supports secondary
status and social actions. Gold is reserved for ratings; success/error retain
their semantic roles. Neutral surfaces range from `bgDeep` through
`surfaceContainer`, `surface` and `surfaceLight`.

**The Foreground Rule.** Filled periwinkle, mint and success controls use
`textOnAccent`, never white labels. Text over artwork needs a dark scrim.
`textFaint` is decorative, never body or placeholder text.

## Typography

Static Arabic chrome uses Cairo (500/600/700). Latin headings and numerical
displays use Outfit; Latin body copy uses DM Sans. All three families are loaded
in `app/_layout.tsx`. Arabic tracking is zero and the shared `TAr` ramp reserves
enough line height for Arabic glyphs. Operational copy is generally 13–16dp;
page titles are 24–34dp. Keep text scaling enabled.

## Layout

Phone-first, with 20dp content gutters and 28dp gutters on account forms. Browse
grids default to three compact columns, with saved two-column and horizontal
list options. A 48dp header action cycles the layouts in one press (compact →
comfortable → list); it does not add a separate button row above the content.
Every page remembers its own choice (per-page key) — changing search never
affects My List, and each page restores its saved layout on the next launch.
Grid cards are the artwork alone: the title is overlaid on the poster over the
bottom scrim (two lines max) and the row gap is the only space between cards, so
no caption or metadata can ever stretch a row. List rows keep an inline title,
subtitle and metadata row. Horizontal home
rails use 140dp posters and 200dp episode thumbnails. The featured composition
is 440dp high, below a separate masthead.

Bottom navigation always displays the three destination labels and respects
system-bar insets. Secondary headers use 48dp back/menu controls and right-aligned
titles at 28dp; sidebar destination labels are 18dp. Account forms scroll and retain keyboard avoidance. Player controls are
landscape-oriented; dialogs and server lists remain bounded and scrollable.

Use plain rows plus explicitly ordered children for fixed-control/flexible-text
layouts. Avoid `gap` with `row-reverse` on React Native 0.81. Reserve bottom
content padding for fixed navigation and playback bars.

## Elevation & Depth

Tonal contrast supplies most depth. Posters are unframed; settings use one
grouped surface; activity/download/schedule rows use quiet dividers. Blur remains
functional in overlays and sheets, rather than decorating every component.
Compatibility `ELEVATION_*` tokens remain available to existing overlays.
Sidebar and sheet transitions respect the existing reduced-motion hook.

## Shapes

Controls use `R.md` (14dp); artwork uses `R.lg` (16dp). Sheets use `R.xl` or
`R.xxl` (22/26dp). Circular avatars and playback controls keep their familiar
shapes. Pills are reserved for compact badges and metadata.

## Components

- **Home:** compact masthead, protected artwork/title composition, primary Play
  and secondary saved-list action, then an unboxed resume rail and content rails.
- **Navigation:** permanently labeled destinations with a quiet active panel.
- **PosterCard:** shared artwork plus an overlaid grid title and completion
  slots; accessible title labels and pressed feedback. Bottom badges sit above
  the 48dp title band. Preserve source, rating and completion data.
- **Discover/library:** prominent title, readable search/filter controls and
  user-selectable compact, comfortable and list layouts. Keep filters and data
  intact when the FlatList remounts to change its column count.
- **Details:** overlapping poster/title treatment, synopsis, quiet genre tags,
  episode tabs and a persistent playback action.
- **Account forms:** open layout, 56dp tonal fields and clear primary actions.
  Keep validation, email confirmation and recovery controls.
- **News:** large image, readable headline and a clear reading action, separated
  by space rather than nested panels.
- **Social:** calm message bubbles and compact 48dp composer actions; preserve
  keyboard-safe positioning and closed-thread state.
- **StateView:** one shared empty/error/loading anatomy with actionable recovery.

## Do's and Don'ts

- Do preserve the exact palette and existing functional behavior.
- Do prioritize artwork, reading order, comfortable touch targets and safe areas.
- Do use Cairo for Arabic and honor reduced motion.
- Don't add ambient neon, gratuitous glass, gradient text or repetitive icon tiles.
- Don't use white text on a light accent fill or hide essential navigation labels.
- Don't publish an update during local UI evaluation.

Local verification: the Android Metro export, TypeScript and the existing test
suite passed. No phone/emulator was connected; rendered-device review remains
the user's Expo testing step. No new raster assets were introduced.

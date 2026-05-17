---
name: Anime
colors:
  bg: "#181A20"
  surface: "#1F222A"
  surface-light: "#262A35"
  border: "#35383F"
  accent: "#06C149"
  accent-dim: "#059639"
  white: "#FFFFFF"
  text-primary: "#FFFFFF"
  text-secondary: "#9E9E9E"
  text-muted: "#6B6B6B"
  overlay: "rgba(24,26,32,0.85)"
  overlay-tab-bar: "rgba(24,26,32,0.75)"
  overlay-surface-frost: "rgba(31,34,42,0.7)"
  gold: "#FFB800"
  orange: "#FF6B35"
  black: "#000000"
  white-border-clear: "rgba(255,255,255,0.06)"
  white-border-soft: "rgba(255,255,255,0.08)"
  white-border-light: "rgba(255,255,255,0.12)"
  white-divider-wisp: "rgba(255,255,255,0.04)"
  white-control-dim: "rgba(255,255,255,0.3)"
  white-text-soft: "rgba(255,255,255,0.85)"
  black-overlay-medium: "rgba(0,0,0,0.5)"
  black-overlay-strong: "rgba(0,0,0,0.7)"
  black-badge-bg: "rgba(0,0,0,0.6)"
  accent-overlay: "rgba(6,193,73,0.85)"
typography:
  display:
    fontFamily: System
    fontSize: 30px
    fontWeight: "900"
    lineHeight: 36px
  heading-1:
    fontFamily: System
    fontSize: 28px
    fontWeight: "800"
    lineHeight: 34px
  heading-2:
    fontFamily: System
    fontSize: 26px
    fontWeight: "800"
    lineHeight: 32px
  heading-3:
    fontFamily: System
    fontSize: 18px
    fontWeight: "700"
    lineHeight: 24px
  body:
    fontFamily: System
    fontSize: 14px
    fontWeight: "400"
    lineHeight: 22px
  body-small:
    fontFamily: System
    fontSize: 13px
    fontWeight: "500"
    lineHeight: 18px
  caption:
    fontFamily: System
    fontSize: 12px
    fontWeight: "600"
    lineHeight: 16px
  caption-small:
    fontFamily: System
    fontSize: 10px
    fontWeight: "500"
    lineHeight: 14px
  badge:
    fontFamily: System
    fontSize: 9px
    fontWeight: "800"
    lineHeight: 11px
    letterSpacing: 0.05em
  button:
    fontFamily: System
    fontSize: 15px
    fontWeight: "700"
    lineHeight: 20px
  button-ghost:
    fontFamily: System
    fontSize: 15px
    fontWeight: "600"
    lineHeight: 20px
  label:
    fontFamily: System
    fontSize: 15px
    fontWeight: "600"
    lineHeight: 20px
  tab:
    fontFamily: System
    fontSize: 11px
    fontWeight: "600"
    lineHeight: 14px
  rank:
    fontFamily: System
    fontSize: 44px
    fontWeight: "900"
    lineHeight: 44px
rounded:
  xs: 3px
  sm: 6px
  DEFAULT: 8px
  md: 10px
  lg: 12px
  pill-sm: 13px
  pill: 14px
  xl: 16px
  pill-lg: 20px
  2xl: 26px
  circle: 32px
  full: 9999px
spacing:
  unit: 4px
  gap-tight: 6px
  gap: 8px
  gap-relaxed: 12px
  padding-button-h: 14px
  padding-card: 10px
  padding-content: 20px
  margin-action: 18px
  margin-section: 28px
  margin-section-header: 14px
  margin-content-top: 24px
  push: 30px
  touch-target: 40px
  input-height: 48px
  tab-bar-offset: 70px
elevation:
  card:
    shadowColor: "#000000"
    shadowOffset:
      width: 0
      height: 4
    shadowOpacity: 0.3
    shadowRadius: 8px
    elevation: 6
motion:
  fade-screen: "fade 200ms"
  shimmer-duration: 1200ms
  carousel-interval: 5000ms
  press-opacity: 0.85
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.white}"
    typography: "{typography.button}"
    rounded: "{rounded.2xl}"
    paddingHorizontal: "{spacing.push}"
    paddingVertical: 13px
    flexDirection: row
    alignItems: center
    gap: "{spacing.gap}"
  button-ghost:
    backgroundColor: transparent
    textColor: "{colors.accent}"
    typography: "{typography.button-ghost}"
    rounded: "{rounded.2xl}"
    paddingHorizontal: 24px
    paddingVertical: 13px
    borderWidth: 1.5px
    borderColor: "{colors.accent}"
    flexDirection: row
    alignItems: center
    gap: "{spacing.gap}"
  button-glass:
    backgroundColor: "{colors.white-border-light}"
    textColor: "{colors.white}"
    typography: "{typography.button-ghost}"
    rounded: "{rounded.2xl}"
    paddingHorizontal: 22px
    paddingVertical: 13px
    flexDirection: row
    alignItems: center
    gap: "{spacing.gap-tight}"
  button-pill:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.white}"
    typography: "{typography.body}"
    rounded: "{rounded.pill-lg}"
    paddingHorizontal: 24px
    paddingVertical: 10px
  chip-glass:
    backgroundColor: "{colors.white-border-soft}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.caption}"
    rounded: "{rounded.DEFAULT}"
    paddingHorizontal: 10px
    paddingVertical: "{spacing.unit}"
    flexDirection: row
    alignItems: center
    gap: "{spacing.unit}"
  chip-outline:
    backgroundColor: transparent
    textColor: "{colors.text-secondary}"
    typography: "{typography.caption}"
    rounded: "{rounded.xl}"
    paddingHorizontal: "{spacing.padding-button-h}"
    paddingVertical: "{spacing.gap-tight}"
    borderWidth: 1px
    borderColor: "{colors.border}"
  chip-server:
    backgroundColor: "{colors.white-border-soft}"
    textColor: "{colors.text-secondary}"
    typography: "{typography.caption}"
    rounded: "{rounded.lg}"
    paddingHorizontal: 12px
    paddingVertical: "{spacing.gap-tight}"
    maxWidth: 120px
  chip-server-active:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.white}"
  badge-new:
    backgroundColor: "{colors.orange}"
    textColor: "{colors.white}"
    typography: "{typography.badge}"
    rounded: 4px
    paddingHorizontal: "{spacing.gap-tight}"
    paddingVertical: 2px
  badge-rating:
    backgroundColor: "{colors.black-badge-bg}"
    textColor: "{colors.gold}"
    typography: "{typography.caption-small}"
    rounded: "{rounded.sm}"
    paddingHorizontal: "{spacing.gap-tight}"
    paddingVertical: 3px
    flexDirection: row
    alignItems: center
    gap: 3px
  badge-tab-count:
    backgroundColor: "{colors.surface-light}"
    textColor: "{colors.white}"
    typography: "{typography.tab}"
    rounded: "{rounded.md}"
    paddingHorizontal: "{spacing.gap}"
    paddingVertical: 2px
  badge-tab-count-active:
    backgroundColor: "{colors.accent}"
  badge-bookmark:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.pill-sm}"
    width: 26px
    height: 26px
    alignItems: center
    justifyContent: center
  card-anime:
    width: 130px
    height: 195px
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    borderWidth: 1px
    borderColor: "{colors.white-border-clear}"
    overflow: hidden
  card-episode:
    width: 115px
    height: 115px
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    borderWidth: 1px
    borderColor: "{colors.white-border-clear}"
    overflow: hidden
  card-search:
    flex: 1
    imageAspectRatio: "3 / 4"
    imageRounded: "{rounded.lg}"
    imageBackgroundColor: "{colors.surface}"
    title:
      typography: "{typography.caption}"
      marginTop: "{spacing.gap-tight}"
    subtitle:
      typography: "{typography.caption-small}"
      marginTop: 2px
  row-episode:
    flexDirection: row
    alignItems: center
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "{spacing.padding-card}"
    marginBottom: "{spacing.padding-card}"
    thumbnail:
      width: 100px
      height: 60px
      rounded: "{rounded.DEFAULT}"
      backgroundColor: "{colors.surface-light}"
      playOverlay:
        width: 28px
        height: 28px
        rounded: "{rounded.pill}"
        backgroundColor: "{colors.accent-overlay}"
  input-search:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.white}"
    placeholderColor: "{colors.text-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    height: "{spacing.input-height}"
    paddingHorizontal: "{spacing.padding-button-h}"
    flexDirection: row
    alignItems: center
    gap: "{spacing.padding-card}"
  tab-bar:
    position: absolute
    bottom: 0
    height: "{spacing.tab-bar-offset}"
    paddingBottom: 12px
    paddingTop: "{spacing.padding-card}"
    backgroundColor: transparent
    borderTopWidth: 0.5px
    borderTopColor: "{colors.white-border-soft}"
    blurIntensity: 60
    blurTint: dark
    blurBackground: "{colors.overlay-tab-bar}"
    activeColor: "{colors.accent}"
    inactiveColor: "{colors.text-muted}"
  tab-content-item:
    paddingVertical: "{spacing.padding-button-h}"
    paddingHorizontal: "{spacing.unit}"
    marginRight: "24px"
    borderBottomWidth: 2px
    borderBottomColor: transparent
    flexDirection: row
    alignItems: center
    gap: "{spacing.gap-tight}"
  tab-content-item-active:
    borderBottomColor: "{colors.accent}"
  top-bar-button:
    width: "{spacing.touch-target}"
    height: "{spacing.touch-target}"
    rounded: "{rounded.pill-lg}"
    backgroundColor: "{colors.overlay-surface-frost}"
    alignItems: center
    justifyContent: center
  dot-pagination:
    width: 6px
    height: 6px
    rounded: "{rounded.xs}"
    backgroundColor: "{colors.white-control-dim}"
  dot-pagination-active:
    width: 20px
    backgroundColor: "{colors.accent}"
  shimmer:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.DEFAULT}"
    opacityRange:
      low: 0.25
      high: 0.6
  loading-indicator:
    color: "{colors.accent}"
    size: large
  error-circle:
    width: 64px
    height: 64px
    rounded: "{rounded.circle}"
    backgroundColor: "{colors.surface}"
  info-row:
    flexDirection: row
    paddingVertical: "{spacing.gap}"
    borderBottomWidth: 1px
    borderBottomColor: "{colors.white-divider-wisp}"
    label:
      textColor: "{colors.text-muted}"
      typography: "{typography.body-small}"
      width: 110px
    value:
      textColor: "{colors.text-secondary}"
      typography: "{typography.body-small}"
  hero-gradient:
    colors:
      - "rgba(24,26,32,0.15)"
      - transparent
      - "rgba(24,26,32,0.6)"
      - "{colors.bg}"
    locations:
      - 0
      - 0.25
      - 0.7
      - 1
  banner-gradient:
    colors:
      - "rgba(24,26,32,0.3)"
      - transparent
      - "rgba(24,26,32,0.7)"
      - "{colors.bg}"
    locations:
      - 0
      - 0.15
      - 0.65
      - 1
  card-gradient:
    colors:
      - transparent
      - "rgba(0,0,0,0.7)"
    position: absolute
    bottom: 0
    height: 70px
---

# Brand & Style

The design system embodies a **dark cinematic aesthetic** inspired by premium streaming platforms. The brand personality is immersive, moody, and content-forward — the interface deliberately recedes so the anime artwork commands all attention.

The chosen style is **Depth-First Dark Mode** with translucent overlays and blur effects that create a sense of floating layers. Every surface sits at a deliberate elevation, using semi-transparent backgrounds and subtle borders rather than heavy solid fills. The emotional response is calm focus — the deep navy-grays of the background act as a void that makes poster art, the single green accent, and white typography feel electrically vibrant.

## Colors

The palette is built on a **monochromatic dark neutral scale** with a single vivid accent. The dark background series (`#181A20` → `#1F222A` → `#262A35`) creates depth through subtle tonal shifts rather than stark contrast jumps.

- **Background (`bg`):** A deep navy-tinted black (`#181A20`) that serves as the canvas. Slightly warmer and more sophisticated than pure black, it provides separation from the video player's pure `#000000` background.
- **Surfaces:** Each step up is a 4–6% lightness increment, creating visible but quiet layering. Cards (`#1F222A`) feel distinct from the background; active states (`#262A35`) register as pressed without breaking the dark theme.
- **Borders:** The `#35383F` border color is used for definitive separators (dividers, outline chips), while translucent white borders (`rgba(255,255,255,0.06)` and `0.08`) provide subtle edge definition on cards and glass surfaces.
- **Accent Green (`#06C149`):** The single brand color. A saturated, energetic green that demands attention wherever it appears — play buttons, active tab indicators, "See All" links, carousel dots, loading spinners, server chips, and bookmark states. It is never used as a background fill anywhere except primary action buttons.
- **Gold (`#FFB800`):** Reserved exclusively for star ratings. A warm signal color that contrasts the green accent without competing.
- **Orange (`#FF6B35`):** Reserved exclusively for "NEW" badges. A high-energy, attention-grabbing color used sparingly for temporal content labeling.
- **Text:** Three-step hierarchy — bright white (`#FFFFFF`) for primary content, neutral gray (`#9E9E9E`) for supporting text and metadata, and deep gray (`#6B6B6B`) for muted/de-emphasized labels. This strictly linear contrast ladder maintains legibility without introducing additional hues.
- **Overlays & Glass:** Semi-transparent variants of the background color (`rgba(24,26,32,...)`) are used for the tab bar blur, hero/banner gradients, and screen overlays. This keeps the UI chromatically coherent — everything traces back to the base dark palette.

## Typography

The design system uses the **system default sans-serif font** (San Francisco on iOS, Roboto on Android) for zero-overhead loading and platform-native feel. No custom fonts are bundled.

- **Weight as Hierarchy:** Font weight, not size alone, carries the hierarchy. The hero title uses `900` (Black), section headings use `700` (Bold), cards use `600` (Semi-Bold), labels use `500` (Medium). This creates perceptible visual layers without requiring multiple font families.
- **Hero & Detail Titles:** The largest type (`30px` / `26px`) carries maximum weight (`900` / `800`) with tight line heights to feel urgent and cinematic.
- **Screen Headings:** Page-level titles ("Search", "My List") use `28px` at `800` weight, positioned at the top of the screen with generous breathing room.
- **Section Headings:** `18px` at `700` weight with `#FFFFFF` color — prominent but subordinate to the hero.
- **Body Text:** `14px` at normal weight with `22px` line height for the synopsis block. This is spacious enough for readability at small mobile sizes while keeping 3-line truncation compact.
- **Captions & Metadata:** `12px` / `10px` sizes carry secondary and tertiary information (anime type, ratings, episode counts). The color shifts to `textSecondary` or `textMuted` to de-emphasize.
- **Badges:** `9px` at `800` weight with slight letter-spacing for the "NEW" pill — tiny but incredibly punchy.
- **Buttons:** `15px` at `700` weight for primary actions, `600` for ghost/outline variants. Large enough to feel tappable, small enough to sit beside large hero titles.

## Layout & Spacing

The layout follows a **fluid, content-driven model** with consistent horizontal padding (`20px` / `PAD`) on all screens. Elements are organized into horizontal scrolling shelves, vertical lists, and full-bleed hero sections.

- **Horizontal Scrolling Shelves:** The primary content pattern. Each section (Recently Added, Latest Episodes) renders a horizontal `ScrollView` with `12px` gaps between cards and `20px` edge padding. This allows quick browsing without leaving the home screen.
- **Card Grids:** Search and My List use a 3-column grid with `12px` gaps. Cards are `flex: 1` with a `3:4` aspect ratio image (slightly wider than the `2:3` portrait cards on the home screen for visual variety).
- **Vertical Rhythm:** Sections are separated by `28px` top margin. Section headers have `14px` bottom margin before their content row. Action buttons follow content by `18px`. These spacings are deliberately not on a rigid grid — they adapt to content density.
- **Hero Carousel:** Full screen-width slides at `500px` height with bottom-aligned content. The gradient fade at the bottom creates a reading surface without obscuring the background image.
- **Tab Bar:** `70px` tall with `10px` top padding and `12px` bottom padding, overlaid with a `BlurView` at 60 intensity and a `rgba(24,26,32,0.75)` tint. The tab bar has a `0.5px` translucent top border.
- **Safe Areas:** All screens respect dynamic island / notch safe areas. The detail screen's floating top bar positions at `insets.top + 8px`.

## Elevation & Depth

Depth is achieved through **tonal layering and translucency**, not shadow-based elevation (which is used sparingly).

- **The Depth Stack:**
  - **Level 0 — Background:** Solid `#181A20` fill. The deepest layer.
  - **Level 1 — Surface:** `#1F222A` for cards, episode rows, and search bars. Subtly lighter than the background, creating visual separation.
  - **Level 2 — Surface Light:** `#262A35` for pressed states and shimmer effects. Noticeably lighter to signal interactivity.
  - **Level 3 — Floating Overlays:** Glass-effect elements like the tab bar use `BlurView` with `rgba(24,26,32,0.75)` tinting. Top navigation buttons use `rgba(31,34,42,0.7)`.
  - **Level 4 — Video Player Overlay:** Pure `rgba(0,0,0,...)` translucent layers for server picker and control buttons, creating a separate color context for the video experience.
- **Card Shadows:** The only true shadow in the system is on anime cards: `shadowOffset: {0, 4}`, `shadowOpacity: 0.3`, `shadowRadius: 8`, `elevation: 6`. This lifts cards above the flat scroll surface for a tactile feel.
- **Gradient Fades:** Hero carousel and detail banner use 4-stop linear gradients that transition from near-transparent to the solid `bg` color, creating a smooth "fade to background" effect that anchors floating content.
- **Edge Definition:** Cards and glass elements use whisper-thin `rgba(255,255,255,0.06)` or `0.08` borders. These are perceptible only on close inspection but prevent surfaces from blending into each other on OLED displays.

## Shapes

The shape language is **rounded and soft**, designed for a mobile-first, touch-friendly experience. All interactive elements use generous border radii to feel approachable.

- **Cards & Media:** `12px` radius on anime cards, episode cards, and poster images. This is the default "rounded container" shape.
- **Action Buttons:** `26px` radius (pill shape) for the primary green play button and ghost outline buttons. These are the most prominent interactive elements and feel button-like at a glance.
- **Input Fields:** `14px` radius on the search bar — intermediate between pill and card, optimized for horizontal text entry.
- **Chips & Tags:** `8px` for meta chips (rating, genres in detail view), `16px` for standalone genre pills, and `12px` (pill-ish) for server selector chips. The variety in chip radii differentiates their roles.
- **Navigation Controls:** `20px` radius for circular back buttons and top bar controls. These are perfectly circular given their `40px` dimensions.
- **Badges & Indicators:** Tight radii — `4px` for "NEW" badges, `6px` for rating badges, `3px` for inactive carousel dots. Small elements need small curves to maintain crispness.
- **Loading & Error States:** `8px` default for shimmer placeholders, `32px` (circular) for the error icon container.

## Components

### Buttons & Actions

The **button-primary** is the highest-emphasis call-to-action: solid green fill (`#06C149`), pill-shaped (`26px` radius), white icon + label with `8px` gap, generous horizontal padding (`30px`). It sits on dark backgrounds with maximum contrast.

The **button-ghost** is a secondary action: transparent fill, `1.5px` green border, green text/icon. Used for "My List" bookmark toggle — visually distinct from the play button while retaining the brand color.

The **button-glass** is a tertiary action with `rgba(255,255,255,0.12)` background — used for "Details" on the hero carousel. It reads as a translucent pill that floats over the hero image.

The **button-pill** is an inline action (e.g., "Go back" on error states): solid green, `20px` radius, compact padding. Smaller and less prominent than primary buttons.

### Cards & Media

All cards share a common DNA: dark surface background, `12px` radius, `1px` translucent border, and poster image filling the container. The **card-anime** variant (130×195px, 2:3 portrait) includes a bottom gradient fade for the rank number overlay. The **card-episode** variant (115×115px, square-ish) is more compact for horizontal shelf browsing. The **card-search** variant uses a `3:4` aspect ratio image in a flex-based grid layout. Card titles and subtitles sit below the image with `6px` and `2px` top margins respectively.

### Episode List Rows

Episode rows in the detail screen use a horizontal layout: `100×60px` thumbnail with `8px` radius, a centered play circle overlay (`28px`, `14px` radius, `rgba(6,193,73,0.85)` background), followed by title + type text. The entire row is `C.surface` with `12px` radius and `10px` padding. On press, the background shifts to `C.surfaceLight`.

### Tab Bars & Navigation

The **tab-bar** is a floating glass bar: absolute-positioned at the bottom, `70px` tall, with `expo-blur` `BlurView` at intensity 60 with `dark` tint and `rgba(24,26,32,0.75)` overlay. Active tab uses green icon/label with `11px` / `600` weight label; inactive uses `#6B6B6B`.

Detail screen tabs (Episodes / Related / Info) use an inline tab bar with `2px` green underline on the active tab, `15px` / `600` weight text (white when active, muted when inactive), and optionally a count badge (`surfaceLight` background, `10px` radius, turns green when active).

### Search Bar

The search bar is a `48px` tall rounded container (`14px` radius) with `C.surface` background, `18px` search icon in `textMuted` color on the left, a white text input (`15px`), and a clear button on the right. Placeholder text uses `textMuted` color.

### Chips & Tags

Two chip variants: **chip-glass** (`8px` radius, translucent white background) for inline meta (rating, genres next to the title), and **chip-outline** (`16px` radius, transparent with `C.border` stroke) for standalone genre tags below the synopsis. Server chips on the watch screen use `12px` radius with translucent background, switching to solid green with white text when active.

### Loading & Empty States

**Shimmer** placeholders use `C.surface` with animated opacity cycling between `0.25` and `0.6` over 1200ms (ease-in-out). Shimmers match the exact dimensions of the content they replace — cards use `12px` radius, hero uses `0` radius, action buttons use `24px` radius. **ActivityIndicator** spinners use `C.green` at `large` size. Empty states show a large Ionicons glyph in `textMuted` or `border` color with a centered message.

### Video Player

The watch screen locks to landscape orientation and uses a `WebView` filling the screen with pure black background (`#000000`). Floating control buttons (`40px` circles, `20px` radius, `rgba(0,0,0,0.5)` background) are positioned `10px` from the top corners. The server picker sits at the bottom in a `rgba(0,0,0,0.7)` bar with `12px` radius pill chips and `6px` gaps. The episode title renders centered behind the top controls in `rgba(255,255,255,0.85)` at `13px`.

## Motion

- **Screen Transitions:** Stack screens use a `fade` animation (200ms). There are no slide or push transitions — screens dissolve in and out for a cinematic feel.
- **Carousel:** The hero carousel auto-advances every 5 seconds with smooth horizontal paging. Manual swipe interrupts the timer briefly.
- **Shimmer:** A looping opacity animation (1200ms per cycle, ease-in-out) creates a breathing loading effect.
- **Press Feedback:** All `Pressable` components reduce to `0.85` opacity on press for immediate tactile feedback. Episode rows additionally shift their background color.

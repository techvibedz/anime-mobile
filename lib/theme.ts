// Pantoufa "HOLO SPATIAL" Design System — visionOS Glass & Depth
// A from-scratch identity replacing "SUMI — Ink & Ember". The vibe is Apple
// Vision Pro / visionOS: a neutral near-black void with translucent LIGHT glass
// panels floating in depth, heavy blur, soft periwinkle→mint iridescence, and
// generous rounding. Where Sumi was flat editorial print (hairlines, no glow),
// Holo is spatial and dimensional — layered frosted glass, gentle colored bloom,
// big soft corners. See DESIGN.md / PRODUCT.md.
//
// Token NAMES are kept stable from the Sumi/Void eras so every screen adopts Holo
// via cascade; only the VALUES changed. The `ember`/`violet` aliases now resolve
// to the Holo periwinkle accent so old call sites stay coherent. New Holo-native
// aliases (mint, glass tokens) are added alongside for new code to read intent.

export const C = {
  // Backgrounds — neutral near-black "void" the glass floats over
  bg: "#08090C",            // void — default canvas (neutral near-black, OLED-true)
  bgDeep: "#050507",        // deepest void
  surface: "#14161C",       // raised opaque panel — cards/fallbacks (safe default)
  surfaceLight: "#1C1F27",  // pressed / elevated opaque
  surfaceElevated: "#1C1F27",
  surfaceContainer: "#101218",
  surfaceGlass: "rgba(255,255,255,0.08)",  // TRUE glass (pair with expo-blur)
  surfaceCard: "rgba(255,255,255,0.06)",

  // Holo-native background aliases (new code may read these for intent)
  ink: "#08090C",
  inkRaised: "#14161C",
  inkHigh: "#1C1F27",

  // Accent — PERIWINKLE. The primary spatial spark: Play · active · live · CTA.
  // Holo is two-hue: periwinkle primary + mint secondary (see below), used in
  // gradients and glows for the visionOS iridescence.
  accent: "#8B93FF",
  accentSoft: "rgba(139,147,255,0.14)",
  accentGlow: "rgba(139,147,255,0.30)",
  accentMuted: "#6E77E6",
  ember: "#8B93FF",         // alias → periwinkle (old "ember" call sites)
  emberDeep: "#6E77E6",

  // Secondary — MINT. The second Holo hue; pairs with periwinkle in gradients.
  mint: "#5EEAD4",
  mintSoft: "rgba(94,234,212,0.14)",
  mintGlow: "rgba(94,234,212,0.24)",

  // `violet*` aliases survive → resolve to the periwinkle family so old call
  // sites stay coherent (Holo primary is periwinkle).
  violet: "#8B93FF",
  violetSoft: "rgba(139,147,255,0.12)",
  violetGlow: "rgba(139,147,255,0.20)",

  // Utility / semantic — each ONE meaning
  gold: "#FFCE5C",          // ratings only (brightened for the vibrant register)
  goldSoft: "rgba(255,206,92,0.16)",
  cyan: "#5EEAD4",          // "Embed" source tag (mint family)
  success: "#4ADE80",
  successSoft: "rgba(74,222,128,0.16)",
  error: "#FF6B6B",

  // Text — pure-white spatial ramp. Contrast ratios are against `bg` (#08090C).
  text: "#FFFFFF",            // ~19:1
  textSoft: "rgba(255,255,255,0.88)",
  bone: "#FFFFFF",
  textSecondary: "#B4B8C5",  // ~9:1 — secondary/meta
  textMuted: "#8A8F9E",      // ~5.2:1 — lowest readable (AA floor)
  textFaint: "#4A4E5A",      // DECORATIVE ONLY (idle icons, hairlines)
  textOnAccent: "#0A0B12",   // dark ink on light periwinkle (reads ~6:1)
  textOnSurfaceVariant: "#B4B8C5",
  white: "#FFFFFF",
  black: "#000000",

  // Borders — bright glass rim-lights (light edge that catches the "light")
  border: "rgba(255,255,255,0.10)",
  borderSoft: "rgba(255,255,255,0.06)",
  borderLight: "rgba(255,255,255,0.16)",   // top glass rim
  borderAccent: "rgba(139,147,255,0.35)",
  borderViolet: "rgba(139,147,255,0.25)",
  glowLine: "rgba(139,147,255,0.12)",
  line: "rgba(255,255,255,0.09)",

  // Glass — the Holo signature (purposeful frosted panels, pair with expo-blur)
  glass: "rgba(255,255,255,0.07)",
  glassBorder: "rgba(255,255,255,0.14)",

  // Overlays — traced back to the void so everything stays chromatically coherent
  overlay: "rgba(8,9,12,0.92)",
  overlayMedium: "rgba(8,9,12,0.72)",
  overlayTabBar: "rgba(8,9,12,0.80)",
  overlaySurface: "rgba(8,9,12,0.76)",
  overlayLight: "rgba(8,9,12,0.50)",
  overlayBlack50: "rgba(0,0,0,0.55)",
  overlayBlack70: "rgba(0,0,0,0.7)",
  scrim: "rgba(0,0,0,0.6)",
  controlDim: "rgba(255,255,255,0.3)",
  dividerWisp: "rgba(255,255,255,0.06)",

  // Player / bottom-sheet surfaces
  player: "#000000",
  playerSheet: "#0A0B0F",

  // Ambient tints (for LinearGradient arrays) — periwinkle + mint iridescence
  meshViolet: "rgba(139,147,255,0.12)",
  meshPink: "rgba(94,234,212,0.08)",
  meshCyan: "rgba(139,147,255,0.05)",
} as const;

/* ── Font families ────────────────────────────────
 * Holo is clean-sans led. Latin display/headings = Outfit (heavy grotesk, tight),
 * body/labels = DM Sans, all static Arabic chrome = Cairo (Latin fonts under-
 * measure Arabic glyphs and spill in tight RTL rows). Families are bundled in the
 * APK (OTA can't add a font), so they carry across the Sumi→Holo switch unchanged. */
export const F = {
  display: "Outfit_900Black",
  black: "Outfit_900Black",
  heading: "Outfit_700Bold",
  headingSemi: "Outfit_600SemiBold",
  body: "DMSans_400Regular",
  bodyMedium: "DMSans_500Medium",
  bodySemi: "DMSans_600SemiBold",
  bodyBold: "DMSans_700Bold",
} as const;

export const AR = {
  bold: "Cairo_700Bold",
  semibold: "Cairo_600SemiBold",
  medium: "Cairo_500Medium",
} as const;

/* ── Arabic type scale (TAr) ─────────────────────
 * Mirrors T's size/lineHeight/letterSpacing steps but swaps the family to Cairo,
 * because Outfit can't render Arabic. Letter-spacing is 0 (Arabic doesn't track). */
export const TAr = {
  display: { fontSize: 36, fontFamily: AR.bold, fontWeight: "700" as const, lineHeight: 40, letterSpacing: 0 },
  h1: { fontSize: 30, fontFamily: AR.bold, fontWeight: "700" as const, lineHeight: 34, letterSpacing: 0 },
  h2: { fontSize: 22, fontFamily: AR.bold, fontWeight: "700" as const, lineHeight: 26, letterSpacing: 0 },
  h3: { fontSize: 16, fontFamily: AR.semibold, fontWeight: "600" as const, lineHeight: 21, letterSpacing: 0 },
  body: { fontSize: 14, fontFamily: AR.medium, fontWeight: "500" as const, lineHeight: 23, letterSpacing: 0 },
  bodySmall: { fontSize: 13, fontFamily: AR.semibold, fontWeight: "600" as const, lineHeight: 18, letterSpacing: 0 },
  caption: { fontSize: 11, fontFamily: AR.semibold, fontWeight: "600" as const, lineHeight: 14, letterSpacing: 0 },
  label: { fontSize: 15, fontFamily: AR.semibold, fontWeight: "600" as const, lineHeight: 20, letterSpacing: 0 },
} as const;

// Type scale — clean spatial hierarchy. Kept from Sumi (bundled families, proven
// measures); Holo carries its identity through color/glass/depth/rounding, not a
// type overhaul. Each step carries its own family so call sites can `...T.h2`.
export const T = {
  display: { fontSize: 40, fontFamily: F.display, fontWeight: "900" as const, lineHeight: 42, letterSpacing: -1.0 },
  h1: { fontSize: 30, fontFamily: F.display, fontWeight: "900" as const, lineHeight: 33, letterSpacing: -0.7 },
  h2: { fontSize: 21, fontFamily: F.heading, fontWeight: "700" as const, lineHeight: 25, letterSpacing: -0.3 },
  h3: { fontSize: 16, fontFamily: F.headingSemi, fontWeight: "600" as const, lineHeight: 21 },
  body: { fontSize: 14, fontFamily: F.body, fontWeight: "400" as const, lineHeight: 23 },
  bodySmall: { fontSize: 13, fontFamily: F.bodyMedium, fontWeight: "500" as const, lineHeight: 18 },
  caption: { fontSize: 11, fontFamily: F.bodySemi, fontWeight: "600" as const, lineHeight: 14 },
  captionSmall: { fontSize: 10, fontFamily: F.bodyMedium, fontWeight: "500" as const, lineHeight: 13 },
  badge: { fontSize: 9, fontFamily: F.display, fontWeight: "900" as const, lineHeight: 11, letterSpacing: 1.0 },
  button: { fontSize: 14, fontFamily: F.bodySemi, fontWeight: "600" as const, lineHeight: 18, letterSpacing: 0.1 },
  buttonGhost: { fontSize: 14, fontFamily: F.bodySemi, fontWeight: "600" as const, lineHeight: 18 },
  label: { fontSize: 15, fontFamily: F.bodySemi, fontWeight: "600" as const, lineHeight: 20 },
  tab: { fontSize: 11, fontFamily: F.bodySemi, fontWeight: "600" as const, lineHeight: 14 },
  index: { fontSize: 13, fontFamily: F.display, fontWeight: "900" as const, lineHeight: 14, letterSpacing: 0.5 },
  rank: { fontSize: 52, fontFamily: F.black, fontWeight: "900" as const, lineHeight: 52, letterSpacing: -2 },
} as const;

export const S = {
  unit: 4,
  xs: 6,
  gapTight: 6,
  gap: 8,
  sm: 8,
  gapRelaxed: 12,
  md: 12,
  lg: 16,
  xl: 20,
  paddingButtonH: 14,
  paddingCard: 12,
  paddingContent: 20,
  marginAction: 18,
  marginSection: 34,
  marginSectionHeader: 16,
  marginContentTop: 24,
  push: 30,
  xxl: 32,
  xxxl: 44,
  touchTarget: 44,
  inputHeight: 50,
  navHeight: 64,
  tabBarHeight: 72,
} as const;

// Radii — soft, generous "visionOS" rounding (bigger than Sumi's crisp print
// curves). Glass panels read as pebbles floating in depth.
export const R = {
  xs: 8,
  sm: 12,
  default: 14,
  md: 14,
  lg: 16,          // posters
  pillSm: 14,
  pill: 100,
  xl: 22,          // sheets / large surfaces
  pillLg: 20,
  xxl: 26,
  circle: 9999,
} as const;

// Default depth cue — soft ambient float (glass panels hover over the void).
export const ELEVATION_CARD = {
  shadowColor: "#000000",
  shadowOffset: { width: 0, height: 10 },
  shadowOpacity: 0.45,
  shadowRadius: 24,
  elevation: 10,
} as const;

// Holo DOES allow a gentle colored bloom (unlike Sumi's hard no-glow rule) — a
// soft periwinkle halo on active/elevated glass, evoking the visionOS light spill.
export const ELEVATION_GLOW = {
  shadowColor: "#8B93FF",
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.38,
  shadowRadius: 18,
  elevation: 8,
} as const;

export const ELEVATION_GLOW_VIOLET = {
  shadowColor: "#8B93FF",
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.38,
  shadowRadius: 18,
  elevation: 8,
} as const;

export const ELEVATION_NAV = {
  shadowColor: "#000000",
  shadowOffset: { width: 0, height: -8 },
  shadowOpacity: 0.5,
  shadowRadius: 28,
  elevation: 14,
} as const;

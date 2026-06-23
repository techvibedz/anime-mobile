// Pantoufa "SUMI" Design System — Ink & Ember
// A from-scratch identity replacing the old neon-on-navy "Void". The vibe is an
// editorial film-house / cinema journal: warm ink-black paper, bone-white type,
// and a single ember spark. Where Void was arcade, Sumi is print — high contrast,
// type-led, hairlines instead of glow. Departs deliberately from the AI-default
// "dark-navy + neon + glass" anime app. See DESIGN.md / PRODUCT.md.
//
// Token NAMES are kept stable from the Void era so every screen adopts Sumi via
// cascade; only the VALUES changed. New Sumi-native aliases (ink/bone/ember…) are
// added alongside for new code to read intent.

export const C = {
  // Backgrounds — warm near-black "ink", tonal steps (no glass-by-default)
  bg: "#0A0A0B",            // ink — default canvas (warm black, OLED-true)
  bgDeep: "#050506",        // deepest void
  surface: "#141416",       // inkRaised — cards, rails, sheets
  surfaceLight: "#1C1C1F",  // inkHigh — pressed / elevated
  surfaceElevated: "#1C1C1F",
  surfaceContainer: "#141416",
  surfaceGlass: "rgba(20,20,22,0.66)",
  surfaceCard: "rgba(28,28,31,0.82)",

  // Sumi-native background aliases (new code may read these for intent)
  ink: "#0A0A0B",
  inkRaised: "#141416",
  inkHigh: "#1C1C1F",

  // Accent — EMBER. The single warm spark: Play · active · live · primary CTA.
  // Used sparingly; never a default surface/border fill.
  accent: "#FF5A2C",
  accentSoft: "rgba(255,90,44,0.12)",
  accentGlow: "rgba(255,90,44,0.22)",
  accentMuted: "#D6431D",
  ember: "#FF5A2C",
  emberDeep: "#D6431D",

  // Secondary — collapsed to the ember family (Sumi is single-accent). These
  // names survive so old `violet*` call sites stay coherent instead of breaking.
  violet: "#FF7A4F",
  violetSoft: "rgba(255,90,44,0.10)",
  violetGlow: "rgba(255,90,44,0.16)",

  // Utility / semantic — each ONE meaning
  gold: "#E8B84B",          // ratings only
  goldSoft: "rgba(232,184,75,0.14)",
  cyan: "#5FC6D8",          // "Embed" source tag
  success: "#34D17E",
  successSoft: "rgba(52,209,126,0.14)",
  error: "#FF5747",

  // Text — contrast ratios are against `bg` (#0A0A0B). Warm editorial ramp.
  text: "#F4F1EA",            // bone — ~17:1
  textSoft: "rgba(244,241,234,0.86)",
  bone: "#F4F1EA",
  textSecondary: "#A8A29A",  // ash — ~7:1
  textMuted: "#8C867D",      // ashDim — ~4.9:1, readable AA floor
  textFaint: "#565049",      // DECORATIVE ONLY (idle icons, hairlines)
  textOnAccent: "#FFFFFF",
  textOnSurfaceVariant: "#A8A29A",
  white: "#FFFFFF",
  black: "#000000",

  // Borders — hairlines, no glow
  border: "rgba(244,241,234,0.07)",
  borderSoft: "rgba(244,241,234,0.05)",
  borderLight: "rgba(244,241,234,0.11)",
  borderAccent: "rgba(255,90,44,0.24)",
  borderViolet: "rgba(255,90,44,0.18)",
  glowLine: "rgba(255,90,44,0.08)",
  line: "rgba(244,241,234,0.08)",

  // Glass — purposeful (player/over-art overlays), not decorative everywhere
  glass: "rgba(244,241,234,0.045)",
  glassBorder: "rgba(244,241,234,0.10)",

  // Overlays — traced back to ink so everything stays chromatically coherent
  overlay: "rgba(10,10,11,0.92)",
  overlayMedium: "rgba(10,10,11,0.72)",
  overlayTabBar: "rgba(10,10,11,0.80)",
  overlaySurface: "rgba(10,10,11,0.76)",
  overlayLight: "rgba(10,10,11,0.50)",
  overlayBlack50: "rgba(0,0,0,0.55)",
  overlayBlack70: "rgba(0,0,0,0.7)",
  scrim: "rgba(0,0,0,0.6)",
  controlDim: "rgba(244,241,234,0.3)",
  dividerWisp: "rgba(244,241,234,0.05)",

  // Player / bottom-sheet surfaces
  player: "#000000",
  playerSheet: "#0C0C0E",

  // Ambient tints (for LinearGradient arrays) — warm + faint, never neon
  meshViolet: "rgba(255,122,79,0.06)",
  meshPink: "rgba(255,90,44,0.05)",
  meshCyan: "rgba(232,184,75,0.03)",
} as const;

/* ── Font families ────────────────────────────────
 * SUMI is type-led. Latin display/headings = Outfit (heavy grotesk, tight),
 * body/labels = DM Sans, all static Arabic chrome = Cairo (Latin fonts under-
 * measure Arabic glyphs and spill in tight RTL rows). A true editorial serif
 * for the display tier would be ideal but must be bundled in an APK build (OTA
 * can't add a font); the grotesk display carries the editorial weight for now. */
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

// Type scale — Sumi is bigger + tighter at the display tier (editorial impact),
// weight-led hierarchy below. Each step carries its own family so call sites can
// `...T.h2` instead of re-declaring family/size/weight/lineHeight.
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
  // Editorial section index numeral (01 / 02 …) — a Sumi signature
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
  marginSection: 34,        // more generous editorial rhythm (was 28)
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

// Radii — crisper / more "print" than Void's bubbly curves
export const R = {
  xs: 4,
  sm: 6,
  default: 8,
  md: 8,
  lg: 10,         // posters (was 12) — editorial crispness
  pillSm: 12,
  pill: 100,
  xl: 14,         // sheets / large surfaces (was 16)
  pillLg: 18,
  xxl: 18,
  circle: 9999,
} as const;

// Default depth cue — soft ambient black lift (the only shadow Sumi leans on).
export const ELEVATION_CARD = {
  shadowColor: "#000000",
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.5,
  shadowRadius: 22,
  elevation: 8,
} as const;

// Sumi has NO colored glow. These names survive (used across many screens), but
// they now resolve to a neutral ambient lift so every inherited "glow" call site
// quietly becomes a clean shadow instead of a neon halo — no per-screen edits.
export const ELEVATION_GLOW = {
  shadowColor: "#000000",
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.34,
  shadowRadius: 14,
  elevation: 6,
} as const;

export const ELEVATION_GLOW_VIOLET = {
  shadowColor: "#000000",
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.34,
  shadowRadius: 14,
  elevation: 6,
} as const;

export const ELEVATION_NAV = {
  shadowColor: "#000000",
  shadowOffset: { width: 0, height: -6 },
  shadowOpacity: 0.5,
  shadowRadius: 24,
  elevation: 12,
} as const;

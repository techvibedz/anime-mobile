// Pantoufa "Void" Design System
// Deep-space cinematic aesthetic with hot pink + violet accents

export const C = {
  // Backgrounds
  bg: "#06071A",
  bgDeep: "#030412",
  surface: "#0E1028",
  surfaceLight: "#151838",
  surfaceElevated: "#151838",
  surfaceContainer: "#0E1028",
  surfaceGlass: "rgba(14,16,40,0.65)",
  surfaceCard: "rgba(18,21,48,0.8)",

  // Accent (hot pink) — the single brand accent. There used to be `green`,
  // `greenDark`, `orange` aliases left over from a pre-rebrand palette; they all
  // pointed at this same pink and were misleading. Use `accent` everywhere.
  accent: "#FF2D55",
  accentSoft: "rgba(255,45,85,0.15)",
  accentGlow: "rgba(255,45,85,0.4)",
  accentMuted: "#CC2444",

  // Violet
  violet: "#7C5CFC",
  violetSoft: "rgba(124,92,252,0.15)",
  violetGlow: "rgba(124,92,252,0.3)",

  // Utility / semantic
  gold: "#FFAA2B",
  goldSoft: "rgba(255,170,43,0.15)",
  cyan: "#00D4FF",
  success: "#00E676",
  successSoft: "rgba(0,230,118,0.15)",
  error: "#FF5252",

  // Text — contrast ratios are against `bg` (#06071A).
  text: "#F0ECE2",            // 16.9:1
  textSoft: "rgba(240,236,226,0.85)",
  textSecondary: "#8A8BA3",  // 5.99:1
  textMuted: "#7B7D96",      // 4.95:1 — readable AA. (was #4E5069 @ 2.54:1, failed)
  textFaint: "#4E5069",      // 2.54:1 — DECORATIVE ONLY (idle icons, hairlines). Never body text.
  textOnAccent: "#FFFFFF",
  textOnSurfaceVariant: "#8A8BA3",
  white: "#FFFFFF",
  black: "#000000",

  // Borders
  border: "rgba(255,255,255,0.06)",
  borderSoft: "rgba(255,255,255,0.04)",
  borderLight: "rgba(255,255,255,0.08)",
  borderAccent: "rgba(255,45,85,0.2)",
  borderViolet: "rgba(124,92,252,0.2)",
  glowLine: "rgba(255,45,85,0.12)",

  // Glass
  glass: "rgba(255,255,255,0.04)",
  glassBorder: "rgba(255,255,255,0.08)",

  // Overlays
  overlay: "rgba(6,7,26,0.90)",
  overlayMedium: "rgba(6,7,26,0.70)",
  overlayTabBar: "rgba(6,7,26,0.75)",
  overlaySurface: "rgba(6,7,26,0.75)",
  overlayLight: "rgba(6,7,26,0.50)",
  overlayBlack50: "rgba(0,0,0,0.55)",
  overlayBlack70: "rgba(0,0,0,0.7)",
  scrim: "rgba(0,0,0,0.6)",
  controlDim: "rgba(255,255,255,0.3)",
  dividerWisp: "rgba(255,255,255,0.04)",

  // Player / bottom-sheet surfaces (true-black video, near-black sheets)
  player: "#000000",
  playerSheet: "#0B0C1E",

  // Gradients (as string values for LinearGradient colors arrays)
  meshViolet: "rgba(124,92,252,0.15)",
  meshPink: "rgba(255,45,85,0.1)",
  meshCyan: "rgba(0,212,255,0.05)",
} as const;

/* ── Font families ────────────────────────────────
 * Latin runs use Outfit (display/headings) + DMSans (body/labels).
 * Arabic UI chrome MUST use Cairo: Latin fonts under-measure Arabic glyphs,
 * so Arabic text in tight horizontal rows (pills, counts, headers) overflows
 * its leading edge. Route every STATIC Arabic label through `AR.*`. Leave
 * dynamic, possibly-Latin content (anime titles, romaji) on the Latin stack. */
export const F = {
  display: "Outfit_800ExtraBold",
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

// Type scale — each step carries its own family so call sites can `...T.h2`
// instead of re-declaring fontFamily/size/weight/lineHeight every time.
export const T = {
  display: { fontSize: 32, fontFamily: F.display, fontWeight: "800" as const, lineHeight: 36, letterSpacing: -0.6 },
  h1: { fontSize: 26, fontFamily: F.heading, fontWeight: "700" as const, lineHeight: 30, letterSpacing: -0.4 },
  h2: { fontSize: 20, fontFamily: F.heading, fontWeight: "700" as const, lineHeight: 24, letterSpacing: -0.2 },
  h3: { fontSize: 16, fontFamily: F.headingSemi, fontWeight: "600" as const, lineHeight: 21 },
  body: { fontSize: 14, fontFamily: F.body, fontWeight: "400" as const, lineHeight: 22 },
  bodySmall: { fontSize: 13, fontFamily: F.bodyMedium, fontWeight: "500" as const, lineHeight: 18 },
  caption: { fontSize: 11, fontFamily: F.bodySemi, fontWeight: "600" as const, lineHeight: 14 },
  captionSmall: { fontSize: 10, fontFamily: F.bodyMedium, fontWeight: "500" as const, lineHeight: 13 },
  badge: { fontSize: 9, fontFamily: F.display, fontWeight: "700" as const, lineHeight: 11, letterSpacing: 0.8 },
  button: { fontSize: 14, fontFamily: F.bodySemi, fontWeight: "600" as const, lineHeight: 18, letterSpacing: 0.1 },
  buttonGhost: { fontSize: 14, fontFamily: F.bodySemi, fontWeight: "600" as const, lineHeight: 18 },
  label: { fontSize: 15, fontFamily: F.bodySemi, fontWeight: "600" as const, lineHeight: 20 },
  tab: { fontSize: 11, fontFamily: F.bodySemi, fontWeight: "600" as const, lineHeight: 14 },
  rank: { fontSize: 48, fontFamily: F.black, fontWeight: "900" as const, lineHeight: 48, letterSpacing: -1.5 },
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
  marginSection: 28,
  marginSectionHeader: 14,
  marginContentTop: 24,
  push: 30,
  xxl: 28,
  xxxl: 40,
  touchTarget: 44,
  inputHeight: 48,
  navHeight: 64,
  tabBarHeight: 70,
} as const;

export const R = {
  xs: 4,
  sm: 6,
  default: 8,
  md: 8,
  lg: 12,
  pillSm: 13,
  pill: 100,
  xl: 16,
  pillLg: 20,
  xxl: 20,
  circle: 9999,
} as const;

export const ELEVATION_CARD = {
  shadowColor: "#000000",
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.4,
  shadowRadius: 32,
  elevation: 8,
} as const;

export const ELEVATION_GLOW = {
  shadowColor: "#FF2D55",
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.2,
  shadowRadius: 20,
  elevation: 6,
} as const;

export const ELEVATION_GLOW_VIOLET = {
  shadowColor: "#7C5CFC",
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.2,
  shadowRadius: 20,
  elevation: 6,
} as const;

export const ELEVATION_NAV = {
  shadowColor: "#000000",
  shadowOffset: { width: 0, height: -4 },
  shadowOpacity: 0.4,
  shadowRadius: 24,
  elevation: 12,
} as const;

// HOLO SPATIAL — visionOS Glass & Depth, ported into Tailwind so `className`
// resolves to the exact same values as lib/theme.ts. The StyleSheet token objects
// (C/F/T/S/R) remain the source of truth for `style={}` code; this file mirrors
// them for className code so both layers render identically.
//
// ponytail: values are duplicated from lib/theme.ts by hand (a TS file can't be
// required into this CommonJS config without ts-node). Keep them in sync; if the
// duplication ever bites, extract a shared lib/tokens.js and import it in both.

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Backgrounds — neutral near-black void the glass floats over
        ink: "#08090C",
        "ink-deep": "#050507",
        "ink-raised": "#14161C",
        "ink-high": "#1C1F27",
        "surface-glass": "rgba(255,255,255,0.08)",
        "surface-card": "rgba(255,255,255,0.06)",

        // Accent — PERIWINKLE (primary) + MINT (secondary)
        ember: "#8B93FF",          // periwinkle (primary accent alias)
        "ember-deep": "#6E77E6",
        "ember-soft": "rgba(139,147,255,0.14)",
        "ember-glow": "rgba(139,147,255,0.30)",
        periwinkle: "#8B93FF",
        mint: "#5EEAD4",
        "mint-soft": "rgba(94,234,212,0.14)",

        // Semantic — one meaning each
        gold: "#FFCE5C",
        "gold-soft": "rgba(255,206,92,0.16)",
        cyan: "#5EEAD4",
        success: "#4ADE80",
        "success-soft": "rgba(74,222,128,0.16)",
        error: "#FF6B6B",

        // Text — pure-white spatial ramp against the void
        bone: "#FFFFFF",
        "bone-soft": "rgba(255,255,255,0.88)",
        ash: "#B4B8C5",
        "ash-dim": "#8A8F9E",
        "ash-faint": "#4A4E5A",
        "on-accent": "#0A0B12",

        // Borders / lines — bright glass rim-lights
        line: "rgba(255,255,255,0.09)",
        "line-soft": "rgba(255,255,255,0.06)",
        "line-strong": "rgba(255,255,255,0.16)",
        "line-ember": "rgba(139,147,255,0.35)",

        // Overlays / scrims — traced to the void
        scrim: "rgba(0,0,0,0.6)",
        overlay: "rgba(8,9,12,0.92)",
        "overlay-medium": "rgba(8,9,12,0.72)",
      },
      fontFamily: {
        display: ["Outfit_900Black"],
        heading: ["Outfit_700Bold"],
        "heading-semi": ["Outfit_600SemiBold"],
        body: ["DMSans_400Regular"],
        "body-medium": ["DMSans_500Medium"],
        "body-semi": ["DMSans_600SemiBold"],
        "body-bold": ["DMSans_700Bold"],
        "ar-bold": ["Cairo_700Bold"],
        "ar-semi": ["Cairo_600SemiBold"],
        "ar-medium": ["Cairo_500Medium"],
      },
      fontSize: {
        display: ["40px", { lineHeight: "42px", letterSpacing: "-1px" }],
        h1: ["30px", { lineHeight: "33px", letterSpacing: "-0.7px" }],
        h2: ["21px", { lineHeight: "25px", letterSpacing: "-0.3px" }],
        h3: ["16px", { lineHeight: "21px" }],
        body: ["14px", { lineHeight: "23px" }],
        "body-sm": ["13px", { lineHeight: "18px" }],
        caption: ["11px", { lineHeight: "14px" }],
        "caption-sm": ["10px", { lineHeight: "13px" }],
        badge: ["9px", { lineHeight: "11px", letterSpacing: "1px" }],
        button: ["14px", { lineHeight: "18px", letterSpacing: "0.1px" }],
        label: ["15px", { lineHeight: "20px" }],
        tab: ["11px", { lineHeight: "14px" }],
        index: ["13px", { lineHeight: "14px", letterSpacing: "0.5px" }],
        rank: ["52px", { lineHeight: "52px", letterSpacing: "-2px" }],
      },
      spacing: {
        unit: "4px",
        xs: "6px",
        sm: "8px",
        md: "12px",
        lg: "16px",
        xl: "20px",
        content: "20px",
        action: "18px",
        section: "34px",
        "section-header": "16px",
        push: "30px",
        xxl: "32px",
        xxxl: "44px",
        touch: "44px",
        input: "50px",
        nav: "64px",
        "tab-bar": "72px",
      },
      borderRadius: {
        // Soft visionOS rounding
        xs: "8px",
        sm: "12px",
        DEFAULT: "14px",
        md: "14px",
        lg: "16px",
        "pill-sm": "14px",
        xl: "22px",
        "pill-lg": "20px",
        xxl: "26px",
        pill: "100px",
        circle: "9999px",
      },
    },
  },
  plugins: [],
};

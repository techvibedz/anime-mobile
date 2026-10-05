// Manga's own ink-and-paper palette. Deliberately independent of the anime UI.
export const M = {
  paper: "#F5F1E8",
  sheet: "#FFFCF6",
  wash: "#EBE5D9",
  ink: "#22231F",
  muted: "#68675E",
  line: "#D9D2C5",
  accent: "#B83E25",
  accentWash: "#F4E1D7",
  white: "#FFFCF6",
  read: "#38634F",
  readWash: "#DFE9DF",
  rating: "#8B5A14",
  scrim: "rgba(22,23,20,0.58)",
  night: "#181916",
  nightPanel: "#252621",
  nightMuted: "#C4C0B5",
  nightLine: "#42443B",
  nightAccent: "#F09572",
} as const;

export const MT = {
  display: { fontFamily: "Cairo_700Bold", fontSize: 30, lineHeight: 44 },
  title: { fontFamily: "Cairo_700Bold", fontSize: 24, lineHeight: 36 },
  heading: { fontFamily: "Cairo_700Bold", fontSize: 18, lineHeight: 28 },
  body: { fontFamily: "Cairo_500Medium", fontSize: 14, lineHeight: 25 },
  label: { fontFamily: "Cairo_700Bold", fontSize: 13, lineHeight: 23 },
  caption: { fontFamily: "Cairo_600SemiBold", fontSize: 12, lineHeight: 21 },
  number: { fontFamily: "DMSans_700Bold", fontSize: 14, lineHeight: 20 },
} as const;

export const MANGA_FILL = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 } as const;

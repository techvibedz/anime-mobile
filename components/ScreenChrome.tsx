// Shared chrome for the drawer's child screens (Profile, Settings, Notifications).
// Keeps every secondary screen visually consistent: the same top-anchored glow
// and the same header anatomy (leading back button · centered title · optional
// trailing slot).
//
// Layout rules (RN 0.81 / Expo 54):
//  • Rows are plain "row" — never "row-reverse" (Yoga collapses mixed fixed+flex
//    rows into a vertical pile under row-reverse on RTL-locale devices).
//  • No `gap` on flex rows — spacing is done with margins, which is stable under
//    both LTR and RTL. See the project's gap+row-reverse note.
//  • Arabic order is achieved by child ordering + right-aligned text.

import { type ReactNode } from "react";
import { View, Text, Pressable, StyleSheet, I18nManager } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { C, R, S } from "../lib/theme";

/* ── Aurora backdrop ─────────────────────────────
 * A single soft glow band pinned to the top of the screen (NOT a full-screen
 * wash). Bounded by a height-constrained container so the absolute-filled
 * gradients fill the band, not the whole page. */
export function Aurora() {
  return (
    <View style={au.band} pointerEvents="none">
      <LinearGradient
        colors={[C.violetSoft, "transparent"]}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={[C.meshPink, "transparent"]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0.4, y: 0.9 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

const au = StyleSheet.create({
  band: { position: "absolute", top: 0, left: 0, right: 0, height: 300 },
});

/* ── Circular glass icon button ───────────────── */
export function GlassIconButton({
  icon,
  onPress,
  tint,
  size = 22,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  tint?: string;
  size?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [hs.iconBtn, pressed && hs.iconBtnPressed]}
    >
      <Ionicons name={icon} size={size} color={tint ?? C.text} />
    </Pressable>
  );
}

/* ── Screen header ────────────────────────────── */
export function ScreenHeader({
  title,
  right,
  onBack,
}: {
  title: string;
  right?: ReactNode;
  onBack?: () => void;
}) {
  const backIcon = I18nManager.isRTL ? "chevron-forward" : "chevron-back";
  return (
    <View style={hs.header}>
      <GlassIconButton icon={backIcon} onPress={onBack ?? (() => router.back())} />
      <Text style={hs.title} numberOfLines={1}>
        {title}
      </Text>
      <View style={hs.rightSlot}>{right ?? null}</View>
    </View>
  );
}

/* ── Section label with accent tick ───────────── */
export function SectionLabel({ children }: { children: ReactNode }) {
  // Arabic reads right-to-left: the label text sits left of the accent tick and
  // the whole group hugs the right edge.
  return (
    <View style={hs.sectionLabel}>
      <Text style={hs.sectionText}>{children}</Text>
      <View style={hs.sectionTick} />
    </View>
  );
}

const ICON_BTN = 42;

const hs = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: S.paddingContent,
    paddingTop: 4,
    paddingBottom: 12,
  },
  iconBtn: {
    width: ICON_BTN,
    height: ICON_BTN,
    borderRadius: R.circle,
    backgroundColor: C.glass,
    borderWidth: 1,
    borderColor: C.glassBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBtnPressed: { backgroundColor: C.surfaceLight, transform: [{ scale: 0.94 }] },

  // flex:1 centered title between the two 42px rails keeps it optically centered.
  title: { flex: 1, textAlign: "center", color: C.text, fontSize: 18, fontWeight: "800", fontFamily: "Outfit_800ExtraBold" },
  rightSlot: { minWidth: ICON_BTN, height: ICON_BTN, alignItems: "flex-end", justifyContent: "center" },

  sectionLabel: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", marginBottom: 12 },
  sectionText: {
    color: C.textSecondary,
    fontSize: 12.5,
    fontWeight: "700",
    fontFamily: "Outfit_700Bold",
    letterSpacing: 0.3,
    marginRight: 8,
  },
  sectionTick: { width: 3, height: 14, borderRadius: 2, backgroundColor: C.accent },
});

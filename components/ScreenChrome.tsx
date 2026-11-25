// Shared tonal backdrop and 48dp navigation controls for secondary screens.
//
// Arabic labels are right-aligned, with flexible text between fixed controls.

import { type ReactNode } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { C, R, S, TAr, ABSOLUTE_FILL } from "../lib/theme";
import { useSidebarActions } from "./Sidebar";
import { t } from "../lib/i18n";
import { StateView } from "./StateView";
import { LiquidGlass } from "./LiquidGlass";

/* Former tonal top wash. Liquid Glass screens sit on the plain dark canvas, and
 * a full-screen LinearGradient here broke under the glass library's per-frame
 * software capture (the whole screen washed grey) — so it renders nothing now.
 * Kept as a component so existing screens don't change. */
export function Aurora() {
  return null;
}

/* ── Circular glass icon button ───────────────── */
export function GlassIconButton({
  icon,
  onPress,
  tint,
  size = 22,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  tint?: string;
  size?: number;
  label?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label ?? (icon === "menu" ? t.menu : t.back)}
      style={({ pressed }) => [pressed && hs.iconBtnPressed]}
    >
      <LiquidGlass preset="compactControl" radius={ICON_BTN / 2} interactive edgeReflectionStrength={0.3} style={hs.iconBtn}>
        <Ionicons name={icon} size={size} color={tint ?? C.text} />
      </LiquidGlass>
    </Pressable>
  );
}

/* ── Screen header ────────────────────────────── */
export function ScreenHeader({
  title,
  right,
  onBack,
  showMenu = true,
}: {
  title: string;
  right?: ReactNode;
  onBack?: () => void;
  /** Trailing hamburger that opens the global drawer. On by default so the
   *  sidebar is reachable from every screen — not just the home tab. */
  showMenu?: boolean;
}) {
  // Arabic convention: back sits on the reading (right) edge and points right.
  const backIcon = "chevron-forward";
  const { openSidebar } = useSidebarActions();
  return (
    <View style={hs.header}>
      <GlassIconButton icon={backIcon} onPress={onBack ?? (() => router.back())} />
      <Text accessibilityRole="header" style={hs.title} numberOfLines={2}>
        {title}
      </Text>
      <View style={hs.trailSlot}>
        {showMenu ? <GlassIconButton icon="menu" onPress={openSidebar} /> : null}
        {right ? <View style={showMenu ? hs.menuSpacer : undefined}>{right}</View> : null}
      </View>
    </View>
  );
}

/* ── Offline / no-content notice ──────────────────
 * Shared full-area state for the network-dependent browse screens. Delegates to
 * the unified <StateView> so every empty/error/offline surface shares one
 * anatomy. `offline=false` keeps the same layout but uses the softer
 * "couldn't load" copy for an online-but-failed fetch. */
export function OfflineNotice({
  onRetry,
  offline = true,
}: {
  onRetry?: () => void;
  offline?: boolean;
}) {
  return (
    <StateView
      icon={offline ? "cloud-offline-outline" : "alert-circle-outline"}
      variant={offline ? "offline" : "error"}
      title={offline ? t.offlineTitle : t.homeEmptyTitle}
      message={offline ? t.offlineSub : t.homeEmptySub}
      primary={{ label: t.watchDownloads, onPress: () => router.push("/downloads"), icon: "download" }}
      secondary={onRetry ? { label: t.retry, onPress: onRetry, icon: "refresh" } : undefined}
    />
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

const ICON_BTN = 48;

const hs = StyleSheet.create({
  // row-reverse: back on the right, title beside it, actions on the left.
  header: {
    flexDirection: "row-reverse",
    alignItems: "center",
    paddingHorizontal: S.paddingContent,
    paddingTop: 12,
    paddingBottom: 16,
  },
  // Live Liquid Glass circle. Cheap here: the header behind it is still, and
  // the glass skips repainting when its backdrop hasn't changed.
  iconBtn: {
    width: ICON_BTN,
    height: ICON_BTN,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBtnPressed: { transform: [{ scale: 0.94 }] },

  // A right-aligned title stays anchored to the Arabic reading edge.
  title: { ...TAr.h1, fontSize: 22, lineHeight: 34, flex: 1, minWidth: 0, marginHorizontal: 12, textAlign: "right", color: C.bone },
  trailSlot: { minWidth: ICON_BTN, minHeight: ICON_BTN, flexShrink: 0, flexDirection: "row", alignItems: "center", justifyContent: "flex-start" },
  menuSpacer: { marginLeft: 8 },

  sectionLabel: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", marginBottom: 12 },
  sectionTick: { width: 4, height: 18, borderRadius: 2, backgroundColor: C.accent, marginLeft: 10 },
  sectionText: {
    color: C.text,
    ...TAr.h3,
  },
});

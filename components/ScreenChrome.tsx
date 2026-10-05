// Shared tonal backdrop and 48dp navigation controls for secondary screens.
//
// Arabic labels are right-aligned, with flexible text between fixed controls.

import { type ReactNode } from "react";
import { View, Text, Pressable, StyleSheet, I18nManager } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { C, R, S, TAr, ABSOLUTE_FILL } from "../lib/theme";
import { useSidebarActions } from "./Sidebar";
import { t } from "../lib/i18n";
import { StateView } from "./StateView";

/* Quiet tonal backdrop; never intercepts touches. */
export function Aurora() {
  return (
    <View style={ABSOLUTE_FILL} pointerEvents="none">
      <LinearGradient
        colors={[C.surfaceContainer, C.bg]}
        style={{ position: "absolute", top: 0, left: 0, right: 0, height: 240 }}
      />
    </View>
  );
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
  showMenu = true,
}: {
  title: string;
  right?: ReactNode;
  onBack?: () => void;
  /** Trailing hamburger that opens the global drawer. On by default so the
   *  sidebar is reachable from every screen — not just the home tab. */
  showMenu?: boolean;
}) {
  const backIcon = I18nManager.isRTL ? "chevron-forward" : "chevron-back";
  const { openSidebar } = useSidebarActions();
  return (
    <View style={hs.header}>
      <GlassIconButton icon={backIcon} onPress={onBack ?? (() => router.back())} />
      <Text accessibilityRole="header" style={hs.title} numberOfLines={2}>
        {title}
      </Text>
      <View style={hs.rightSlot}>
        {right ?? null}
        {showMenu ? (
          <View style={right ? hs.menuSpacer : undefined}>
            <GlassIconButton icon="menu" onPress={openSidebar} />
          </View>
        ) : null}
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
    </View>
  );
}

const ICON_BTN = 48;

const hs = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: S.paddingContent,
    paddingTop: 12,
    paddingBottom: 16,
  },
  iconBtn: {
    width: ICON_BTN,
    height: ICON_BTN,
    borderRadius: R.md,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.borderSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBtnPressed: { backgroundColor: C.surfaceLight, transform: [{ scale: 0.94 }] },

  // A right-aligned title stays anchored to the Arabic reading edge.
  title: { ...TAr.h2, flex: 1, minWidth: 0, marginHorizontal: 12, textAlign: "right", color: C.bone },
  rightSlot: { minWidth: ICON_BTN, minHeight: ICON_BTN, flexShrink: 0, flexDirection: "row", alignItems: "center", justifyContent: "flex-end" },
  menuSpacer: { marginLeft: 8 },

  sectionLabel: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", marginBottom: 12 },
  sectionText: {
    color: C.text,
    ...TAr.h3,
  },
});

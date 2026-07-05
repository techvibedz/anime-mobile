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
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { C, R, S, AR, TAr, ELEVATION_NAV } from "../lib/theme";
import { useSidebar } from "./Sidebar";
import { t } from "../lib/i18n";
import { StateView } from "./StateView";

/* ── Aurora backdrop ─────────────────────────────
 * HOLO signature backdrop for secondary screens: a neutral tonal lift plus a
 * soft two-hue (periwinkle + mint) iridescent wash at the top, evoking the
 * visionOS spatial glow. Low-opacity by design — a gentle bloom, never neon.
 * pointerEvents:none so it never intercepts touches. */
export function Aurora() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: C.inkRaised, opacity: 0.4 }]} />
      <LinearGradient
        colors={[C.meshViolet, "transparent"]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.85, y: 0.5 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={[C.meshPink, "transparent"]}
        start={{ x: 0.95, y: 0 }}
        end={{ x: 0.3, y: 0.55 }}
        style={StyleSheet.absoluteFill}
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
  const { openSidebar } = useSidebar();
  return (
    <View style={hs.header}>
      <GlassIconButton icon={backIcon} onPress={onBack ?? (() => router.back())} />
      <Text style={hs.title} numberOfLines={1}>
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
      <View style={hs.sectionTick} />
    </View>
  );
}

const ICON_BTN = 44;

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

  // flex:1 centered title between the two 44px rails keeps it optically centered.
  title: { ...TAr.h2, flex: 1, textAlign: "center", color: C.bone, letterSpacing: -0.3 },
  rightSlot: { minWidth: ICON_BTN, height: ICON_BTN, flexDirection: "row", alignItems: "center", justifyContent: "flex-end" },
  menuSpacer: { marginLeft: 8 },

  sectionLabel: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", marginBottom: 12 },
  sectionText: {
    color: C.textSecondary,
    ...TAr.bodySmall,
    letterSpacing: 0.3,
    marginRight: 8,
  },
  sectionTick: { width: 3, height: 14, borderRadius: 2, backgroundColor: C.ember },
});

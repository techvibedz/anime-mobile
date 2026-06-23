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
import { C, R, S, AR } from "../lib/theme";
import { useSidebar } from "./Sidebar";
import { t } from "../lib/i18n";

/* ── Aurora backdrop ─────────────────────────────
 * A FULL-SCREEN wash whose glow is concentrated at the top and fades smoothly to
 * the base background over the whole page (via gradient `locations`). It used to
 * be a 300px-tall band, which left a hard "two-tone cut" where the band ended
 * and the flat base color began — and because it sat behind a transparent
 * scroll view, that cut stayed locked on screen while content scrolled past it.
 * Spanning the full height removes the boundary entirely. */
export function Aurora() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient
        colors={[C.violetSoft, "transparent"]}
        locations={[0, 0.55]}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={[C.meshPink, "transparent"]}
        locations={[0, 0.45]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0.4, y: 1 }}
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
 * Shared full-area state for the network-dependent browse screens. Always offers
 * a route to the user's offline downloads (which play with no connection), plus
 * an optional retry. `offline=false` keeps the same layout but uses the softer
 * "couldn't load" copy for an online-but-failed fetch. */
export function OfflineNotice({
  onRetry,
  offline = true,
}: {
  onRetry?: () => void;
  offline?: boolean;
}) {
  return (
    <View style={hs.offlineWrap}>
      <View style={hs.offlineIcon}>
        <Ionicons name={offline ? "cloud-offline-outline" : "alert-circle-outline"} size={38} color={C.accent} />
      </View>
      <Text style={hs.offlineTitle}>{offline ? t.offlineTitle : t.homeEmptyTitle}</Text>
      <Text style={hs.offlineSub}>{offline ? t.offlineSub : t.homeEmptySub}</Text>
      <Pressable
        style={({ pressed }) => [hs.offlinePrimary, pressed && { opacity: 0.9 }]}
        onPress={() => router.push("/downloads")}
      >
        <Ionicons name="download" size={16} color={C.textOnAccent} />
        <Text style={hs.offlinePrimaryText}>{t.watchDownloads}</Text>
      </Pressable>
      {onRetry ? (
        <Pressable
          style={({ pressed }) => [hs.offlineSecondary, pressed && { opacity: 0.85 }]}
          onPress={onRetry}
        >
          <Ionicons name="refresh" size={15} color={C.text} />
          <Text style={hs.offlineSecondaryText}>{t.retry}</Text>
        </Pressable>
      ) : null}
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
  title: { flex: 1, textAlign: "center", color: C.bone, fontSize: 19, letterSpacing: -0.3, fontFamily: AR.bold },
  rightSlot: { minWidth: ICON_BTN, height: ICON_BTN, flexDirection: "row", alignItems: "center", justifyContent: "flex-end" },
  menuSpacer: { marginLeft: 8 },

  // paddingTop (not flex:1) so it renders correctly both standalone AND inside a
  // FlatList's ListEmptyComponent, where a flex child would collapse to 0 height.
  offlineWrap: { alignItems: "center", justifyContent: "center", paddingHorizontal: 32, paddingTop: 80, paddingBottom: 40, gap: 10 },
  offlineIcon: {
    width: 84, height: 84, borderRadius: 42, backgroundColor: C.glass,
    borderWidth: 1, borderColor: C.glassBorder, alignItems: "center", justifyContent: "center", marginBottom: 6,
  },
  offlineTitle: { color: C.text, fontSize: 18, fontFamily: AR.bold, textAlign: "center" },
  offlineSub: { color: C.textSecondary, fontSize: 13, lineHeight: 21, textAlign: "center", maxWidth: 300, fontFamily: "Cairo_500Medium" },
  offlinePrimary: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: C.accent, borderRadius: R.pill, paddingHorizontal: 22, paddingVertical: 13, marginTop: 10,
  },
  offlinePrimaryText: { color: C.textOnAccent, fontSize: 14, fontFamily: "Cairo_700Bold" },
  offlineSecondary: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    borderRadius: R.pill, paddingHorizontal: 20, paddingVertical: 11,
  },
  offlineSecondaryText: { color: C.text, fontSize: 13, fontFamily: "Cairo_600SemiBold" },

  sectionLabel: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", marginBottom: 12 },
  sectionText: {
    color: C.textSecondary,
    fontSize: 13,
    fontFamily: AR.bold,
    letterSpacing: 0.3,
    marginRight: 8,
  },
  sectionTick: { width: 3, height: 14, borderRadius: 2, backgroundColor: C.accent },
});

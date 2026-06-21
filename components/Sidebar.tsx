import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  Easing,
  Dimensions,
  Share,
  ScrollView,
} from "react-native";
import { Image } from "expo-image";
import { router, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useAuth } from "../lib/auth";
import { isAdmin } from "../lib/presence";
import { getHistory, isCompleted } from "../lib/history";
import { getFavorites } from "../lib/favorites";
import { C, R, ELEVATION_CARD, ELEVATION_GLOW_VIOLET } from "../lib/theme";
import { t } from "../lib/i18n";
import appVersion from "../version.json";

const { width: SW } = Dimensions.get("window");
const PANEL_W = Math.min(360, SW * 0.88);

// Rows are always plain "row" — never "row-reverse". RN 0.81's Yoga engine
// collapses mixed fixed+flex rows into a broken vertical stack under
// row-reverse. The app doesn't force RTL, so "row" + right-aligned Arabic text
// is the stable choice (RN still mirrors plain rows on RTL-locale devices).
const CHEVRON = "chevron-back" as const;

/* ── Context ─────────────────────────────────── */

interface SidebarCtx {
  open: boolean;
  openSidebar: () => void;
  closeSidebar: () => void;
}
const Ctx = createContext<SidebarCtx | undefined>(undefined);

export function useSidebar(): SidebarCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSidebar must be used within SidebarProvider");
  return c;
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openSidebar = useCallback(() => setOpen(true), []);
  const closeSidebar = useCallback(() => setOpen(false), []);
  return (
    <Ctx.Provider value={{ open, openSidebar, closeSidebar }}>
      {children}
      <Sidebar />
    </Ctx.Provider>
  );
}

/* ── Types ───────────────────────────────────── */

interface QuickStats {
  episodesWatched: number;
  animeCount: number;
}

interface NavRow {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  /** pathname fragment used to highlight the active route */
  match?: string;
  accent?: string;
}

/* ── Sidebar UI ──────────────────────────────── */

function Sidebar() {
  const { open, closeSidebar } = useSidebar();
  const { user, signOut, isConfigured } = useAuth();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();

  const [mounted, setMounted] = useState(false);
  const [stats, setStats] = useState<QuickStats>({ episodesWatched: 0, animeCount: 0 });
  // Single driver (0 = closed, 1 = open). Panel slide, backdrop fade and the
  // content settle are all interpolated from it — one native value, no jank.
  const anim = useRef(new Animated.Value(0)).current;

  // Auto-close on route change.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (pathname !== lastPath.current) {
      lastPath.current = pathname;
      if (open) closeSidebar();
    }
  }, [pathname]);

  useEffect(() => {
    if (open) {
      setMounted(true);
      Promise.all([getHistory(), getFavorites()])
        .then(([history, favs]) => {
          setStats({
            episodesWatched: history.filter(isCompleted).length,
            animeCount: favs.length,
          });
        })
        .catch(() => {});
      Animated.timing(anim, {
        toValue: 1,
        duration: 340,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else if (mounted) {
      Animated.timing(anim, {
        toValue: 0,
        duration: 220,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [open]);

  if (!mounted) return null;

  // Panel travels in from off-screen-right — the menu trigger lives top-right
  // and the app reads RTL, so the drawer emerges from the reading edge.
  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [PANEL_W, 0] });
  const backdropOpacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const contentOpacity = anim.interpolate({ inputRange: [0, 0.45, 1], outputRange: [0, 0.15, 1] });
  // Content drifts in a touch behind the panel for a layered, modern feel.
  const contentDrift = anim.interpolate({ inputRange: [0, 1], outputRange: [22, 0] });

  const displayName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    (user?.email ? user.email.split("@")[0] : t.guest);
  const avatarUrl = user?.user_metadata?.avatar_url || user?.user_metadata?.picture || null;
  const initial = (displayName || "?").trim().charAt(0).toUpperCase();

  const go = (path: string) => {
    closeSidebar();
    setTimeout(() => router.push(path as any), 80);
  };

  const onShare = () => {
    closeSidebar();
    setTimeout(() => Share.share({ message: t.shareAppMessage }).catch(() => {}), 80);
  };

  const NAV: NavRow[] = [
    { icon: "person-outline", label: t.profile, onPress: () => go("/profile"), match: "/profile" },
    { icon: "heart-outline", label: t.myListTitle, onPress: () => go("/(tabs)/mylist"), match: "/mylist" },
    { icon: "calendar-outline", label: t.scheduleTitle, onPress: () => go("/schedule"), match: "/schedule" },
    { icon: "notifications-outline", label: t.notifications, onPress: () => go("/notifications"), match: "/notifications" },
    { icon: "settings-outline", label: t.settingsTitle, onPress: () => go("/settings"), match: "/settings" },
    { icon: "bug-outline", label: t.reportIssue, onPress: () => go("/report"), match: "/report" },
    { icon: "share-social-outline", label: t.shareApp, onPress: onShare },
  ];

  // Admin-only: live view of who's using the app right now. Visible only to the
  // owner account (see ADMIN_EMAILS in lib/presence.ts).
  if (isAdmin(user?.email)) {
    NAV.splice(NAV.length - 1, 0, {
      icon: "pulse-outline",
      label: t.liveUsersTitle,
      onPress: () => go("/live"),
      match: "/live",
      accent: C.success,
    });
  }

  return (
    <View style={st.overlay} pointerEvents="box-none">
      {/* Backdrop */}
      <Animated.View
        style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]}
        pointerEvents={open ? "auto" : "none"}
      >
        <Pressable style={st.backdrop} onPress={closeSidebar} />
      </Animated.View>

      {/* Panel (slides in from the right / reading edge) */}
      <Animated.View
        style={[st.panel, { width: PANEL_W, paddingTop: insets.top + 16, transform: [{ translateX }] }]}
      >
        {/* Layered ambient glow — spans the whole panel and fades smoothly to the
            base (via `locations`) so there's no hard two-tone cut where a fixed
            band would have ended. */}
        <View style={st.glow} pointerEvents="none">
          <LinearGradient
            colors={[C.violetSoft, "transparent"]}
            locations={[0, 0.5]}
            start={{ x: 0.05, y: 0 }}
            end={{ x: 0.7, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            colors={[C.meshPink, "transparent"]}
            locations={[0, 0.45]}
            start={{ x: 1, y: 0 }}
            end={{ x: 0.2, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            colors={[C.meshCyan, "transparent"]}
            locations={[0, 0.55]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        </View>
        {/* Accent hairline on the panel's leading edge */}
        <LinearGradient
          colors={[C.accent, C.violet, "transparent"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={st.edgeLine}
          pointerEvents="none"
        />

        <Animated.View style={{ flex: 1, opacity: contentOpacity, transform: [{ translateX: contentDrift }] }}>
          {/* Brand lockup + close */}
          <View style={st.header}>
            <Pressable onPress={closeSidebar} hitSlop={8} style={({ pressed }) => [st.closeBtn, pressed && st.closeBtnPressed]}>
              <Ionicons name="close" size={20} color={C.text} />
            </Pressable>
            <View style={st.brandLockup}>
              <View style={st.brandTextWrap}>
                <Text style={st.brandName}>{t.settingsAppName}</Text>
                <Text style={st.brandTag}>{t.settingsTagline}</Text>
              </View>
              <View style={st.logoWrap}>
                <LinearGradient
                  colors={[C.accent, C.violet]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={st.logoMark}
                >
                  <Text style={st.logoGlyph}>P</Text>
                </LinearGradient>
              </View>
            </View>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: insets.bottom + 28 }}
          >
            {/* Hero profile card */}
            <Pressable
              style={({ pressed }) => [st.hero, pressed && st.heroPressed]}
              onPress={() => go("/profile")}
            >
              <LinearGradient
                colors={[C.violetSoft, "transparent"]}
                start={{ x: 1, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              <View style={st.heroRow}>
                <View style={st.heroChevron}>
                  <Ionicons name={CHEVRON} size={18} color={C.textMuted} />
                </View>
                <View style={st.heroText}>
                  <Text style={st.name} numberOfLines={1}>{displayName}</Text>
                  <Text style={st.email} numberOfLines={1}>{user?.email || t.guest}</Text>
                  <View style={st.heroBadge}>
                    <Text style={st.heroBadgeText}>{t.profileTitle}</Text>
                  </View>
                </View>
                <View style={st.avatarOuter}>
                  <LinearGradient colors={[C.accent, C.violet]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.avatarRing}>
                    <View style={st.avatarInner}>
                      {avatarUrl ? (
                        <Image source={{ uri: avatarUrl }} style={st.avatar} contentFit="cover" transition={150} />
                      ) : (
                        <View style={[st.avatar, st.avatarFallback]}>
                          <Text style={st.avatarInitial}>{initial}</Text>
                        </View>
                      )}
                    </View>
                  </LinearGradient>
                </View>
              </View>
            </Pressable>

            {/* Quick stats */}
            <View style={st.statsRow}>
              <StatTile icon="albums-outline" value={stats.animeCount} label={t.statsAnimeInList} tint={C.violet} />
              <View style={st.statGap} />
              <StatTile icon="play-circle-outline" value={stats.episodesWatched} label={t.statsEpisodesWatched} tint={C.accent} />
            </View>

            {/* Nav */}
            <Text style={st.sectionCap}>{t.menu}</Text>
            <View style={st.navList}>
              {NAV.map((item) => {
                const active = !!item.match && pathname?.startsWith(item.match);
                const tint = item.accent ?? C.accent;
                return (
                  <Pressable
                    key={item.label}
                    onPress={item.onPress}
                    style={({ pressed }) => [
                      st.navItem,
                      active && { backgroundColor: tint + "1A", borderColor: tint + "33" },
                      pressed && st.navItemPressed,
                    ]}
                  >
                    {active ? <View style={[st.activeBar, { backgroundColor: tint }]} /> : null}
                    {/* Icon is absolutely pinned to the right (reading edge) and the
                        label is a plain full-width right-aligned text. There is NO
                        flexDirection:"row" here, so an Arabic-locale device can't
                        reverse the row and collapse it into a broken vertical stack
                        (RN ignores the `direction` style; left/right stay physical). */}
                    <View style={[st.navIcon, active && { backgroundColor: tint + "1F", borderColor: tint + "33" }]}>
                      <Ionicons name={item.icon} size={21} color={active ? tint : C.textSecondary} />
                    </View>
                    <Text style={[st.navLabel, active && st.navLabelActive, active && { color: tint }]} numberOfLines={1}>{item.label}</Text>
                    {/* Disclosure chevron only on the focused row, pinned far-left. */}
                    {active ? <Ionicons style={st.navChevron} name={CHEVRON} size={15} color={tint} /> : null}
                  </Pressable>
                );
              })}
            </View>

            {/* Sign out */}
            {isConfigured && user ? (
              <>
                <View style={st.divider} />
                <Pressable
                  onPress={() => { closeSidebar(); setTimeout(() => signOut(), 80); }}
                  style={({ pressed }) => [st.navItem, st.signOutItem, pressed && st.navItemPressed]}
                >
                  <View style={[st.navIcon, st.navIconDanger]}>
                    <Ionicons name="log-out-outline" size={21} color={C.accent} />
                  </View>
                  <Text style={[st.navLabel, st.signOutLabel]}>{t.signOut}</Text>
                </Pressable>
              </>
            ) : null}

            <View style={st.footer}>
              <Text style={st.footerName}>{t.settingsAppName}</Text>
              <Text style={st.footerVersion}>v{appVersion.version}</Text>
            </View>
          </ScrollView>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

/* ── Stat tile ───────────────────────────────── */

function StatTile({
  icon, value, label, tint,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: number;
  label: string;
  tint: string;
}) {
  return (
    <View style={[st.statCard, { borderColor: tint + "33" }]}>
      <LinearGradient
        colors={[tint + "22", "transparent"]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={st.statHead}>
        <View style={[st.statIcon, { backgroundColor: tint + "22" }]}>
          <Ionicons name={icon} size={15} color={tint} />
        </View>
        <Text style={[st.statNum, { color: tint }]}>{value}</Text>
      </View>
      <Text style={st.statLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

/* Every row keeps a single visual order (chevron → label → icon, reading L→R)
 * so the right-aligned Arabic labels stay anchored to the icon rail. */
const st = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 1000 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.66)" },

  panel: {
    position: "absolute", top: 0, bottom: 0, right: 0,
    backgroundColor: C.bgDeep,
    borderTopLeftRadius: 34, borderBottomLeftRadius: 34,
    borderLeftWidth: 1, borderColor: C.glassBorder,
    paddingHorizontal: 16,
    overflow: "hidden",
    ...ELEVATION_CARD,
    shadowOffset: { width: -12, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 32,
  },
  glow: { ...StyleSheet.absoluteFillObject },
  edgeLine: { position: "absolute", top: 36, bottom: 36, left: 0, width: 2.5, borderRadius: 2 },

  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginBottom: 20,
  },
  brandLockup: { flexDirection: "row", alignItems: "center" },
  brandTextWrap: { alignItems: "flex-end", justifyContent: "center", marginRight: 11 },
  // includeFontPadding:false strips the extra top/bottom slab Android adds for
  // Arabic (Cairo) glyphs — without it the title rides high and no longer sits
  // inline with the logo mark. lineHeight keeps the two lines tight & centered.
  brandName: {
    color: C.text, fontSize: 18, fontWeight: "800", fontFamily: "Cairo_700Bold",
    lineHeight: 24, includeFontPadding: false, textAlignVertical: "center",
  },
  brandTag: {
    color: C.textMuted, fontSize: 11, marginTop: 1, fontFamily: "Cairo_500Medium",
    lineHeight: 15, includeFontPadding: false, textAlignVertical: "center",
  },
  logoWrap: {
    borderRadius: 15, padding: 2,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
  },
  logoMark: {
    width: 44, height: 44, borderRadius: 13,
    alignItems: "center", justifyContent: "center",
  },
  logoGlyph: { color: "#fff", fontSize: 23, fontWeight: "900", fontFamily: "Outfit_900Black" },
  closeBtn: {
    width: 40, height: 40, borderRadius: R.circle,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    alignItems: "center", justifyContent: "center",
  },
  closeBtnPressed: { backgroundColor: C.surfaceLight, transform: [{ scale: 0.94 }] },

  // Hero profile card
  hero: {
    borderRadius: R.xxl, padding: 16,
    backgroundColor: C.surfaceCard, borderWidth: 1, borderColor: C.borderViolet,
    marginBottom: 16, overflow: "hidden",
    ...ELEVATION_CARD,
  },
  heroPressed: { transform: [{ scale: 0.99 }], borderColor: C.borderAccent },
  heroRow: { flexDirection: "row", alignItems: "center" },
  heroChevron: { alignSelf: "center" },
  heroText: { flex: 1, marginHorizontal: 12, alignItems: "flex-end" },
  avatarOuter: {
    borderRadius: R.circle, padding: 2,
    backgroundColor: C.bgDeep,
    ...ELEVATION_GLOW_VIOLET,
  },
  avatarRing: {
    width: 62, height: 62, borderRadius: R.circle,
    alignItems: "center", justifyContent: "center", padding: 2.5,
  },
  avatarInner: {
    width: "100%", height: "100%", borderRadius: R.circle,
    backgroundColor: C.bgDeep, padding: 2,
  },
  avatar: { width: "100%", height: "100%", borderRadius: R.circle },
  avatarFallback: { backgroundColor: C.surface, alignItems: "center", justifyContent: "center" },
  avatarInitial: { color: C.text, fontSize: 24, fontWeight: "800", fontFamily: "Outfit_800ExtraBold" },
  name: { color: C.text, fontSize: 17, fontWeight: "700", fontFamily: "Cairo_700Bold", textAlign: "right" },
  email: { color: C.textSecondary, fontSize: 12, marginTop: 3, fontFamily: "Cairo_500Medium", textAlign: "right" },
  heroBadge: {
    marginTop: 9, paddingHorizontal: 10, paddingVertical: 4, borderRadius: R.pill,
    backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.borderAccent,
  },
  heroBadgeText: { color: C.accent, fontSize: 11, fontWeight: "700", fontFamily: "Cairo_700Bold" },

  statsRow: { flexDirection: "row", marginBottom: 22 },
  statGap: { width: 12 },
  statCard: {
    flex: 1, borderRadius: R.xl, padding: 14, overflow: "hidden",
    backgroundColor: C.glass, borderWidth: 1,
  },
  statHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  statIcon: { width: 30, height: 30, borderRadius: R.circle, alignItems: "center", justifyContent: "center" },
  statNum: { fontSize: 28, fontWeight: "800", fontFamily: "Outfit_800ExtraBold" },
  statLabel: { color: C.textSecondary, fontSize: 11, marginTop: 8, fontFamily: "Cairo_500Medium", textAlign: "right" },

  // Quiet uppercase-style caption that introduces the nav list.
  sectionCap: {
    color: C.textMuted, fontSize: 11, fontFamily: "Cairo_700Bold",
    letterSpacing: 0.4, textAlign: "right",
    marginTop: 4, marginBottom: 10, marginRight: 4,
  },
  navList: { gap: 16 },
  // No flexDirection here — the row is built from a centered full-width label
  // plus an absolutely-pinned icon, so it can't be reversed/collapsed on an
  // RTL-locale device. minHeight reserves room for the 44px icon.
  navItem: {
    justifyContent: "center", minHeight: 64,
    paddingHorizontal: 12, borderRadius: R.lg,
    borderWidth: 1, borderColor: "transparent",
  },
  navItemPressed: { backgroundColor: C.glass },
  // Accent bar pinned to the right edge of the active row (Arabic reading side).
  activeBar: { position: "absolute", right: 0, top: 9, bottom: 9, width: 3, borderRadius: 2, backgroundColor: C.accent },
  navIcon: {
    position: "absolute", right: 12, top: "50%", marginTop: -22,
    width: 44, height: 44, borderRadius: R.md,
    backgroundColor: C.surfaceLight, borderWidth: 1, borderColor: C.border,
    alignItems: "center", justifyContent: "center",
  },
  navIconDanger: { backgroundColor: C.accentSoft, borderColor: C.borderAccent },
  navChevron: { position: "absolute", left: 12, top: "50%", marginTop: -8 },
  // Full-width right-aligned text; paddingRight clears the icon, paddingLeft the chevron.
  navLabel: {
    color: C.text, fontSize: 16.5, fontWeight: "600", fontFamily: "Cairo_600SemiBold",
    textAlign: "right", paddingRight: 70, paddingLeft: 24,
  },
  navLabelActive: { color: C.accent, fontFamily: "Cairo_700Bold" },

  divider: { height: 1, backgroundColor: C.border, marginVertical: 14, marginHorizontal: 12 },
  signOutItem: {},
  signOutLabel: { color: C.accent },

  footer: { alignItems: "center", marginTop: 28 },
  footerName: { color: C.textSecondary, fontSize: 12, fontWeight: "700", fontFamily: "Cairo_700Bold" },
  footerVersion: { color: C.textMuted, fontSize: 11, marginTop: 3, fontFamily: "Cairo_500Medium" },
});

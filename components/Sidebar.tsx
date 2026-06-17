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
  I18nManager,
} from "react-native";
import { Image } from "expo-image";
import { router, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useAuth } from "../lib/auth";
import { getHistory, isCompleted } from "../lib/history";
import { getFavorites } from "../lib/favorites";
import { C, R, ELEVATION_CARD } from "../lib/theme";
import { t } from "../lib/i18n";

const { width: SW } = Dimensions.get("window");
const PANEL_W = Math.min(330, SW * 0.84);

// RTL-aware row direction. Hardcoding "row-reverse" double-flips under forced
// RTL and breaks icon alignment; match the rest of the app's pattern.
const ROW_DIR = I18nManager.isRTL ? "row" : "row-reverse";

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

/* ── Sidebar UI ──────────────────────────────── */

interface QuickStats {
  episodesWatched: number;
  animeCount: number;
}

interface NavRow {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}

function Sidebar() {
  const { open, closeSidebar } = useSidebar();
  const { user, signOut, isConfigured } = useAuth();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();

  const [mounted, setMounted] = useState(false);
  const [stats, setStats] = useState<QuickStats>({ episodesWatched: 0, animeCount: 0 });
  // Single driver (0 = closed, 1 = open) — the panel slide and backdrop fade are
  // both interpolated from it, so the whole thing animates on one native value.
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
        duration: 300,
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

  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [PANEL_W, 0] });
  const backdropOpacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

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
    { icon: "person-outline", label: t.profile, onPress: () => go("/profile") },
    { icon: "heart-outline", label: t.myListTitle, onPress: () => go("/(tabs)/mylist") },
    { icon: "notifications-outline", label: t.notifications, onPress: () => go("/notifications") },
    { icon: "settings-outline", label: t.settingsTitle, onPress: () => go("/settings") },
    { icon: "share-social-outline", label: t.shareApp, onPress: onShare },
  ];

  return (
    <View style={st.overlay} pointerEvents="box-none">
      {/* Backdrop */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]} pointerEvents={open ? "auto" : "none"}>
        <Pressable style={st.backdrop} onPress={closeSidebar} />
      </Animated.View>

      {/* Panel (slides from the right — RTL natural) */}
      <Animated.View
        style={[st.panel, { width: PANEL_W, paddingTop: insets.top + 10, transform: [{ translateX }] }]}
      >
        {/* Decorative top glow */}
        <LinearGradient
          colors={[C.violetSoft, "transparent"]}
          start={{ x: 1, y: 0 }}
          end={{ x: 0.1, y: 0.5 }}
          style={st.mesh}
          pointerEvents="none"
        />

        {/* Header: title (right) + close (left) */}
        <View style={st.header}>
          <Pressable onPress={closeSidebar} hitSlop={8} style={st.closeBtn}>
            <Ionicons name="close" size={20} color={C.text} />
          </Pressable>
          <Text style={st.headerTitle}>{t.menu}</Text>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
          {/* Profile card */}
          <Pressable style={({ pressed }) => [st.profileCard, pressed && st.pressed]} onPress={() => go("/profile")}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={st.avatar} contentFit="cover" transition={150} />
            ) : (
              <LinearGradient colors={[C.accent, C.violet]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.avatar}>
                <Text style={st.avatarInitial}>{initial}</Text>
              </LinearGradient>
            )}
            <View style={st.profileText}>
              <Text style={st.name} numberOfLines={1}>{displayName}</Text>
              <Text style={st.email} numberOfLines={1}>{user?.email || t.guest}</Text>
            </View>
            <Ionicons name="chevron-back" size={18} color={C.textMuted} />
          </Pressable>

          {/* Quick stats */}
          <View style={st.statsRow}>
            <View style={st.statCard}>
              <Text style={st.statNum}>{stats.episodesWatched}</Text>
              <Text style={st.statLabel}>{t.statsEpisodesWatched}</Text>
            </View>
            <View style={st.statCard}>
              <Text style={st.statNum}>{stats.animeCount}</Text>
              <Text style={st.statLabel}>{t.statsAnimeInList}</Text>
            </View>
          </View>

          {/* Nav items */}
          <View style={st.navList}>
            {NAV.map((item) => (
              <Pressable
                key={item.label}
                onPress={item.onPress}
                style={({ pressed }) => [st.navItem, pressed && st.pressed]}
              >
                <View style={st.navIcon}>
                  <Ionicons name={item.icon} size={19} color={C.text} />
                </View>
                <Text style={st.navLabel}>{item.label}</Text>
                <Ionicons name="chevron-back" size={16} color={C.textMuted} />
              </Pressable>
            ))}
          </View>

          {/* Sign out */}
          {isConfigured && user ? (
            <>
              <View style={st.divider} />
              <Pressable
                onPress={() => { closeSidebar(); setTimeout(() => signOut(), 80); }}
                style={({ pressed }) => [st.navItem, pressed && st.pressed]}
              >
                <View style={[st.navIcon, { backgroundColor: C.accentSoft }]}>
                  <Ionicons name="log-out-outline" size={19} color={C.accent} />
                </View>
                <Text style={[st.navLabel, { color: C.accent }]}>{t.signOut}</Text>
              </Pressable>
            </>
          ) : null}

          <Text style={st.brand}>{t.settingsAppName} · {t.settingsTagline}</Text>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

/* Rows are laid out right-to-left (icon on the right, label flowing right,
 * chevron on the far left) to match the app's Arabic reading direction. */
const st = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 1000 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },

  panel: {
    position: "absolute", top: 0, bottom: 0, right: 0,
    backgroundColor: C.bgDeep,
    borderTopLeftRadius: 24, borderBottomLeftRadius: 24,
    borderLeftWidth: 1, borderColor: C.glassBorder,
    paddingHorizontal: 16,
    overflow: "hidden",
    ...ELEVATION_CARD,
    shadowOffset: { width: -8, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
  },
  mesh: { position: "absolute", top: 0, right: 0, left: 0, height: 200 },

  header: {
    flexDirection: ROW_DIR, alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 4, paddingBottom: 12,
  },
  headerTitle: { color: C.text, fontSize: 18, fontWeight: "800", fontFamily: "Outfit_800ExtraBold" },
  closeBtn: {
    width: 34, height: 34, borderRadius: R.circle,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    alignItems: "center", justifyContent: "center",
  },

  profileCard: {
    flexDirection: ROW_DIR, alignItems: "center",
    padding: 12, borderRadius: R.lg,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    marginBottom: 14,
  },
  avatar: {
    width: 50, height: 50, borderRadius: R.circle,
    alignItems: "center", justifyContent: "center",
  },
  avatarInitial: { color: "#fff", fontSize: 21, fontWeight: "800", fontFamily: "Outfit_800ExtraBold" },
  profileText: { flex: 1, marginHorizontal: 12 },
  name: { color: C.text, fontSize: 15, fontWeight: "700", fontFamily: "Outfit_700Bold", textAlign: "right" },
  email: { color: C.textMuted, fontSize: 12, marginTop: 3, fontFamily: "DMSans_500Medium", textAlign: "right" },

  statsRow: { flexDirection: ROW_DIR, marginBottom: 18 },
  statCard: {
    flex: 1, marginHorizontal: 5, borderRadius: R.lg, paddingVertical: 14, alignItems: "center",
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
  },
  statNum: { color: C.accent, fontSize: 22, fontWeight: "800", fontFamily: "Outfit_800ExtraBold" },
  statLabel: { color: C.textSecondary, fontSize: 10, marginTop: 4, fontFamily: "DMSans_500Medium" },

  navList: {},
  navItem: {
    flexDirection: ROW_DIR, alignItems: "center",
    marginVertical: 1, paddingVertical: 11, paddingHorizontal: 8, borderRadius: R.lg,
  },
  pressed: { backgroundColor: C.glass },
  navIcon: {
    width: 38, height: 38, borderRadius: R.md,
    backgroundColor: C.surfaceLight, alignItems: "center", justifyContent: "center",
  },
  navLabel: { flex: 1, marginHorizontal: 13, color: C.text, fontSize: 14, fontWeight: "600", fontFamily: "DMSans_600SemiBold", textAlign: "right" },

  divider: { height: 1, backgroundColor: C.border, marginVertical: 12, marginHorizontal: 4 },
  brand: {
    color: C.textMuted, fontSize: 11, textAlign: "center", marginTop: 24,
    fontFamily: "DMSans_500Medium",
  },
});

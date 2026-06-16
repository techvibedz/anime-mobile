import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  Dimensions,
  Share,
  Linking,
  ScrollView,
} from "react-native";
import { Image } from "expo-image";
import { router, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import { useAuth } from "../lib/auth";
import { getHistory, isCompleted } from "../lib/history";
import { getFavorites } from "../lib/favorites";
import { C, S, R, ELEVATION_CARD } from "../lib/theme";
import { t } from "../lib/i18n";

const { width: SW } = Dimensions.get("window");
const PANEL_W = Math.min(320, SW * 0.82);

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

/* ── Quick stats ─────────────────────────────── */

interface QuickStats {
  episodesWatched: number;
  animeCount: number;
}

/* ── Sidebar UI ──────────────────────────────── */

function Sidebar() {
  const { open, closeSidebar } = useSidebar();
  const { user, signOut, isConfigured } = useAuth();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();

  const [mounted, setMounted] = useState(false);
  const [stats, setStats] = useState<QuickStats>({ episodesWatched: 0, animeCount: 0 });
  const slide = useRef(new Animated.Value(PANEL_W)).current;
  const fade = useRef(new Animated.Value(0)).current;

  // Close the drawer automatically whenever the route changes.
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
      // Refresh quick stats each time it opens.
      Promise.all([getHistory(), getFavorites()])
        .then(([history, favs]) => {
          setStats({
            episodesWatched: history.filter(isCompleted).length,
            animeCount: favs.length,
          });
        })
        .catch(() => {});
      Animated.parallel([
        Animated.timing(slide, { toValue: 0, duration: 260, useNativeDriver: true }),
        Animated.timing(fade, { toValue: 1, duration: 260, useNativeDriver: true }),
      ]).start();
    } else if (mounted) {
      Animated.parallel([
        Animated.timing(slide, { toValue: PANEL_W, duration: 220, useNativeDriver: true }),
        Animated.timing(fade, { toValue: 0, duration: 220, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [open]);

  if (!mounted) return null;

  const displayName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    (user?.email ? user.email.split("@")[0] : t.guest);
  const avatarUrl = user?.user_metadata?.avatar_url || user?.user_metadata?.picture || null;
  const initial = (displayName || "?").trim().charAt(0).toUpperCase();

  const go = (path: string) => {
    closeSidebar();
    // Defer navigation slightly so the close animation reads smoothly.
    setTimeout(() => router.push(path as any), 60);
  };

  const onShare = () => {
    closeSidebar();
    Share.share({ message: t.shareAppMessage }).catch(() => {});
  };

  const NAV: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; accent?: boolean }[] = [
    { icon: "person-circle-outline", label: t.profile, onPress: () => go("/profile") },
    { icon: "heart-outline", label: t.myListTitle, onPress: () => go("/(tabs)/mylist") },
    { icon: "notifications-outline", label: t.notifications, onPress: () => go("/notifications") },
    { icon: "settings-outline", label: t.settingsTitle, onPress: () => go("/settings") },
    { icon: "share-social-outline", label: t.shareApp, onPress: onShare },
  ];

  return (
    <View style={st.overlay} pointerEvents="box-none">
      {/* Backdrop */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={closeSidebar}>
          <View style={st.backdrop} />
        </Pressable>
      </Animated.View>

      {/* Panel (slides from the right) */}
      <Animated.View
        style={[
          st.panel,
          { width: PANEL_W, paddingTop: insets.top + 16, transform: [{ translateX: slide }] },
        ]}
      >
        <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill}>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: C.bgDeep }]} />
        </BlurView>

        {/* Decorative mesh glow */}
        <LinearGradient
          colors={[C.violetSoft, "transparent"]}
          start={{ x: 1, y: 0 }}
          end={{ x: 0, y: 0.6 }}
          style={st.mesh}
          pointerEvents="none"
        />

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
          {/* Profile header */}
          <Pressable style={st.profileBtn} onPress={() => go("/profile")}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={st.avatar} contentFit="cover" transition={150} />
            ) : (
              <LinearGradient colors={[C.accent, C.violet]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.avatar}>
                <Text style={st.avatarInitial}>{initial}</Text>
              </LinearGradient>
            )}
            <View style={st.profileText}>
              <Text style={st.name} numberOfLines={1}>{displayName}</Text>
              {user?.email ? (
                <Text style={st.email} numberOfLines={1}>{user.email}</Text>
              ) : (
                <Text style={st.email} numberOfLines={1}>{t.guest}</Text>
              )}
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
                style={({ pressed }) => [st.navItem, pressed && st.navItemPressed]}
              >
                <View style={st.navIcon}>
                  <Ionicons name={item.icon} size={19} color={C.text} />
                </View>
                <Text style={st.navLabel}>{item.label}</Text>
                <Ionicons name="chevron-back" size={16} color={C.textMuted} style={{ marginLeft: "auto" }} />
              </Pressable>
            ))}
          </View>

          {/* Footer */}
          <View style={st.divider} />
          {isConfigured && user ? (
            <Pressable
              onPress={() => { closeSidebar(); signOut(); }}
              style={({ pressed }) => [st.navItem, pressed && st.navItemPressed]}
            >
              <View style={[st.navIcon, { backgroundColor: C.accentSoft }]}>
                <Ionicons name="log-out-outline" size={19} color={C.accent} />
              </View>
              <Text style={[st.navLabel, { color: C.accent }]}>{t.signOut}</Text>
            </Pressable>
          ) : null}

          <Text style={st.brand}>{t.settingsAppName} · {t.settingsTagline}</Text>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const st = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 1000 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  panel: {
    position: "absolute", top: 0, bottom: 0, right: 0,
    overflow: "hidden",
    borderTopLeftRadius: R.xxl, borderBottomLeftRadius: R.xxl,
    borderLeftWidth: 1, borderColor: C.glassBorder,
    paddingHorizontal: 16,
    ...ELEVATION_CARD,
  },
  mesh: { position: "absolute", top: 0, right: 0, width: PANEL_W, height: 220 },

  profileBtn: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 12, paddingHorizontal: 4,
  },
  avatar: {
    width: 52, height: 52, borderRadius: R.circle,
    alignItems: "center", justifyContent: "center",
  },
  avatarInitial: { color: "#fff", fontSize: 22, fontWeight: "800", fontFamily: "Outfit_800ExtraBold" },
  profileText: { flex: 1 },
  name: { color: C.text, fontSize: 16, fontWeight: "700", fontFamily: "Outfit_700Bold", textAlign: "left" },
  email: { color: C.textMuted, fontSize: 12, marginTop: 2, fontFamily: "DMSans_500Medium", textAlign: "left" },

  statsRow: { flexDirection: "row", gap: 10, marginVertical: 14 },
  statCard: {
    flex: 1, borderRadius: R.lg, paddingVertical: 14, alignItems: "center",
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
  },
  statNum: { color: C.accent, fontSize: 22, fontWeight: "800", fontFamily: "Outfit_800ExtraBold" },
  statLabel: { color: C.textSecondary, fontSize: 10, marginTop: 3, fontFamily: "DMSans_500Medium" },

  navList: { gap: 4, marginTop: 4 },
  navItem: {
    flexDirection: "row", alignItems: "center", gap: 14,
    paddingVertical: 12, paddingHorizontal: 8, borderRadius: R.lg,
  },
  navItemPressed: { backgroundColor: C.glass },
  navIcon: {
    width: 38, height: 38, borderRadius: R.md,
    backgroundColor: C.surfaceLight, alignItems: "center", justifyContent: "center",
  },
  navLabel: { color: C.text, fontSize: 14, fontWeight: "600", fontFamily: "DMSans_600SemiBold" },

  divider: { height: 1, backgroundColor: C.border, marginVertical: 14 },
  brand: {
    color: C.textMuted, fontSize: 11, textAlign: "center", marginTop: 18,
    fontFamily: "DMSans_500Medium",
  },
});

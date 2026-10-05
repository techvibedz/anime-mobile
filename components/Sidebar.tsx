import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { View, Text, Pressable, StyleSheet, Animated, Easing, Modal, useWindowDimensions, Share, ScrollView } from "react-native";
import { Image } from "expo-image";
import { router, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useAuth } from "../lib/auth";
import { isAdmin } from "../lib/presence";
import { getHistory, isCompleted } from "../lib/history";
import { getFavorites } from "../lib/favorites";
import { C, ABSOLUTE_FILL } from "../lib/theme";
import { t } from "../lib/i18n";
import Constants from "expo-constants";
import * as Application from "expo-application";
import { useReducedMotion } from "../lib/motion";

// The installed binary's version takes precedence over a newer JS bundle.
const appVersion = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? "0.0.0";
const APP_LOGO = require("../assets/icon.png");

interface SidebarActions { openSidebar: () => void; closeSidebar: () => void }
interface SidebarCtx extends SidebarActions { open: boolean }
// Keep actions stable so opening the drawer doesn't re-render every screen.
const ActionsCtx = createContext<SidebarActions | undefined>(undefined);
const OpenCtx = createContext(false);

export function useSidebarActions(): SidebarActions {
  const actions = useContext(ActionsCtx);
  if (!actions) throw new Error("useSidebar must be used within SidebarProvider");
  return actions;
}
export function useSidebar(): SidebarCtx {
  return { open: useContext(OpenCtx), ...useSidebarActions() };
}
export function SidebarProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openSidebar = useCallback(() => setOpen(true), []);
  const closeSidebar = useCallback(() => setOpen(false), []);
  const actions = useMemo(() => ({ openSidebar, closeSidebar }), [openSidebar, closeSidebar]);
  return <ActionsCtx.Provider value={actions}><OpenCtx.Provider value={open}>{children}<Sidebar /></OpenCtx.Provider></ActionsCtx.Provider>;
}

interface NavRow {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  path?: string;
  match?: string;
}

function Sidebar() {
  const { open, closeSidebar } = useSidebar();
  const { user, signOut, isConfigured } = useAuth();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const panelWidth = Math.min(380, width - 32);
  const pathname = usePathname();
  const reduced = useReducedMotion();
  const admin = isAdmin(user?.email);
  const [mounted, setMounted] = useState(false);
  const [stats, setStats] = useState({ episodesWatched: 0, animeCount: 0 });
  const anim = useRef(new Animated.Value(0)).current;
  const lastPath = useRef(pathname);

  useEffect(() => {
    if (pathname !== lastPath.current) {
      lastPath.current = pathname;
      if (open) closeSidebar();
    }
  }, [pathname, open, closeSidebar]);

  useEffect(() => {
    let alive = true;
    anim.stopAnimation();
    if (open) {
      setMounted(true);
      Promise.all([getHistory(), getFavorites()]).then(([history, favorites]) => {
        if (alive) setStats({ episodesWatched: history.filter(isCompleted).length, animeCount: favorites.length });
      }).catch(() => {});
    }
    const transition = Animated.timing(anim, {
      toValue: open ? 1 : 0,
      duration: reduced ? 0 : open ? 360 : 240,
      easing: open ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    });
    transition.start(({ finished }) => {
      if (alive && finished && !open) setMounted(false);
    });
    return () => { alive = false; transition.stop(); };
  }, [open, reduced, anim]);

  if (!mounted) return null;

  const go = (path: string) => {
    closeSidebar();
    router.push(path as any);
  };
  const share = () => {
    closeSidebar();
    // Let the native drawer finish dismissing before presenting the share sheet.
    setTimeout(() => Share.share({ message: t.shareAppMessage }).catch(() => {}), reduced ? 0 : 260);
  };
  const displayName = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split("@")[0] || t.guest;
  const avatarUrl = user?.user_metadata?.avatar_url || user?.user_metadata?.picture;
  const groups: { title: string; items: NavRow[] }[] = [
    { title: t.discover, items: [
      { icon: "home-outline", label: t.home, path: "/(tabs)", match: "/" },
      { icon: "search-outline", label: t.discover, path: "/(tabs)/search", match: "/search" },
      { icon: "book-outline", label: t.mangaTab, path: "/(tabs)/manga", match: "/manga" },
      { icon: "calendar-outline", label: t.scheduleTitle, path: "/schedule", match: "/schedule" },
      { icon: "sparkles-outline", label: t.upcomingTitle, path: "/upcoming", match: "/upcoming" },
      { icon: "albums-outline", label: t.seasonsTitle, path: "/seasons", match: "/seasons" },
      { icon: "newspaper-outline", label: t.newsTitle, path: "/news", match: "/news" },
    ] },
    { title: t.sidebarLibrary, items: [
      { icon: "heart-outline", label: t.myListTitle, path: "/(tabs)/mylist", match: "/mylist" },
      { icon: "bookmarks-outline", label: t.mangaLibrary, path: "/manga-library", match: "/manga-library" },
      { icon: "time-outline", label: t.watchHistory, path: "/history", match: "/history" },
      { icon: "download-outline", label: t.downloadsTitle, path: "/downloads", match: "/downloads" },
      { icon: "people-outline", label: t.wpTitle, path: "/watch-party", match: "/watch-party" },
    ] },
    { title: t.sidebarAccount, items: [
      { icon: "person-outline", label: t.profile, path: "/profile", match: "/profile" },
      { icon: "notifications-outline", label: t.notifications, path: "/notifications", match: "/notifications" },
      { icon: "settings-outline", label: t.settingsTitle, path: "/settings", match: "/settings" },
      ...(!admin ? [{ icon: "chatbubble-ellipses-outline" as const, label: t.chatMenuUser, path: "/chat", match: "/chat" }] : []),
      { icon: "bug-outline", label: t.reportIssue, path: "/report", match: "/report" },
      { icon: "share-social-outline", label: t.shareApp },
    ] },
    ...(admin ? [{ title: t.sidebarAdmin, items: [
      { icon: "pulse-outline" as const, label: t.liveUsersTitle, path: "/live", match: "/live" },
      { icon: "stats-chart-outline" as const, label: t.usersTitle, path: "/users", match: "/users" },
      { icon: "chatbubbles-outline" as const, label: t.chatMenuAdmin, path: "/admin/chats", match: "/admin/chats" },
      { icon: "terminal-outline" as const, label: t.logsTitle, path: "/admin/logs", match: "/admin/logs" },
    ] }] : []),
  ];

  return (
    <Modal transparent visible={mounted} animationType="none" onRequestClose={closeSidebar} statusBarTranslucent navigationBarTranslucent>
      <View style={st.overlay} accessibilityViewIsModal>
        <Animated.View style={[ABSOLUTE_FILL, { opacity: anim }]} pointerEvents={open ? "auto" : "none"}>
          <Pressable style={st.backdrop} onPress={closeSidebar} accessibilityRole="button" accessibilityLabel={t.close} />
        </Animated.View>
        <Animated.View style={[st.panel, {
          width: panelWidth, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 8,
          transform: [{ translateX: anim.interpolate({ inputRange: [0, 1], outputRange: [panelWidth + 8, 0] }) }],
        }]} pointerEvents={open ? "auto" : "none"}>
          <LinearGradient colors={["rgba(139,147,255,0.12)", "transparent"]} style={st.brandGlow} pointerEvents="none" />
          <View style={st.header}>
            <Pressable onPress={closeSidebar} accessibilityRole="button" accessibilityLabel={t.close} style={({ pressed }) => [st.closeBtn, pressed && st.pressed]}>
              <Ionicons name="close" size={21} color={C.textSecondary} />
            </Pressable>
            <View style={st.brandText}>
              <Text style={st.brandName}>Pantoufa</Text>
              <Text style={st.brandTag}>{t.settingsTagline}</Text>
            </View>
            <Image source={APP_LOGO} style={st.logo} contentFit="contain" accessibilityLabel="Pantoufa" />
          </View>
          <ScrollView style={st.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={st.scrollContent}>
            <Pressable onPress={() => go("/profile")} accessibilityRole="button" accessibilityLabel={t.profileTitle} style={({ pressed }) => [st.profile, pressed && st.pressed]}>
              <Ionicons name="chevron-back" size={16} color={C.textMuted} />
              <View style={st.profileText}>
                <Text style={st.name} numberOfLines={1}>{displayName}</Text>
                <Text style={st.email} numberOfLines={1}>{user?.email || t.profileTitle}</Text>
              </View>
              {avatarUrl ? <Image source={{ uri: avatarUrl }} style={st.avatar} contentFit="cover" /> :
                <View style={[st.avatar, st.avatarFallback]}><Text style={st.initial}>{displayName.trim().charAt(0).toUpperCase()}</Text></View>}
            </Pressable>
            <View style={st.stats}>
              <View style={st.stat}><Text style={st.statValue}>{stats.episodesWatched}</Text><Text style={st.statLabel}>{t.statsEpisodesWatched}</Text></View>
              <View style={st.statDivider} />
              <View style={st.stat}><Text style={st.statValue}>{stats.animeCount}</Text><Text style={st.statLabel}>{t.statsAnimeInList}</Text></View>
            </View>
            {groups.map((group, index) => (
              <Animated.View key={group.title} style={reduced ? undefined : {
                opacity: anim.interpolate({ inputRange: [0, 0.15 + index * 0.09, 1], outputRange: [0, 0, 1] }),
                transform: [{ translateX: anim.interpolate({ inputRange: [0, 1], outputRange: [24 + index * 8, 0] }) }],
              }}>
                <View style={st.sectionHeader}><View style={st.sectionLine} /><Text style={st.sectionTitle}>{group.title}</Text></View>
                {group.items.map((item) => {
                  const active = !!item.match && (pathname === item.match || (item.match !== "/" && pathname.startsWith(item.match + "/")));
                  return <Pressable key={item.label} onPress={() => item.path ? go(item.path) : share()} accessibilityRole="button" accessibilityLabel={item.label} accessibilityState={{ selected: active }}
                    style={({ pressed }) => [st.navItem, active && st.navActive, pressed && st.pressed]}>
                    <Ionicons name={active ? "chevron-back" : "remove-outline"} size={active ? 15 : 10} color={active ? C.accent : C.textFaint} />
                    <Text style={[st.navLabel, active && st.activeLabel]}>{item.label}</Text>
                    <View style={[st.navIcon, active && st.activeIcon]}><Ionicons name={item.icon} size={20} color={active ? C.accent : C.textSecondary} /></View>
                  </Pressable>;
                })}
              </Animated.View>
            ))}
          </ScrollView>
          <View style={st.footer}>
            {isConfigured && user ? <Pressable onPress={() => { closeSidebar(); void signOut(); }} accessibilityRole="button" accessibilityLabel={t.signOut} style={({ pressed }) => [st.signOut, pressed && st.pressed]}>
              <Text style={st.signOutLabel}>{t.signOut}</Text><Ionicons name="log-out-outline" size={19} color={C.error} />
            </Pressable> : null}
            <View style={st.versionRow}><Text style={st.version}>v{appVersion}</Text><Text style={st.footerName}>{t.settingsAppName}</Text><View style={st.footerDot} /></View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  overlay: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.72)" },
  panel: { position: "absolute", top: 0, bottom: 0, right: 0, backgroundColor: C.surfaceContainer,
    borderTopLeftRadius: 28, borderBottomLeftRadius: 28, borderLeftWidth: 1, borderColor: C.borderLight, overflow: "hidden" },
  brandGlow: { position: "absolute", top: 0, right: 0, left: 0, height: 230 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingBottom: 18 },
  closeBtn: { width: 48, height: 48, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: 16, backgroundColor: C.glass },
  brandText: { flex: 1, minWidth: 0, alignItems: "flex-end" },
  brandName: { fontFamily: "Outfit_700Bold", fontSize: 23, lineHeight: 30, color: C.text, letterSpacing: -0.5 },
  brandTag: { fontFamily: "Cairo_500Medium", fontSize: 11, lineHeight: 19, color: C.textSecondary, textAlign: "right" },
  logo: { width: 58, height: 58, flexShrink: 0, borderRadius: 17, borderWidth: 1, borderColor: C.borderLight },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 16 },
  profile: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, minHeight: 72,
    borderRadius: 18, backgroundColor: C.surfaceElevated, borderWidth: 1, borderColor: C.borderSoft },
  profileText: { flex: 1, minWidth: 0, alignItems: "flex-end" },
  name: { color: C.text, fontFamily: "Cairo_700Bold", fontSize: 14, lineHeight: 24, textAlign: "right" },
  email: { color: C.textMuted, fontFamily: "Cairo_500Medium", fontSize: 11, lineHeight: 19, textAlign: "right" },
  avatar: { width: 44, height: 44, borderRadius: 14, flexShrink: 0 },
  avatarFallback: { backgroundColor: C.accentSoft, alignItems: "center", justifyContent: "center" },
  initial: { color: C.accent, fontFamily: "Cairo_700Bold", fontSize: 20, lineHeight: 30 },
  stats: { flexDirection: "row", alignItems: "center", marginTop: 14, paddingVertical: 8 },
  stat: { flex: 1, alignItems: "center", paddingHorizontal: 6 },
  statValue: { color: C.text, fontFamily: "Outfit_600SemiBold", fontSize: 19, lineHeight: 25 },
  statLabel: { color: C.textMuted, fontFamily: "Cairo_500Medium", fontSize: 11, lineHeight: 19, textAlign: "center" },
  statDivider: { width: 1, height: 24, backgroundColor: C.border },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 20, marginBottom: 9, paddingHorizontal: 10 },
  sectionLine: { height: 1, flex: 1, backgroundColor: C.borderSoft },
  sectionTitle: { color: C.textMuted, fontFamily: "Cairo_600SemiBold", fontSize: 11, lineHeight: 19 },
  navItem: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 50, paddingVertical: 6, paddingHorizontal: 12,
    marginBottom: 3, borderRadius: 14, borderWidth: 1, borderColor: "transparent" },
  navActive: { backgroundColor: C.accentSoft, borderColor: C.borderAccent },
  navLabel: { flex: 1, minWidth: 0, textAlign: "right", color: C.textSecondary, fontFamily: "Cairo_600SemiBold", fontSize: 14, lineHeight: 24 },
  activeLabel: { color: C.text, fontFamily: "Cairo_700Bold" },
  navIcon: { width: 32, height: 32, borderRadius: 10, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  activeIcon: { backgroundColor: "rgba(139,147,255,0.16)" },
  pressed: { opacity: 0.7 },
  footer: { borderTopWidth: 1, borderColor: C.borderSoft, paddingHorizontal: 22, paddingTop: 8 },
  signOut: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 12, minHeight: 48, borderRadius: 12 },
  signOutLabel: { color: C.error, fontFamily: "Cairo_600SemiBold", fontSize: 13, lineHeight: 23 },
  versionRow: { flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 9 },
  version: { flex: 1, fontFamily: "Outfit_400Regular", color: C.textMuted, fontSize: 11, lineHeight: 18 },
  footerName: { fontFamily: "Cairo_500Medium", color: C.textMuted, fontSize: 11, lineHeight: 18 },
  footerDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: C.mint },
});

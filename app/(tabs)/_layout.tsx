import { Tabs } from "expo-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LiquidGlass } from "../../components/LiquidGlass";
import { View, Text, StyleSheet, Pressable, Animated, Easing, type LayoutChangeEvent } from "react-native";
import { useReducedMotion } from "../../lib/motion";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C, AR } from "../../lib/theme";
import { M, MT } from "../../lib/manga/design";

const TABS = [
  { name: "index", icon: "home" as const, label: "الرئيسية" },
  { name: "search", icon: "search" as const, label: "اكتشف" },
  { name: "manga", icon: "book" as const, label: "مانجا" },
  { name: "mylist", icon: "heart" as const, label: "قائمتي" },
];

const PRELOAD_START_MS = 4000;
const PRELOAD_GAP_MS = 1500;

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { display: "none" },
        // Scene container background — without this the bottom-tabs wrapper
        // defaults to the system window background (white), so every tab
        // switch briefly flashes white before the screen's root View paints.
        // Lock it to the app's ink bg so transitions stay dark.
        sceneStyle: { backgroundColor: C.bg },
        // Other tabs are preloaded by FloatingNav once home has painted —
        // mounting all four at launch competed with the home feed and froze
        // the first taps for ~1s.
        lazy: true,
      }}
      tabBar={(props) => <FloatingNav {...props} />}
    >
      {TABS.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.label, ...(tab.name === "manga" ? { sceneStyle: { backgroundColor: M.paper } } : {}) }} />
      ))}
    </Tabs>
  );
}

function FloatingNav({ state, navigation }: any) {
  const insets = useSafeAreaInsets();
  const manga = state.routes[state.index]?.name === "manga";
  // Pre-mount the other tabs one at a time after launch, so the first visit to
  // each doesn't mount-and-flash, without blocking home's first frames.
  useEffect(() => {
    const timers = TABS.slice(1).map((tab, i) =>
      setTimeout(() => navigation.preload?.(tab.name), PRELOAD_START_MS + i * PRELOAD_GAP_MS));
    return () => timers.forEach(clearTimeout);
  }, [navigation]);
  // ── Liquid bubble: ONE droplet that slides to the active tab (iOS 26 style)
  // with a spring, stretching a little while it travels like a drop of
  // liquid. Native-driver transforms only — no glass capture, ~zero JS cost.
  const reduced = useReducedMotion();
  const [itemX, setItemX] = useState<number[]>([]);
  const [itemW, setItemW] = useState(0);
  const slide = useRef(new Animated.Value(0)).current;
  const stretch = useRef(new Animated.Value(1)).current;
  const placed = useRef(false);
  const onItemLayout = (i: number) => (e: LayoutChangeEvent) => {
    const { x, width } = e.nativeEvent.layout;
    setItemX((prev) => {
      if (prev[i] === x) return prev;
      const next = prev.slice();
      next[i] = x;
      return next;
    });
    if (i === 0) setItemW(width);
  };
  const targetX = itemX[state.index];
  useEffect(() => {
    if (targetX == null) return;
    if (!placed.current || reduced) {
      placed.current = true;
      slide.setValue(targetX);
      return;
    }
    Animated.parallel([
      Animated.spring(slide, { toValue: targetX, useNativeDriver: true, damping: 17, stiffness: 190, mass: 0.9 }),
      Animated.sequence([
        Animated.timing(stretch, { toValue: 1.2, duration: 110, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.spring(stretch, { toValue: 1, useNativeDriver: true, damping: 9, stiffness: 220 }),
      ]),
    ]).start();
  }, [targetX, reduced, slide, stretch]);

  // A floating capsule above the system bars. row-reverse puts the first tab
  // (home) on the right, where an Arabic reader starts.
  return (
    <View style={[ss.navWrap, { bottom: Math.max(insets.bottom, 10) }]} pointerEvents="box-none">
      <NavSurface manga={manga}>
        {itemW > 0 && targetX != null ? (
          <Animated.View
            pointerEvents="none"
            style={[ss.bubble, manga && ss.bubbleManga, { width: itemW, transform: [{ translateX: slide }, { scaleX: stretch }] }]}
          />
        ) : null}
        {TABS.map((tab, i) => {
          const active = state.index === i;
          const tint = manga ? (active ? M.ink : M.muted) : active ? C.accent : C.textSecondary;
          return (
            <Pressable
              key={tab.name}
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: active }}
              onPress={() => {
                const event = navigation.emit({ type: "tabPress", target: state.routes[i].key, canPreventDefault: true });
                if (!active && !event.defaultPrevented) navigation.navigate(state.routes[i].name);
              }}
              onLayout={onItemLayout(i)}
              style={({ pressed }) => [ss.navItem, pressed && ss.navItemPressed]}
            >
              <View style={ss.iconPill}>
                <Ionicons name={active ? tab.icon : (`${tab.icon}-outline` as any)} size={21} color={tint} />
              </View>
              <Text style={[ss.navLabel, { color: tint }, active && ss.navLabelActive, manga && { ...MT.caption, fontSize: 11, color: active ? M.ink : M.muted }]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </NavSurface>
    </View>
  );
}

// Liquid Glass capsule (real refraction of the posters under it). On the manga
// tab the same glass takes a light paper tint to sit on its ink-and-paper page.
function NavSurface({ manga, children }: { manga: boolean; children: ReactNode }) {
  if (manga) {
    return (
      <LiquidGlass preset="floatingTabBar" variant="clear" radius={32} tintColor="rgba(245,241,232,0.66)" legibilityFloor={0} edgeReflectionStrength={0.35} style={[ss.capsule, ss.capsuleManga]}>
        {children}
      </LiquidGlass>
    );
  }
  return (
    <LiquidGlass preset="floatingTabBar" variant="clear" radius={32} tintColor="rgba(10,10,14,0.18)" legibilityFloor={0.5} edgeReflectionStrength={0.35} style={ss.capsule}>
      {children}
    </LiquidGlass>
  );
}

const ss = StyleSheet.create({
  navWrap: {
    position: "absolute", left: 14, right: 14,
    alignItems: "center", zIndex: 100,
  },
  capsule: {
    width: "100%", maxWidth: 560,
    flexDirection: "row-reverse", alignItems: "center",
    paddingHorizontal: 6, paddingVertical: 6,

  },
  // Soft shadow so the light glass lifts off the light paper page.
  capsuleManga: { shadowColor: "#22231F", shadowOpacity: 0.16, shadowRadius: 18, shadowOffset: { width: 0, height: 6 } },
  navItem: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 56 },
  // Material-style indicator: a pill behind the active icon, label below.
  iconPill: { width: 56, height: 32, borderRadius: 16, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  navItemPressed: { transform: [{ scale: 0.92 }] },
  // The sliding liquid droplet behind the active tab: clear white glass with a
  // bright specular top edge. Spans the whole tab (icon + label).
  bubble: {
    position: "absolute", left: 0, top: 6, bottom: 6,
    borderRadius: 26,
    backgroundColor: "rgba(255,255,255,0.13)", borderWidth: 1,
    borderTopColor: "rgba(255,255,255,0.55)", borderLeftColor: "rgba(255,255,255,0.22)",
    borderRightColor: "rgba(255,255,255,0.22)", borderBottomColor: "rgba(255,255,255,0.10)",
  },
  // Manga bubble: ink-tinted droplet with a bright paper rim.
  bubbleManga: {
    backgroundColor: "rgba(34,35,31,0.08)",
    borderTopColor: "rgba(255,255,255,0.95)", borderLeftColor: "rgba(34,35,31,0.10)",
    borderRightColor: "rgba(34,35,31,0.10)", borderBottomColor: "rgba(34,35,31,0.16)",
  },
  navLabel: { fontSize: 11, lineHeight: 16, marginTop: 2, fontFamily: AR.semibold },
  navLabelActive: { fontFamily: AR.bold },
});

import { Tabs } from "expo-router";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C, AR, ELEVATION_NAV } from "../../lib/theme";
import { M, MT } from "../../lib/manga/design";

const TABS = [
  { name: "index", icon: "home" as const, label: "الرئيسية" },
  { name: "search", icon: "search" as const, label: "اكتشف" },
  { name: "manga", icon: "book" as const, label: "مانجا" },
  { name: "mylist", icon: "heart" as const, label: "قائمتي" },
];

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
        // Pre-mount every tab so the first visit to each doesn't mount-and-flash.
        lazy: false,
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
  // A floating capsule above the system bars. row-reverse puts the first tab
  // (home) on the right, where an Arabic reader starts.
  return (
    <View style={[ss.navWrap, { bottom: Math.max(insets.bottom, 10) }]} pointerEvents="box-none">
      <View style={[ss.capsule, manga && ss.capsuleManga]}>
        {TABS.map((tab, i) => {
          const active = state.index === i;
          const tint = manga ? (active ? M.white : M.muted) : active ? C.accent : C.textMuted;
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
              style={ss.navItem}
            >
              <View style={[ss.iconPill, active && (manga ? ss.iconPillManga : ss.iconPillActive)]}>
                <Ionicons name={active ? tab.icon : (`${tab.icon}-outline` as any)} size={21} color={tint} />
              </View>
              <Text style={[ss.navLabel, { color: tint }, active && ss.navLabelActive, manga && { ...MT.caption, fontSize: 11, color: active ? M.ink : M.muted }]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
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
    borderRadius: 30,
    backgroundColor: C.surface,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
    ...ELEVATION_NAV,
  },
  capsuleManga: { backgroundColor: M.paper, borderColor: M.line, borderRadius: 8 },
  navItem: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 56 },
  // Material-style indicator: a pill behind the active icon, label below.
  iconPill: { width: 56, height: 32, borderRadius: 16, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  iconPillActive: { backgroundColor: C.accentSoft },
  iconPillManga: { backgroundColor: M.ink, borderRadius: 4 },
  navLabel: { fontSize: 11, lineHeight: 16, marginTop: 2, fontFamily: AR.semibold },
  navLabelActive: { fontFamily: AR.bold },
});

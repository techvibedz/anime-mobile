import { Tabs } from "expo-router";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C, R, AR } from "../../lib/theme";
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
   // Keep the labeled navigation above both gesture and three-button system bars.
  return (
    <View style={[ss.navWrap, manga && { backgroundColor: M.paper, borderTopColor: M.line }, { paddingBottom: Math.max(insets.bottom, 10) }]} pointerEvents="box-none">
      <View style={ss.navPill}>
        <View style={ss.navInner}>
          {TABS.map((tab, i) => {
            const active = state.index === i;
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
                style={[ss.navItem, active && ss.navItemActive, manga && { borderRadius: 4 }, manga && active && { backgroundColor: M.ink }]}
              >
                <Ionicons
                  name={active ? tab.icon : (`${tab.icon}-outline` as any)}
                  size={22}
                  color={manga ? (active ? M.white : M.muted) : active ? C.ember : C.textMuted}
                />
                <Text style={[ss.navLabel, active && { color: C.accent }, manga && { ...MT.caption, fontSize: 11, color: active ? M.white : M.muted }]}>{tab.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const ss = StyleSheet.create({
  navWrap: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 100,
    backgroundColor: C.bg,
    borderTopWidth: 1,
    borderTopColor: C.borderSoft,
  },
  navPill: {
    width: "100%",
    maxWidth: 600,
  },
  navInner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  navItem: {
    flex: 1,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 56,
    paddingVertical: 6,
    borderRadius: R.md,
  },
   // Selection gets a tonal panel; every destination keeps its label visible.
  navItemActive: {
    backgroundColor: C.accentSoft,
  },
  navLabel: {
    fontSize: 11,
    color: C.textMuted,
    marginTop: 3,
    fontFamily: AR.semibold,
  },
});

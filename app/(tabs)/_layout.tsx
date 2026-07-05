import { Tabs } from "expo-router";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { GlassFill } from "../../components/GlassFill";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C, R, AR, ELEVATION_NAV } from "../../lib/theme";

const TABS = [
  { name: "index", icon: "home" as const, label: "الرئيسية" },
  { name: "search", icon: "search" as const, label: "اكتشف" },
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
        <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.label }} />
      ))}
    </Tabs>
  );
}

function FloatingNav({ state, navigation }: any) {
  const insets = useSafeAreaInsets();
  // Lift the pill above the phone's on-screen system navigation bar (gesture
  // pill / 3-button) so it isn't overlapped/hidden by it. Falls back to the
  // fixed 16px gap on devices with no inset.
  return (
    <View style={[ss.navWrap, { bottom: 16 + insets.bottom }]} pointerEvents="box-none">
      <View style={ss.navPill}>
        <GlassFill intensity={30} androidColor="rgba(10,10,11,0.94)" />
        <View style={ss.navInner}>
          {TABS.map((tab, i) => {
            const active = state.index === i;
            return (
              <Pressable
                key={tab.name}
                onPress={() => navigation.navigate(state.routes[i].name)}
                style={[ss.navItem, active && ss.navItemActive]}
              >
                <Ionicons
                  name={active ? tab.icon : (`${tab.icon}-outline` as any)}
                  size={19}
                  color={active ? C.ember : C.textMuted}
                />
                {active && <Text style={ss.navLabel}>{tab.label}</Text>}
                {active && <View style={ss.navSpark} />}
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
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 100,
  },
  navPill: {
    borderRadius: R.pill,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: C.line,
    ...ELEVATION_NAV,
  },
  navInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  navItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: R.pill,
  },
  // Active: a quiet ink-high chip carries the label; the EMBER is the icon, the
  // label tint, and a small spark dot — not a filled accent blob.
  navItemActive: {
    backgroundColor: C.inkHigh,
    paddingHorizontal: 17,
  },
  navLabel: {
    fontSize: 11,
    color: C.ember,
    fontFamily: AR.semibold,
  },
  navSpark: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.ember,
  },
});

import { Tabs } from "expo-router";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import { C, R, ELEVATION_NAV } from "../../lib/theme";

const TABS = [
  { name: "index", icon: "home" as const, label: "الرئيسية" },
  { name: "search", icon: "search" as const, label: "اكتشف" },
  { name: "mylist", icon: "heart" as const, label: "قائمتي" },
];

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false, tabBarStyle: { display: "none" } }}
      tabBar={(props) => <FloatingNav {...props} />}
    >
      {TABS.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.label }} />
      ))}
    </Tabs>
  );
}

function FloatingNav({ state, navigation }: any) {
  return (
    <View style={ss.navWrap} pointerEvents="box-none">
      <View style={ss.navPill}>
        <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill}>
          <View style={[StyleSheet.absoluteFill, { backgroundColor: C.surfaceGlass }]} />
        </BlurView>
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
                  size={20}
                  color={active ? C.accent : C.textMuted}
                />
                {active && <Text style={ss.navLabel}>{tab.label}</Text>}
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
    bottom: 16,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 100,
  },
  navPill: {
    borderRadius: R.pill,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: C.glassBorder,
    ...ELEVATION_NAV,
  },
  navInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  navItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: R.pill,
  },
  navItemActive: {
    backgroundColor: C.accentSoft,
    paddingHorizontal: 18,
  },
  navLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: C.accent,
    fontFamily: "DMSans_600SemiBold",
  },
});

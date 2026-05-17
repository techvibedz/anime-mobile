import { View, Text, Pressable, StyleSheet, Dimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { C, R, S, ELEVATION_GLOW } from "../../lib/theme";

const { width: SW, height: SH } = Dimensions.get("window");

export default function Welcome() {
  const insets = useSafeAreaInsets();

  return (
    <View style={ss.root}>
      {/* Ambient gradient backdrop */}
      <LinearGradient
        colors={[C.accent + "33", "transparent", C.violet + "22"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={ss.glowOrb1} />
      <View style={ss.glowOrb2} />

      <View style={[ss.content, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}>
        {/* Logo mark */}
        <View style={ss.brand}>
          <LinearGradient
            colors={[C.accent, C.violet]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={ss.logoMark}
          >
            <Ionicons name="play" size={36} color="#fff" />
          </LinearGradient>
          <Text style={ss.appName}>Pantoufa</Text>
          <Text style={ss.tagline}>Your anime, anywhere.</Text>
        </View>

        {/* Feature highlights */}
        <View style={ss.features}>
          {[
            { icon: "cloud-done-outline" as const, text: "Sync watchlist across devices" },
            { icon: "heart-outline" as const, text: "Save favorites & continue watching" },
            { icon: "shield-checkmark-outline" as const, text: "Secure sign-in with Google" },
          ].map((f, i) => (
            <View key={i} style={ss.featureRow}>
              <View style={ss.featureIcon}>
                <Ionicons name={f.icon} size={16} color={C.accent} />
              </View>
              <Text style={ss.featureText}>{f.text}</Text>
            </View>
          ))}
        </View>

        {/* CTA buttons */}
        <View style={ss.cta}>
          <Pressable
            style={({ pressed }) => [ss.btnPrimary, pressed && { opacity: 0.88 }]}
            onPress={() => router.push("/(auth)/register")}
          >
            <Text style={ss.btnPrimaryText}>Create account</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [ss.btnGhost, pressed && { opacity: 0.7 }]}
            onPress={() => router.push("/(auth)/login")}
          >
            <Text style={ss.btnGhostText}>I already have an account</Text>
          </Pressable>
          {/* TEMP: PoC entry — remove after validation */}
          <Pressable
            style={({ pressed }) => [{ paddingVertical: 8, alignItems: "center" }, pressed && { opacity: 0.6 }]}
            onPress={() => router.push("/scraper-debug")}
          >
            <Text style={{ color: C.textMuted, fontSize: 11, fontFamily: "DMSans_500Medium" }}>
              · Scraper PoC ·
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const ss = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  glowOrb1: {
    position: "absolute", width: 320, height: 320, borderRadius: 160,
    backgroundColor: C.accent + "22", top: -80, right: -80,
  },
  glowOrb2: {
    position: "absolute", width: 280, height: 280, borderRadius: 140,
    backgroundColor: C.violet + "22", bottom: 100, left: -80,
  },
  content: { flex: 1, paddingHorizontal: S.paddingContent, justifyContent: "space-between" },
  brand: { alignItems: "center", marginTop: 40, gap: 16 },
  logoMark: {
    width: 88, height: 88, borderRadius: 24,
    alignItems: "center", justifyContent: "center",
    ...ELEVATION_GLOW,
  },
  appName: {
    color: C.text, fontSize: 38, fontWeight: "800",
    letterSpacing: -0.8, fontFamily: "Outfit_800ExtraBold",
  },
  tagline: {
    color: C.textSecondary, fontSize: 14,
    fontFamily: "DMSans_500Medium",
  },

  features: { gap: 16, marginVertical: 24 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  featureIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: C.accentSoft, alignItems: "center", justifyContent: "center",
  },
  featureText: {
    color: C.textSecondary, fontSize: 13, flex: 1,
    fontFamily: "DMSans_500Medium",
  },

  cta: { gap: 12 },
  btnPrimary: {
    backgroundColor: C.accent, borderRadius: R.pill,
    paddingVertical: 16, alignItems: "center",
    ...ELEVATION_GLOW,
  },
  btnPrimaryText: {
    color: C.textOnAccent, fontSize: 15, fontWeight: "700",
    fontFamily: "DMSans_600SemiBold",
  },
  btnGhost: { paddingVertical: 14, alignItems: "center" },
  btnGhostText: {
    color: C.textSecondary, fontSize: 14, fontWeight: "600",
    fontFamily: "DMSans_600SemiBold",
  },
});

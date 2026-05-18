import { View, Text, Pressable, StyleSheet, Dimensions, I18nManager } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { C, R, S, ELEVATION_GLOW } from "../../lib/theme";
import { t } from "../../lib/i18n";

const { width: SW, height: SH } = Dimensions.get("window");

export default function Welcome() {
  const insets = useSafeAreaInsets();

  return (
    <View style={ss.root}>
      {/* Layered ambient backdrop */}
      <LinearGradient
        colors={["#1a0a2e", C.bg, "#0a0a1f"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={[C.accent + "44", "transparent", C.violet + "33"]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={[StyleSheet.absoluteFill, { opacity: 0.9 }]}
      />
      <View style={ss.glowOrb1} />
      <View style={ss.glowOrb2} />
      <View style={ss.glowOrb3} />

      {/* Soft starfield dots */}
      {Array.from({ length: 18 }).map((_, i) => {
        const x = (i * 137) % SW;
        const y = ((i * 251) % SH) - 40;
        const size = (i % 3) + 2;
        return (
          <View
            key={i}
            style={{
              position: "absolute", left: x, top: y, width: size, height: size,
              borderRadius: size / 2, backgroundColor: "#fff", opacity: 0.18,
            }}
          />
        );
      })}

      <View style={[ss.content, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 18 }]}>
        {/* Logo mark */}
        <View style={ss.brand}>
          <View style={ss.markRing}>
            <LinearGradient
              colors={[C.accent, C.violet, "#5B6BFF"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={ss.logoMark}
            >
              <Ionicons name="play" size={40} color="#fff" style={{ marginLeft: 4 }} />
            </LinearGradient>
          </View>
          <Text style={ss.appName}>{t.appName}</Text>
          <Text style={ss.tagline}>{t.welcomeTagline}</Text>
        </View>

        {/* Feature highlights with gradient icon tiles */}
        <View style={ss.features}>
          {[
            { icon: "cloud-done" as const, text: t.feature1, colors: [C.accent, "#FF6B3D"] as [string, string] },
            { icon: "heart" as const, text: t.feature2, colors: ["#FF6B9D", C.violet] as [string, string] },
            { icon: "shield-checkmark" as const, text: t.feature3, colors: ["#00C6FF", C.violet] as [string, string] },
          ].map((f, i) => (
            <View key={i} style={ss.featureRow}>
              <LinearGradient
                colors={f.colors}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={ss.featureIcon}
              >
                <Ionicons name={f.icon} size={16} color="#fff" />
              </LinearGradient>
              <Text style={ss.featureText}>{f.text}</Text>
            </View>
          ))}
        </View>

        {/* CTA stack */}
        <View style={ss.cta}>
          <Pressable
            style={({ pressed }) => [ss.btnPrimaryWrap, pressed && { transform: [{ scale: 0.98 }], opacity: 0.92 }]}
            onPress={() => router.push("/(auth)/register")}
          >
            <LinearGradient
              colors={[C.accent, "#FF457A", C.violet]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={ss.btnPrimary}
            >
              <Ionicons name="sparkles" size={16} color="#fff" />
              <Text style={ss.btnPrimaryText}>{t.ctaCreate}</Text>
            </LinearGradient>
          </Pressable>

          <Pressable
            style={({ pressed }) => [ss.btnSecondary, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}
            onPress={() => router.push("/(auth)/login")}
          >
            <Ionicons name="log-in-outline" size={16} color={C.text} />
            <Text style={ss.btnSecondaryText}>{t.ctaHaveAccount}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const ss = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  glowOrb1: {
    position: "absolute", width: 360, height: 360, borderRadius: 180,
    backgroundColor: C.accent + "33", top: -90, right: -90,
  },
  glowOrb2: {
    position: "absolute", width: 320, height: 320, borderRadius: 160,
    backgroundColor: C.violet + "33", bottom: 80, left: -100,
  },
  glowOrb3: {
    position: "absolute", width: 220, height: 220, borderRadius: 110,
    backgroundColor: "#5B6BFF" + "22", top: SH * 0.3, right: -60,
  },
  content: { flex: 1, paddingHorizontal: S.paddingContent, justifyContent: "space-between" },

  brand: { alignItems: "center", marginTop: 32, gap: 14 },
  markRing: {
    width: 124, height: 124, borderRadius: 36,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
  },
  logoMark: {
    width: 96, height: 96, borderRadius: 28,
    alignItems: "center", justifyContent: "center",
    ...ELEVATION_GLOW,
  },
  appName: {
    color: C.text, fontSize: 44, fontWeight: "800",
    letterSpacing: -0.8, fontFamily: "Outfit_800ExtraBold",
    textShadowColor: C.accent + "55",
    textShadowRadius: 14,
  },
  tagline: {
    color: C.textSecondary, fontSize: 15,
    fontFamily: "DMSans_500Medium",
    writingDirection: "rtl",
  },

  features: { gap: 18, marginVertical: 24, paddingHorizontal: 4 },
  featureRow: { flexDirection: I18nManager.isRTL ? "row" : "row-reverse", alignItems: "center", gap: 14 },
  featureIcon: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
    ...ELEVATION_GLOW,
  },
  featureText: {
    color: C.text, fontSize: 14, flex: 1, lineHeight: 20,
    fontFamily: "DMSans_500Medium", textAlign: "right",
    writingDirection: "rtl",
  },

  cta: { gap: 12 },
  btnPrimaryWrap: { borderRadius: R.pill, ...ELEVATION_GLOW },
  btnPrimary: {
    flexDirection: I18nManager.isRTL ? "row" : "row-reverse",
    alignItems: "center", justifyContent: "center", gap: 8,
    borderRadius: R.pill, paddingVertical: 17,
  },
  btnPrimaryText: {
    color: "#fff", fontSize: 16, fontWeight: "800",
    fontFamily: "Outfit_700Bold", letterSpacing: 0.2,
  },
  btnSecondary: {
    flexDirection: I18nManager.isRTL ? "row" : "row-reverse",
    alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 15, borderRadius: R.pill,
    backgroundColor: C.surfaceGlass,
    borderWidth: 1, borderColor: C.glassBorder,
  },
  btnSecondaryText: {
    color: C.text, fontSize: 14, fontWeight: "700",
    fontFamily: "Outfit_600SemiBold",
  },
});

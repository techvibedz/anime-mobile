import { View, Text, Pressable, StyleSheet, I18nManager } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { C, R, S } from "../../lib/theme";
import { t } from "../../lib/i18n";
import { Aurora } from "../../components/ScreenChrome";

export default function Welcome() {
  const insets = useSafeAreaInsets();

  return (
    <View style={ss.root}>
      {/* Shared HOLO Aurora backdrop — unifies the whole auth flow. Restrained
          two-hue wash, no orbs / blobs. */}
      <Aurora />

      <View style={[ss.content, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 18 }]}>
        {/* Brand — solid ember mark, bone wordmark, no glow */}
        <View style={ss.brand}>
          <View style={ss.logoMark}>
            <Ionicons name="play" size={38} color={C.bone} style={{ marginLeft: 4 }} />
          </View>
          <View style={ss.wordmarkRow}>
            <View style={ss.spark} />
            <Text style={ss.appName}>{t.appName}</Text>
          </View>
          <Text style={ss.tagline}>{t.welcomeTagline}</Text>
        </View>

        {/* Feature list — ember icon on a hairline tile, editorial rows */}
        <View style={ss.features}>
          {[
            { icon: "cloud-done-outline" as const, text: t.feature1 },
            { icon: "heart-outline" as const, text: t.feature2 },
            { icon: "shield-checkmark-outline" as const, text: t.feature3 },
          ].map((f, i) => (
            <View key={i} style={ss.featureRow}>
              <View style={ss.featureIcon}>
                <Ionicons name={f.icon} size={17} color={C.ember} />
              </View>
              <Text style={ss.featureText}>{f.text}</Text>
            </View>
          ))}
        </View>

        {/* CTA — solid ember primary, outline ghost secondary */}
        <View style={ss.cta}>
          <Pressable
            style={({ pressed }) => [ss.btnPrimary, pressed && { transform: [{ scale: 0.98 }], opacity: 0.92 }]}
            onPress={() => router.push("/(auth)/register")}
          >
            <Ionicons name="sparkles" size={16} color={C.bone} />
            <Text style={ss.btnPrimaryText}>{t.ctaCreate}</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [ss.btnSecondary, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}
            onPress={() => router.push("/(auth)/login")}
          >
            <Ionicons name="log-in-outline" size={16} color={C.bone} />
            <Text style={ss.btnSecondaryText}>{t.ctaHaveAccount}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const ss = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: { flex: 1, paddingHorizontal: S.paddingContent, justifyContent: "space-between" },

  brand: { alignItems: "center", marginTop: 40, gap: 18 },
  logoMark: {
    width: 92, height: 92, borderRadius: 26,
    alignItems: "center", justifyContent: "center",
    backgroundColor: C.ember,
  },
  wordmarkRow: { flexDirection: "row", alignItems: "center", gap: 9, marginTop: 4 },
  spark: { width: 8, height: 8, borderRadius: 2, backgroundColor: C.ember },
  appName: {
    color: C.bone, fontSize: 42, fontWeight: "900",
    letterSpacing: -1.0, fontFamily: "Cairo_700Bold",
  },
  tagline: {
    color: C.textSecondary, fontSize: 15,
    fontFamily: "Cairo_500Medium",
    writingDirection: "rtl", textAlign: "center",
  },

  features: { gap: 16, marginVertical: 24, paddingHorizontal: 4 },
  featureRow: { flexDirection: I18nManager.isRTL ? "row" : "row-reverse", alignItems: "center", gap: 14 },
  featureIcon: {
    width: 42, height: 42, borderRadius: R.md,
    alignItems: "center", justifyContent: "center",
    backgroundColor: C.inkHigh, borderWidth: 1, borderColor: C.line,
  },
  featureText: {
    color: C.textSoft, fontSize: 14, flex: 1, lineHeight: 20,
    fontFamily: "Cairo_500Medium", textAlign: "right",
    writingDirection: "rtl",
  },

  cta: { gap: 12 },
  btnPrimary: {
    flexDirection: I18nManager.isRTL ? "row" : "row-reverse",
    alignItems: "center", justifyContent: "center", gap: 8,
    borderRadius: R.pill, paddingVertical: 17,
    backgroundColor: C.ember,
  },
  btnPrimaryText: {
    color: C.bone, fontSize: 16, fontWeight: "800",
    fontFamily: "Cairo_700Bold", letterSpacing: 0.2,
  },
  btnSecondary: {
    flexDirection: I18nManager.isRTL ? "row" : "row-reverse",
    alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 15, borderRadius: R.pill,
    backgroundColor: "transparent",
    borderWidth: 1, borderColor: C.borderLight,
  },
  btnSecondaryText: {
    color: C.bone, fontSize: 14, fontWeight: "700",
    fontFamily: "Cairo_600SemiBold",
  },
});

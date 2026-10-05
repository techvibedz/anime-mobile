import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
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

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[ss.content, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 24 }]}>
        {/* Brand — solid ember mark, bone wordmark, no glow */}
        <View style={ss.brand}>
          <View style={ss.logoMark}>
            <Ionicons name="play" size={32} color={C.textOnAccent} style={{ marginLeft: 4 }} />
          </View>
          <View style={ss.wordmarkRow}>
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
              <Ionicons name="checkmark" size={17} color={C.mint} />
            </View>
          ))}
        </View>

        {/* CTA — solid ember primary, outline ghost secondary */}
        <View style={ss.cta}>
          <Pressable
            style={({ pressed }) => [ss.btnPrimary, pressed && { transform: [{ scale: 0.98 }], opacity: 0.92 }]}
            onPress={() => router.push("/(auth)/register")}
            accessibilityRole="button"
          >
            <Text style={ss.btnPrimaryText}>{t.ctaCreate}</Text>
            <Ionicons name="arrow-back" size={20} color={C.bone} />
          </Pressable>

          <Pressable
            style={({ pressed }) => [ss.btnSecondary, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}
            onPress={() => router.push("/(auth)/login")}
            accessibilityRole="button"
          >
            <Ionicons name="log-in-outline" size={16} color={C.bone} />
            <Text style={ss.btnSecondaryText}>{t.ctaHaveAccount}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const ss = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: { flexGrow: 1, paddingHorizontal: 28, justifyContent: "space-between" },

  brand: { alignItems: "flex-end", marginTop: 40, marginBottom: 36 },
  logoMark: {
    width: 72, height: 72, borderRadius: 20, marginBottom: 28,
    alignItems: "center", justifyContent: "center",
    backgroundColor: C.ember,
  },
  wordmarkRow: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  spark: { width: 8, height: 8, borderRadius: 2, backgroundColor: C.ember },
  appName: {
    color: C.bone, fontSize: 32, lineHeight: 48, fontWeight: "700",
    fontFamily: "Cairo_700Bold",
  },
  tagline: {
    color: C.textSecondary, fontSize: 15, lineHeight: 26, marginTop: 8,
    fontFamily: "Cairo_500Medium",
    writingDirection: "rtl", textAlign: "right",
  },

  features: { marginBottom: 40 },
  featureRow: { flexDirection: "row", alignItems: "center", paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: C.borderSoft },
  featureIcon: {
    width: 44, height: 44, borderRadius: R.md, marginRight: 16,
    alignItems: "center", justifyContent: "center",
    backgroundColor: C.surface,
  },
  featureText: {
    color: C.textSoft, fontSize: 14, flex: 1, lineHeight: 24, marginRight: 16,
    fontFamily: "Cairo_500Medium", textAlign: "right",
    writingDirection: "rtl",
  },

  cta: { gap: 12 },
  btnPrimary: {
    flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: 8,
    minHeight: 56, borderRadius: R.md, paddingVertical: 16,
    backgroundColor: C.ember,
  },
  btnPrimaryText: {
    color: C.bone, fontSize: 14, lineHeight: 24, fontWeight: "700",
    fontFamily: "Cairo_700Bold", letterSpacing: 0.2,
  },
  btnSecondary: {
    flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: 8,
    minHeight: 56, paddingVertical: 15, borderRadius: R.md,
    backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.borderLight,
  },
  btnSecondaryText: {
    color: C.bone, fontSize: 14, fontWeight: "700",
    fontFamily: "Cairo_600SemiBold",
  },
});

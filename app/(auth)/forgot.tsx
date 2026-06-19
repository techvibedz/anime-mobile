import { useState } from "react";
import { View, Text, Pressable, TextInput, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, I18nManager } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useAuth } from "../../lib/auth";
import { C, R, S, ELEVATION_GLOW } from "../../lib/theme";
import { t } from "../../lib/i18n";

export default function ForgotPassword() {
  const insets = useSafeAreaInsets();
  const { sendPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleReset() {
    setError(null);
    if (!email.trim()) { setError(t.emailPasswordRequired); return; }
    setLoading(true);
    const { error: err } = await sendPasswordReset(email);
    setLoading(false);
    if (err) setError(err); else setSent(true);
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={ss.root}>
      <ScrollView
        contentContainerStyle={[ss.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={ss.header}>
          <Pressable onPress={() => router.back()} style={ss.backBtn} hitSlop={8}>
            <Ionicons name={I18nManager.isRTL ? "chevron-forward" : "chevron-back"} size={22} color={C.text} />
          </Pressable>
        </View>

        <View style={ss.body}>
          <Text style={ss.heading}>{t.forgotTitle}</Text>
          <Text style={ss.sub}>{t.forgotSub}</Text>

          <View style={ss.inputGroup}>
            <Text style={ss.label}>{t.email}</Text>
            <View style={ss.inputBox}>
              <Ionicons name="mail-outline" size={16} color={C.textMuted} />
              <TextInput
                style={ss.input}
                value={email}
                onChangeText={setEmail}
                placeholder={t.emailPlaceholder}
                placeholderTextColor={C.textMuted}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                editable={!sent}
                textAlign="right"
              />
            </View>
          </View>

          {error && (
            <View style={ss.errorBox}>
              <Ionicons name="alert-circle" size={14} color={C.accent} />
              <Text style={ss.errorText}>{error}</Text>
            </View>
          )}

          {sent && (
            <View style={ss.successBox}>
              <Ionicons name="checkmark-circle" size={14} color={C.success} />
              <Text style={ss.successText}>{t.resetSent}</Text>
            </View>
          )}

          <Pressable
            style={({ pressed }) => [ss.submitWrap, pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] }, !email && !sent && { opacity: 0.5 }]}
            onPress={sent ? () => router.replace("/(auth)/login") : handleReset}
            disabled={!sent && (loading || !email)}
          >
            <LinearGradient
              colors={[C.accent, "#FF457A", C.violet]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={ss.submitBtn}
            >
              {loading ? <ActivityIndicator color="#fff" /> : (
                <Text style={ss.submitText}>{sent ? t.goToSignIn : t.sendResetLink}</Text>
              )}
            </LinearGradient>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const ss = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { flexGrow: 1, paddingHorizontal: S.paddingContent },
  header: { flexDirection: "row", marginBottom: 24 },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    alignItems: "center", justifyContent: "center",
  },
  body: { flex: 1, paddingTop: 8 },
  heading: { color: C.text, fontSize: 28, fontWeight: "800", letterSpacing: -0.5, fontFamily: "Cairo_700Bold", textAlign: "right", writingDirection: "rtl" },
  sub: { color: C.textSecondary, fontSize: 13, marginTop: 8, marginBottom: 28, fontFamily: "Cairo_500Medium", lineHeight: 18, textAlign: "right", writingDirection: "rtl" },

  inputGroup: { marginBottom: 16 },
  label: { color: C.textSecondary, fontSize: 12, fontWeight: "600", marginBottom: 6, fontFamily: "Cairo_600SemiBold", textAlign: "right", writingDirection: "rtl" },
  inputBox: {
    flexDirection: I18nManager.isRTL ? "row" : "row-reverse",
    alignItems: "center", gap: 10,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    borderRadius: R.lg, paddingHorizontal: 14, height: S.inputHeight,
  },
  input: { flex: 1, color: C.text, fontSize: 14, height: S.inputHeight, fontFamily: "Cairo_500Medium" },

  errorBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: C.accentSoft, borderRadius: R.lg, padding: 12, marginTop: 8,
    borderWidth: 1, borderColor: C.borderAccent,
  },
  errorText: { color: C.accent, fontSize: 12, flex: 1, fontFamily: "Cairo_500Medium" },
  successBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: C.success + "1A", borderRadius: R.lg, padding: 12, marginTop: 8,
    borderWidth: 1, borderColor: C.success + "33",
  },
  successText: { color: C.success, fontSize: 12, flex: 1, fontFamily: "Cairo_500Medium" },

  submitWrap: { borderRadius: R.pill, marginTop: 24, ...ELEVATION_GLOW },
  submitBtn: {
    borderRadius: R.pill, paddingVertical: 16,
    alignItems: "center", justifyContent: "center",
  },
  submitText: { color: "#fff", fontSize: 16, fontWeight: "800", fontFamily: "Cairo_700Bold" },
});

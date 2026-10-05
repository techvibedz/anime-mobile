import { useState } from "react";
import { View, Text, Pressable, TextInput, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, I18nManager } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useAuth } from "../../lib/auth";
import { C, R, S, ELEVATION_GLOW } from "../../lib/theme";
import { t } from "../../lib/i18n";
import { Aurora } from "../../components/ScreenChrome";

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
      <Aurora />
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
              colors={[C.accent, C.accent]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={ss.submitBtn}
            >
              {loading ? <ActivityIndicator color={C.textOnAccent} /> : (
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
  scroll: { flexGrow: 1, paddingHorizontal: 28 },
  header: { flexDirection: "row", marginBottom: 40 },
  backBtn: {
    width: 48, height: 48, borderRadius: R.md,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.borderSoft,
    alignItems: "center", justifyContent: "center",
  },
  body: { flex: 1, paddingTop: 8 },
  heading: { color: C.text, fontSize: 26, lineHeight: 40, fontWeight: "700", fontFamily: "Cairo_700Bold", textAlign: "right", writingDirection: "rtl" },
  sub: { color: C.textSecondary, fontSize: 14, marginTop: 8, marginBottom: 32, fontFamily: "Cairo_500Medium", lineHeight: 24, textAlign: "right", writingDirection: "rtl" },

  inputGroup: { marginBottom: 16 },
  label: { color: C.textSecondary, fontSize: 12, fontWeight: "600", marginBottom: 6, fontFamily: "Cairo_600SemiBold", textAlign: "right", writingDirection: "rtl" },
  inputBox: {
    flexDirection: "row",
    alignItems: "center", gap: 10,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    borderRadius: R.md, paddingHorizontal: 14, height: S.inputHeight,
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

  submitWrap: { borderRadius: R.md, marginTop: 24, overflow: "hidden" },
  submitBtn: {
    minHeight: 56, borderRadius: R.md, paddingVertical: 16,
    alignItems: "center", justifyContent: "center",
  },
  submitText: { flexShrink: 1, textAlign: "center", color: C.textOnAccent, fontSize: 14, lineHeight: 24, fontWeight: "700", fontFamily: "Cairo_700Bold" },
});

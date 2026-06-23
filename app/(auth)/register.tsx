import { useState } from "react";
import { View, Text, Pressable, TextInput, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, I18nManager } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useAuth } from "../../lib/auth";
import { C, R, S, ELEVATION_GLOW } from "../../lib/theme";
import { t } from "../../lib/i18n";

export default function Register() {
  const insets = useSafeAreaInsets();
  const { signUpWithEmail, signInWithGoogle, isConfigured } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);

  async function handleSignUp() {
    setError(null);
    if (!email.trim() || !password) { setError(t.emailPasswordRequired); return; }
    if (password.length < 6) { setError(t.passwordTooShort); return; }
    if (password !== confirm) { setError(t.passwordsDontMatch); return; }
    setLoading(true);
    const res = await signUpWithEmail(email, password);
    setLoading(false);
    if (res.error) { setError(res.error); return; }
    if (res.needsConfirmation) setNeedsConfirmation(true);
  }

  async function handleGoogle() {
    setError(null);
    setGoogleLoading(true);
    const { error: err } = await signInWithGoogle();
    setGoogleLoading(false);
    if (err) setError(err);
  }

  if (needsConfirmation) {
    return (
      <View style={[ss.root, { paddingTop: insets.top + 40, paddingHorizontal: S.paddingContent }]}>
        <View style={ss.orb1} />
        <LinearGradient
          colors={[C.violet, C.accent]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={ss.confirmCircle}
        >
          <Ionicons name="mail-unread" size={40} color="#fff" />
        </LinearGradient>
        <Text style={ss.confirmTitle}>{t.checkInbox}</Text>
        <Text style={ss.confirmText}>{t.confirmEmailSent(email)}</Text>
        <Pressable
          style={({ pressed }) => [ss.submitWrap, pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] }]}
          onPress={() => router.replace("/(auth)/login")}
        >
          <LinearGradient
            colors={[C.ember, C.emberDeep]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={ss.submitBtn}
          >
            <Text style={ss.submitText}>{t.goToSignIn}</Text>
          </LinearGradient>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={ss.root}>
      <LinearGradient
        colors={[C.violet + "33", "transparent"]}
        style={[StyleSheet.absoluteFill, { height: 380 }]}
      />
      <View style={ss.orb1} />
      <View style={ss.orb2} />

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
          <Text style={ss.heading}>{t.createAccount}</Text>
          <Text style={ss.sub}>{t.signupSub}</Text>

          {!isConfigured && (
            <View style={ss.warnBanner}>
              <Ionicons name="warning" size={14} color={C.gold} />
              <Text style={ss.warnText}>{t.authNotConfigured}</Text>
            </View>
          )}

          <Pressable
            style={({ pressed }) => [ss.googleWrap, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}
            onPress={handleGoogle}
            disabled={googleLoading || !isConfigured}
          >
            <LinearGradient
              colors={["#fff", "#f1f1f5"]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={ss.googleBtn}
            >
              {googleLoading ? <ActivityIndicator color="#111" /> : (
                <>
                  <Ionicons name="logo-google" size={18} color="#111" />
                  <Text style={ss.googleBtnText}>{t.signUpWithGoogle}</Text>
                </>
              )}
            </LinearGradient>
          </Pressable>

          <View style={ss.divider}>
            <View style={ss.dividerLine} />
            <Text style={ss.dividerText}>{t.or}</Text>
            <View style={ss.dividerLine} />
          </View>

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
                textAlign="right"
              />
            </View>
          </View>

          <View style={ss.inputGroup}>
            <Text style={ss.label}>{t.password}</Text>
            <View style={ss.inputBox}>
              <Ionicons name="lock-closed-outline" size={16} color={C.textMuted} />
              <TextInput
                style={ss.input}
                value={password}
                onChangeText={setPassword}
                placeholder={t.passwordMin6}
                placeholderTextColor={C.textMuted}
                secureTextEntry={!showPwd}
                autoComplete="password-new"
                textAlign="right"
              />
              <Pressable onPress={() => setShowPwd((v) => !v)} hitSlop={8}>
                <Ionicons name={showPwd ? "eye-off-outline" : "eye-outline"} size={16} color={C.textMuted} />
              </Pressable>
            </View>
          </View>

          <View style={ss.inputGroup}>
            <Text style={ss.label}>{t.confirmPassword}</Text>
            <View style={ss.inputBox}>
              <Ionicons name="lock-closed-outline" size={16} color={C.textMuted} />
              <TextInput
                style={ss.input}
                value={confirm}
                onChangeText={setConfirm}
                placeholder={t.passwordPlaceholder}
                placeholderTextColor={C.textMuted}
                secureTextEntry={!showPwd}
                autoComplete="password-new"
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

          <Pressable
            style={({ pressed }) => [
              ss.submitWrap,
              pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
              (!email || !password || !confirm) && { opacity: 0.5 },
            ]}
            onPress={handleSignUp}
            disabled={loading || !email || !password || !confirm}
          >
            <LinearGradient
              colors={[C.ember, C.emberDeep]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={ss.submitBtn}
            >
              {loading ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Ionicons name="sparkles" size={16} color="#fff" />
                  <Text style={ss.submitText}>{t.createAccount}</Text>
                </>
              )}
            </LinearGradient>
          </Pressable>

          <View style={ss.footer}>
            <Pressable onPress={() => router.replace("/(auth)/login")}>
              <Text style={ss.footerLink}>{t.signIn}</Text>
            </Pressable>
            <Text style={ss.footerText}> {t.haveAccount} </Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const ss = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  orb1: { position: "absolute", width: 320, height: 320, borderRadius: 160, backgroundColor: C.violet + "22", top: -80, right: -100 },
  orb2: { position: "absolute", width: 280, height: 280, borderRadius: 140, backgroundColor: C.accent + "22", top: 240, left: -100 },
  scroll: { flexGrow: 1, paddingHorizontal: S.paddingContent },
  header: { flexDirection: "row", marginBottom: 24 },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    alignItems: "center", justifyContent: "center",
  },
  body: { flex: 1, paddingTop: 8 },
  heading: {
    color: C.text, fontSize: 32, fontWeight: "800", letterSpacing: -0.5,
    fontFamily: "Cairo_700Bold", textAlign: "right", writingDirection: "rtl",
  },
  sub: {
    color: C.textSecondary, fontSize: 14, marginTop: 8, marginBottom: 28,
    fontFamily: "Cairo_500Medium", lineHeight: 20, textAlign: "right", writingDirection: "rtl",
  },

  warnBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: C.goldSoft, borderRadius: R.lg, padding: 12,
    borderWidth: 1, borderColor: C.gold + "33", marginBottom: 16,
  },
  warnText: { color: C.gold, fontSize: 12, flex: 1, fontFamily: "Cairo_500Medium" },

  googleWrap: { borderRadius: R.pill, marginBottom: 20, ...ELEVATION_GLOW },
  googleBtn: {
    flexDirection: I18nManager.isRTL ? "row" : "row-reverse",
    alignItems: "center", justifyContent: "center", gap: 10,
    borderRadius: R.pill, paddingVertical: 15,
  },
  googleBtnText: { color: "#111", fontSize: 14, fontWeight: "700", fontFamily: "Cairo_600SemiBold" },

  divider: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: C.border },
  dividerText: { color: C.textMuted, fontSize: 11, fontFamily: "Cairo_500Medium" },

  inputGroup: { marginBottom: 16 },
  label: {
    color: C.textSecondary, fontSize: 12, fontWeight: "600", marginBottom: 6,
    fontFamily: "Cairo_600SemiBold", textAlign: "right", writingDirection: "rtl",
  },
  inputBox: {
    flexDirection: I18nManager.isRTL ? "row" : "row-reverse",
    alignItems: "center", gap: 10,
    backgroundColor: C.inkHigh, borderWidth: 1, borderColor: C.line,
    borderRadius: R.md, paddingHorizontal: 14, height: S.inputHeight,
  },
  input: { flex: 1, color: C.text, fontSize: 14, height: S.inputHeight, fontFamily: "Cairo_500Medium" },

  errorBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: C.accentSoft, borderRadius: R.lg, padding: 12, marginTop: 8,
    borderWidth: 1, borderColor: C.borderAccent,
  },
  errorText: { color: C.accent, fontSize: 12, flex: 1, fontFamily: "Cairo_500Medium", textAlign: "right" },

  submitWrap: { borderRadius: R.pill, marginTop: 16, ...ELEVATION_GLOW },
  submitBtn: {
    flexDirection: I18nManager.isRTL ? "row" : "row-reverse",
    alignItems: "center", justifyContent: "center", gap: 8,
    borderRadius: R.pill, paddingVertical: 16,
  },
  submitText: { color: "#fff", fontSize: 16, fontWeight: "800", fontFamily: "Cairo_700Bold" },

  footer: { flexDirection: "row", justifyContent: "center", marginTop: 24 },
  footerText: { color: C.textSecondary, fontSize: 13, fontFamily: "Cairo_500Medium" },
  footerLink: { color: C.accent, fontSize: 13, fontWeight: "700", fontFamily: "Cairo_600SemiBold" },

  // Confirmation state
  confirmCircle: {
    width: 96, height: 96, borderRadius: 48,
    alignItems: "center", justifyContent: "center", marginBottom: 24,
    ...ELEVATION_GLOW,
  },
  confirmTitle: {
    color: C.text, fontSize: 28, fontWeight: "800", marginBottom: 12,
    fontFamily: "Cairo_700Bold", textAlign: "right", writingDirection: "rtl",
  },
  confirmText: {
    color: C.textSecondary, fontSize: 14, lineHeight: 22, marginBottom: 32,
    fontFamily: "Cairo_500Medium", textAlign: "right", writingDirection: "rtl",
  },
});

import { useState } from "react";
import { View, Text, Pressable, TextInput, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, I18nManager } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useAuth } from "../../lib/auth";
import { C, R, S, ELEVATION_GLOW, ELEVATION_CARD } from "../../lib/theme";
import { t } from "../../lib/i18n";
import { Aurora } from "../../components/ScreenChrome";
import { authErrorKey, needsConfirmationHelp, type AuthErrorKey } from "../../lib/authErrors";
import { remoteLog } from "../../lib/remoteLog";

export default function Login() {
  const insets = useSafeAreaInsets();
  const { signInWithEmail, signInWithGoogle, resendConfirmation, sendSignInLink, isConfigured } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [helpLoading, setHelpLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Auth failures are shown through their translated reason, never as the raw
  // English GoTrue message.
  const [errorKey, setErrorKey] = useState<AuthErrorKey | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleLogin() {
    setError(null);
    setErrorKey(null);
    setNotice(null);
    if (!email.trim() || !password) { setError(t.emailPasswordRequired); return; }
    setLoading(true);
    const { error: err } = await signInWithEmail(email, password);
    setLoading(false);
    if (err) {
      setErrorKey(authErrorKey(err));
      // Keep the real reason in the admin log: this project requires email
      // confirmation, so most "I can't log in" reports are exactly that.
      void remoteLog("warn", "auth", "password sign-in rejected", { reason: err });
    }
  }

  // Confirmation-email paths. The project has mailer_autoconfirm OFF, so a
  // password sign-in is rejected until the address is confirmed — these two
  // actions let the user finish from inside the app instead of dead-ending.
  async function handleResend() {
    setError(null);
    setErrorKey(null);
    setNotice(null);
    if (!email.trim()) { setError(t.emailPasswordRequired); return; }
    setHelpLoading(true);
    const { error: err } = await resendConfirmation(email);
    setHelpLoading(false);
    if (err) setErrorKey(authErrorKey(err));
    else setNotice(t.resendConfirmationSent);
  }

  async function handleSignInLink() {
    setError(null);
    setErrorKey(null);
    setNotice(null);
    if (!email.trim()) { setError(t.emailPasswordRequired); return; }
    setHelpLoading(true);
    const { error: err } = await sendSignInLink(email);
    setHelpLoading(false);
    if (err) setErrorKey(authErrorKey(err));
    else setNotice(t.signInLinkSent);
  }

  async function handleGoogle() {
    setError(null);
    setErrorKey(null);
    setNotice(null);
    setGoogleLoading(true);
    const { error: err } = await signInWithGoogle();
    setGoogleLoading(false);
    if (err) setErrorKey(authErrorKey(err));
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
          <Text style={ss.heading}>{t.welcomeBack}</Text>
          <Text style={ss.sub}>{t.loginSub}</Text>

          <View style={ss.authCard}>
          {!isConfigured && (
            <View style={ss.warnBanner}>
              <Ionicons name="warning" size={14} color={C.gold} />
              <Text style={ss.warnText}>{t.authNotConfigured}</Text>
            </View>
          )}

          {/* Google — gradient pill */}
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
              {googleLoading ? (
                <ActivityIndicator color="#111" />
              ) : (
                <>
                  <Ionicons name="logo-google" size={18} color="#111" />
                  <Text style={ss.googleBtnText}>{t.continueWithGoogle}</Text>
                </>
              )}
            </LinearGradient>
          </Pressable>

          {/* Divider */}
          <View style={ss.divider}>
            <View style={ss.dividerLine} />
            <Text style={ss.dividerText}>{t.or}</Text>
            <View style={ss.dividerLine} />
          </View>

          {/* Email */}
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

          {/* Password */}
          <View style={ss.inputGroup}>
            <Text style={ss.label}>{t.password}</Text>
            <View style={ss.inputBox}>
              <Ionicons name="lock-closed-outline" size={16} color={C.textMuted} />
              <TextInput
                style={ss.input}
                value={password}
                onChangeText={setPassword}
                placeholder={t.passwordPlaceholder}
                placeholderTextColor={C.textMuted}
                secureTextEntry={!showPwd}
                autoComplete="password"
                textAlign="right"
              />
              <Pressable onPress={() => setShowPwd((v) => !v)} hitSlop={8}>
                <Ionicons name={showPwd ? "eye-off-outline" : "eye-outline"} size={16} color={C.textMuted} />
              </Pressable>
            </View>
          </View>

          <Pressable onPress={() => router.push("/(auth)/forgot")} style={ss.forgotBtn}>
            <Text style={ss.forgotText}>{t.forgotPassword}</Text>
          </Pressable>

          {error && (
            <View style={ss.errorBox}>
              <Ionicons name="alert-circle" size={14} color={C.accent} />
              <Text style={ss.errorText}>{error}</Text>
            </View>
          )}

          {errorKey && (
            <View style={ss.errorBox}>
              <Ionicons name="alert-circle" size={14} color={C.accent} />
              <Text style={ss.errorText}>{t.authErrors[errorKey]}</Text>
            </View>
          )}

          {errorKey && needsConfirmationHelp(errorKey) && (
            <View style={ss.helpBox}>
              <Text style={ss.helpText}>{t.confirmEmailHelp}</Text>
              <Pressable style={ss.helpBtn} onPress={handleResend} disabled={helpLoading}>
                <Ionicons name="mail-unread-outline" size={14} color={C.accent} />
                <Text style={ss.helpBtnText}>{t.resendConfirmation}</Text>
              </Pressable>
              <Pressable style={ss.helpBtn} onPress={handleSignInLink} disabled={helpLoading}>
                <Ionicons name="link-outline" size={14} color={C.accent} />
                <Text style={ss.helpBtnText}>{t.sendSignInLink}</Text>
              </Pressable>
            </View>
          )}

          {notice && (
            <View style={ss.noticeBox}>
              <Ionicons name="checkmark-circle" size={14} color={C.success} />
              <Text style={ss.noticeText}>{notice}</Text>
            </View>
          )}

          {/* Submit — gradient pill */}
          <Pressable
            style={({ pressed }) => [
              ss.submitWrap,
              pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] },
              (!email || !password) && { opacity: 0.5 },
            ]}
            onPress={handleLogin}
            disabled={loading || !email || !password}
          >
            <LinearGradient
              colors={[C.ember, C.emberDeep]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={ss.submitBtn}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="log-in-outline" size={16} color="#fff" />
                  <Text style={ss.submitText}>{t.signIn}</Text>
                </>
              )}
            </LinearGradient>
          </Pressable>
          </View>

          <View style={ss.footer}>
            <Pressable onPress={() => router.replace("/(auth)/register")}>
              <Text style={ss.footerLink}>{t.signUp}</Text>
            </Pressable>
            <Text style={ss.footerText}> {t.noAccount} </Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const ss = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { flexGrow: 1, paddingHorizontal: S.paddingContent },
  // The form floats as one cohesive glass card over the Aurora backdrop.
  authCard: {
    borderRadius: R.xxl, padding: 18, marginTop: 4,
    backgroundColor: C.surfaceCard, borderWidth: 1, borderColor: C.border,
    ...ELEVATION_CARD,
  },
  header: { flexDirection: "row", marginBottom: 24 },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    alignItems: "center", justifyContent: "center",
  },
  body: { flex: 1, paddingTop: 8 },
  heading: {
    color: C.text, fontSize: 32, fontWeight: "800", letterSpacing: -0.5,
    fontFamily: "Cairo_700Bold", textAlign: "right",
    writingDirection: "rtl",
  },
  sub: {
    color: C.textSecondary, fontSize: 14, marginTop: 8, marginBottom: 28,
    fontFamily: "Cairo_500Medium", lineHeight: 20, textAlign: "right",
    writingDirection: "rtl",
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
  input: {
    flex: 1, color: C.text, fontSize: 14, height: S.inputHeight,
    fontFamily: "Cairo_500Medium",
  },

  forgotBtn: { alignSelf: "flex-start", paddingVertical: 6 },
  forgotText: { color: C.accent, fontSize: 12, fontWeight: "600", fontFamily: "Cairo_600SemiBold" },

  errorBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: C.accentSoft, borderRadius: R.lg, padding: 12, marginTop: 8,
    borderWidth: 1, borderColor: C.borderAccent,
  },
  errorText: { color: C.accent, fontSize: 12, flex: 1, fontFamily: "Cairo_500Medium", textAlign: "right" },

  helpBox: {
    backgroundColor: C.inkHigh, borderRadius: R.lg, padding: 12, marginTop: 8,
    borderWidth: 1, borderColor: C.line, gap: 8,
  },
  helpText: {
    color: C.textSecondary, fontSize: 12, lineHeight: 18,
    fontFamily: "Cairo_500Medium", textAlign: "right", writingDirection: "rtl",
  },
  helpBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 10, borderRadius: R.md,
    borderWidth: 1, borderColor: C.borderAccent, backgroundColor: C.accentSoft,
  },
  helpBtnText: { color: C.accent, fontSize: 13, fontWeight: "700", fontFamily: "Cairo_600SemiBold" },

  noticeBox: {
    flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.successSoft,
    borderRadius: R.lg, padding: 12, marginTop: 8, borderWidth: 1, borderColor: C.line,
  },
  noticeText: { color: C.text, fontSize: 12, flex: 1, fontFamily: "Cairo_500Medium", textAlign: "right" },

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
});

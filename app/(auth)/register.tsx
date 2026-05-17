import { useState } from "react";
import { View, Text, Pressable, TextInput, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useAuth } from "../../lib/auth";
import { C, R, S, ELEVATION_GLOW } from "../../lib/theme";

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
    if (!email.trim() || !password) { setError("Email and password are required"); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters"); return; }
    if (password !== confirm) { setError("Passwords don't match"); return; }
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
        <View style={ss.confirmCircle}>
          <Ionicons name="mail-unread-outline" size={36} color={C.accent} />
        </View>
        <Text style={ss.confirmTitle}>Check your inbox</Text>
        <Text style={ss.confirmText}>
          We sent a verification link to <Text style={{ color: C.text, fontWeight: "700" }}>{email}</Text>.
          Tap it to activate your account.
        </Text>
        <Pressable style={ss.submitBtn} onPress={() => router.replace("/(auth)/login")}>
          <Text style={ss.submitText}>Go to sign in</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={ss.root}>
      <LinearGradient colors={[C.violet + "1A", "transparent"]} style={[StyleSheet.absoluteFill, { height: 320 }]} />
      <ScrollView
        contentContainerStyle={[ss.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={ss.header}>
          <Pressable onPress={() => router.back()} style={ss.backBtn} hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color={C.text} />
          </Pressable>
        </View>

        <View style={ss.body}>
          <Text style={ss.heading}>Create account</Text>
          <Text style={ss.sub}>Save your favorites and pick up where you left off on any device.</Text>

          {!isConfigured && (
            <View style={ss.warnBanner}>
              <Ionicons name="warning" size={14} color={C.gold} />
              <Text style={ss.warnText}>Auth backend not configured — see SETUP.md</Text>
            </View>
          )}

          <Pressable
            style={({ pressed }) => [ss.googleBtn, pressed && { opacity: 0.85 }]}
            onPress={handleGoogle}
            disabled={googleLoading || !isConfigured}
          >
            {googleLoading ? <ActivityIndicator color={C.text} /> : (
              <>
                <Ionicons name="logo-google" size={18} color={C.text} />
                <Text style={ss.googleBtnText}>Sign up with Google</Text>
              </>
            )}
          </Pressable>

          <View style={ss.divider}>
            <View style={ss.dividerLine} />
            <Text style={ss.dividerText}>or</Text>
            <View style={ss.dividerLine} />
          </View>

          <View style={ss.inputGroup}>
            <Text style={ss.label}>Email</Text>
            <View style={ss.inputBox}>
              <Ionicons name="mail-outline" size={16} color={C.textMuted} />
              <TextInput
                style={ss.input}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={C.textMuted}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
              />
            </View>
          </View>

          <View style={ss.inputGroup}>
            <Text style={ss.label}>Password</Text>
            <View style={ss.inputBox}>
              <Ionicons name="lock-closed-outline" size={16} color={C.textMuted} />
              <TextInput
                style={ss.input}
                value={password}
                onChangeText={setPassword}
                placeholder="At least 6 characters"
                placeholderTextColor={C.textMuted}
                secureTextEntry={!showPwd}
                autoComplete="password-new"
              />
              <Pressable onPress={() => setShowPwd((v) => !v)} hitSlop={8}>
                <Ionicons name={showPwd ? "eye-off-outline" : "eye-outline"} size={16} color={C.textMuted} />
              </Pressable>
            </View>
          </View>

          <View style={ss.inputGroup}>
            <Text style={ss.label}>Confirm password</Text>
            <View style={ss.inputBox}>
              <Ionicons name="lock-closed-outline" size={16} color={C.textMuted} />
              <TextInput
                style={ss.input}
                value={confirm}
                onChangeText={setConfirm}
                placeholder="••••••••"
                placeholderTextColor={C.textMuted}
                secureTextEntry={!showPwd}
                autoComplete="password-new"
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
            style={({ pressed }) => [ss.submitBtn, pressed && { opacity: 0.88 }, (!email || !password || !confirm) && { opacity: 0.6 }]}
            onPress={handleSignUp}
            disabled={loading || !email || !password || !confirm}
          >
            {loading ? <ActivityIndicator color={C.textOnAccent} /> : <Text style={ss.submitText}>Create account</Text>}
          </Pressable>

          <View style={ss.footer}>
            <Text style={ss.footerText}>Already have an account? </Text>
            <Pressable onPress={() => router.replace("/(auth)/login")}>
              <Text style={ss.footerLink}>Sign in</Text>
            </Pressable>
          </View>
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
  heading: { color: C.text, fontSize: 28, fontWeight: "800", letterSpacing: -0.5, fontFamily: "Outfit_800ExtraBold" },
  sub: { color: C.textSecondary, fontSize: 13, marginTop: 8, marginBottom: 28, fontFamily: "DMSans_500Medium", lineHeight: 18 },

  warnBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: C.goldSoft, borderRadius: R.lg, padding: 12,
    borderWidth: 1, borderColor: C.gold + "33", marginBottom: 16,
  },
  warnText: { color: C.gold, fontSize: 12, flex: 1, fontFamily: "DMSans_500Medium" },

  googleBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    borderRadius: R.pill, paddingVertical: 14, marginBottom: 20,
  },
  googleBtnText: { color: C.text, fontSize: 14, fontWeight: "700", fontFamily: "DMSans_600SemiBold" },

  divider: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: C.border },
  dividerText: { color: C.textMuted, fontSize: 11, fontFamily: "DMSans_500Medium" },

  inputGroup: { marginBottom: 16 },
  label: { color: C.textSecondary, fontSize: 12, fontWeight: "600", marginBottom: 6, fontFamily: "DMSans_600SemiBold" },
  inputBox: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
    borderRadius: R.lg, paddingHorizontal: 14, height: S.inputHeight,
  },
  input: {
    flex: 1, color: C.text, fontSize: 14, height: S.inputHeight,
    fontFamily: "DMSans_500Medium",
  },

  errorBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: C.accentSoft, borderRadius: R.lg, padding: 12, marginTop: 8,
    borderWidth: 1, borderColor: C.borderAccent,
  },
  errorText: { color: C.accent, fontSize: 12, flex: 1, fontFamily: "DMSans_500Medium" },

  submitBtn: {
    backgroundColor: C.accent, borderRadius: R.pill, paddingVertical: 16,
    alignItems: "center", marginTop: 16,
    ...ELEVATION_GLOW,
  },
  submitText: { color: C.textOnAccent, fontSize: 15, fontWeight: "700", fontFamily: "DMSans_600SemiBold" },

  footer: { flexDirection: "row", justifyContent: "center", marginTop: 24 },
  footerText: { color: C.textSecondary, fontSize: 13, fontFamily: "DMSans_500Medium" },
  footerLink: { color: C.accent, fontSize: 13, fontWeight: "700", fontFamily: "DMSans_600SemiBold" },

  // Confirmation state
  confirmCircle: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.borderAccent,
    alignItems: "center", justifyContent: "center", marginBottom: 24,
  },
  confirmTitle: {
    color: C.text, fontSize: 24, fontWeight: "800", marginBottom: 12,
    fontFamily: "Outfit_800ExtraBold",
  },
  confirmText: {
    color: C.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 32,
    fontFamily: "DMSans_500Medium",
  },
});

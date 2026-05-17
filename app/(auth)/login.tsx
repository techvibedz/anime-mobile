import { useState } from "react";
import { View, Text, Pressable, TextInput, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useAuth } from "../../lib/auth";
import { C, R, S, ELEVATION_GLOW } from "../../lib/theme";

export default function Login() {
  const insets = useSafeAreaInsets();
  const { signInWithEmail, signInWithGoogle, isConfigured } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin() {
    setError(null);
    if (!email.trim() || !password) {
      setError("Email and password are required");
      return;
    }
    setLoading(true);
    const { error: err } = await signInWithEmail(email, password);
    setLoading(false);
    if (err) setError(err);
  }

  async function handleGoogle() {
    setError(null);
    setGoogleLoading(true);
    const { error: err } = await signInWithGoogle();
    setGoogleLoading(false);
    if (err) setError(err);
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={ss.root}
    >
      <LinearGradient
        colors={[C.accent + "1A", "transparent"]}
        style={[StyleSheet.absoluteFill, { height: 320 }]}
      />
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
          <Text style={ss.heading}>Welcome back</Text>
          <Text style={ss.sub}>Sign in to sync your watchlist and continue where you left off.</Text>

          {!isConfigured && (
            <View style={ss.warnBanner}>
              <Ionicons name="warning" size={14} color={C.gold} />
              <Text style={ss.warnText}>Auth backend not configured — see SETUP.md</Text>
            </View>
          )}

          {/* Google */}
          <Pressable
            style={({ pressed }) => [ss.googleBtn, pressed && { opacity: 0.85 }]}
            onPress={handleGoogle}
            disabled={googleLoading || !isConfigured}
          >
            {googleLoading ? (
              <ActivityIndicator color={C.text} />
            ) : (
              <>
                <Ionicons name="logo-google" size={18} color={C.text} />
                <Text style={ss.googleBtnText}>Continue with Google</Text>
              </>
            )}
          </Pressable>

          {/* Divider */}
          <View style={ss.divider}>
            <View style={ss.dividerLine} />
            <Text style={ss.dividerText}>or</Text>
            <View style={ss.dividerLine} />
          </View>

          {/* Email */}
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

          {/* Password */}
          <View style={ss.inputGroup}>
            <Text style={ss.label}>Password</Text>
            <View style={ss.inputBox}>
              <Ionicons name="lock-closed-outline" size={16} color={C.textMuted} />
              <TextInput
                style={ss.input}
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor={C.textMuted}
                secureTextEntry={!showPwd}
                autoComplete="password"
              />
              <Pressable onPress={() => setShowPwd((v) => !v)} hitSlop={8}>
                <Ionicons name={showPwd ? "eye-off-outline" : "eye-outline"} size={16} color={C.textMuted} />
              </Pressable>
            </View>
          </View>

          <Pressable onPress={() => router.push("/(auth)/forgot")} style={ss.forgotBtn}>
            <Text style={ss.forgotText}>Forgot password?</Text>
          </Pressable>

          {error && (
            <View style={ss.errorBox}>
              <Ionicons name="alert-circle" size={14} color={C.accent} />
              <Text style={ss.errorText}>{error}</Text>
            </View>
          )}

          {/* Submit */}
          <Pressable
            style={({ pressed }) => [ss.submitBtn, pressed && { opacity: 0.88 }, (!email || !password) && { opacity: 0.6 }]}
            onPress={handleLogin}
            disabled={loading || !email || !password}
          >
            {loading ? (
              <ActivityIndicator color={C.textOnAccent} />
            ) : (
              <Text style={ss.submitText}>Sign in</Text>
            )}
          </Pressable>

          {/* Footer */}
          <View style={ss.footer}>
            <Text style={ss.footerText}>Don't have an account? </Text>
            <Pressable onPress={() => router.replace("/(auth)/register")}>
              <Text style={ss.footerLink}>Sign up</Text>
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

  forgotBtn: { alignSelf: "flex-end", paddingVertical: 6 },
  forgotText: { color: C.accent, fontSize: 12, fontWeight: "600", fontFamily: "DMSans_600SemiBold" },

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
});

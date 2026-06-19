import { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { C, S, R, ELEVATION_CARD, ELEVATION_GLOW } from "../lib/theme";
import { t } from "../lib/i18n";
import { Aurora, ScreenHeader, SectionLabel } from "../components/ScreenChrome";
import { submitReport } from "../lib/reports";
import { useAuth } from "../lib/auth";

const CATEGORIES: { key: string; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "content", label: t.reportCatContent, icon: "eye-off-outline" },
  { key: "playback", label: t.reportCatPlayback, icon: "play-circle-outline" },
  { key: "crash", label: t.reportCatCrash, icon: "bug-outline" },
  { key: "suggestion", label: t.reportCatSuggestion, icon: "bulb-outline" },
  { key: "other", label: t.reportCatOther, icon: "ellipsis-horizontal" },
];

export default function ReportScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [category, setCategory] = useState<string>("content");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState(user?.email ?? "");
  const [shot, setShot] = useState<{ uri: string; base64: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  const pickScreenshot = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t.reportTitle, t.reportPhotoPermission);
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.6,
      base64: true,
    });
    if (res.canceled || !res.assets?.length) return;
    const a = res.assets[0];
    if (a.base64) setShot({ uri: a.uri, base64: a.base64 });
  }, []);

  const onSubmit = useCallback(async () => {
    if (sending) return;
    if (!message.trim()) {
      Alert.alert(t.reportTitle, t.reportErrorEmpty);
      return;
    }
    setSending(true);
    const r = await submitReport({
      message,
      category,
      email,
      screenshotBase64: shot?.base64 ?? null,
    });
    setSending(false);
    if (r.ok) {
      setDone(true);
    } else {
      Alert.alert(t.reportTitle, t.reportErrorFailed);
    }
  }, [sending, message, category, email, shot]);

  if (done) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <Aurora />
        <ScreenHeader title={t.reportTitle} />
        <View style={s.successWrap}>
          <View style={s.successIcon}>
            <Ionicons name="checkmark-circle" size={56} color={C.accent} />
          </View>
          <Text style={s.successTitle}>{t.reportSuccessTitle}</Text>
          <Text style={s.successSub}>{t.reportSuccessSub}</Text>
          <Pressable style={s.successBtn} onPress={() => router.back()}>
            <Text style={s.successBtnText}>{t.reportDone}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <Aurora />
      <ScreenHeader title={t.reportTitle} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={insets.top + 50}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: S.paddingContent, paddingBottom: insets.bottom + 40 }}
        >
          <Text style={s.intro}>{t.reportSub}</Text>

          {/* Category */}
          <SectionLabel>{t.reportCategory}</SectionLabel>
          <View style={s.catWrap}>
            {CATEGORIES.map((cat) => {
              const active = category === cat.key;
              return (
                <Pressable
                  key={cat.key}
                  onPress={() => setCategory(cat.key)}
                  style={[s.catChip, active && s.catChipActive]}
                >
                  <Ionicons name={cat.icon} size={15} color={active ? C.textOnAccent : C.textSecondary} />
                  <Text style={[s.catText, active && s.catTextActive]}>{cat.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* Message */}
          <View style={s.sectionGap} />
          <SectionLabel>{t.reportMessageLabel}</SectionLabel>
          <TextInput
            style={s.textArea}
            value={message}
            onChangeText={setMessage}
            placeholder={t.reportMessagePlaceholder}
            placeholderTextColor={C.textMuted}
            multiline
            textAlign="right"
            textAlignVertical="top"
          />

          {/* Screenshot */}
          <View style={s.sectionGap} />
          <SectionLabel>{t.reportScreenshot}</SectionLabel>
          {shot ? (
            <View style={s.shotCard}>
              <Image source={{ uri: shot.uri }} style={s.shotImage} contentFit="cover" />
              <View style={s.shotActions}>
                <Pressable style={s.shotActionBtn} onPress={pickScreenshot}>
                  <Ionicons name="image-outline" size={16} color={C.text} />
                  <Text style={s.shotActionText}>{t.reportScreenshotChange}</Text>
                </Pressable>
                <Pressable style={s.shotActionBtn} onPress={() => setShot(null)}>
                  <Ionicons name="trash-outline" size={16} color={C.accent} />
                  <Text style={[s.shotActionText, { color: C.accent }]}>{t.reportScreenshotRemove}</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable style={s.attachBtn} onPress={pickScreenshot}>
              <Ionicons name="camera-outline" size={20} color={C.accent} />
              <Text style={s.attachText}>{t.reportScreenshot}</Text>
            </Pressable>
          )}

          {/* Email */}
          <View style={s.sectionGap} />
          <SectionLabel>{t.reportEmailLabel}</SectionLabel>
          <TextInput
            style={s.input}
            value={email}
            onChangeText={setEmail}
            placeholder={t.emailPlaceholder}
            placeholderTextColor={C.textMuted}
            keyboardType="email-address"
            autoCapitalize="none"
            textAlign="right"
          />

          {/* Submit */}
          <Pressable
            style={[s.submitBtn, sending && { opacity: 0.7 }]}
            onPress={onSubmit}
            disabled={sending}
          >
            {sending ? (
              <ActivityIndicator size="small" color={C.textOnAccent} />
            ) : (
              <Ionicons name="send" size={16} color={C.textOnAccent} />
            )}
            <Text style={s.submitText}>{sending ? t.reportSending : t.reportSubmit}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  intro: {
    color: C.textSecondary, fontSize: 14, lineHeight: 21, textAlign: "right",
    fontFamily: "Cairo_500Medium", marginBottom: 20,
  },
  sectionGap: { height: 22 },

  // Category chips
  catWrap: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 8 },
  catChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: R.pill,
    backgroundColor: C.glass, borderWidth: 1, borderColor: C.glassBorder,
  },
  catChipActive: { backgroundColor: C.accent, borderColor: C.accent, ...ELEVATION_GLOW },
  catText: { color: C.textSecondary, fontSize: 13, fontWeight: "700", fontFamily: "Cairo_600SemiBold" },
  catTextActive: { color: C.textOnAccent },

  // Inputs
  textArea: {
    minHeight: 130, borderRadius: R.xl, padding: 16,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    color: C.text, fontSize: 14, lineHeight: 21, fontFamily: "Cairo_500Medium",
    ...ELEVATION_CARD,
  },
  input: {
    height: 52, borderRadius: R.lg, paddingHorizontal: 16,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    color: C.text, fontSize: 14, fontFamily: "Cairo_500Medium",
  },

  // Screenshot
  attachBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    height: 56, borderRadius: R.lg,
    backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.borderAccent,
    borderStyle: "dashed",
  },
  attachText: { color: C.accent, fontSize: 14, fontWeight: "700", fontFamily: "Cairo_700Bold" },
  shotCard: {
    borderRadius: R.xl, overflow: "hidden",
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, ...ELEVATION_CARD,
  },
  shotImage: { width: "100%", aspectRatio: 16 / 10, backgroundColor: C.surfaceLight },
  shotActions: { flexDirection: "row", borderTopWidth: 1, borderTopColor: C.border },
  shotActionBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 13,
  },
  shotActionText: { color: C.text, fontSize: 13, fontWeight: "600", fontFamily: "Cairo_600SemiBold" },

  // Submit
  submitBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9,
    marginTop: 28, height: 54, borderRadius: R.pill,
    backgroundColor: C.accent, ...ELEVATION_GLOW,
  },
  submitText: { color: C.textOnAccent, fontSize: 15, fontWeight: "700", fontFamily: "Cairo_700Bold" },

  // Success
  successWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40, gap: 14 },
  successIcon: {
    width: 96, height: 96, borderRadius: R.circle,
    backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.borderAccent,
    alignItems: "center", justifyContent: "center", marginBottom: 6,
  },
  successTitle: { color: C.text, fontSize: 20, fontWeight: "800", fontFamily: "Cairo_700Bold", textAlign: "center" },
  successSub: { color: C.textSecondary, fontSize: 14, lineHeight: 21, textAlign: "center", fontFamily: "Cairo_500Medium" },
  successBtn: {
    marginTop: 10, backgroundColor: C.accent, borderRadius: R.pill,
    paddingVertical: 13, paddingHorizontal: 40, ...ELEVATION_GLOW,
  },
  successBtnText: { color: C.textOnAccent, fontSize: 14, fontWeight: "700", fontFamily: "Cairo_700Bold" },
});

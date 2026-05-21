import { Modal, View, Text, Pressable, StyleSheet, Linking } from "react-native";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { C, R, ELEVATION_GLOW } from "../lib/theme";
import type { UpdateInfo } from "../lib/updater";
import { applyOtaUpdate, openApkDownload } from "../lib/updater";

interface Props {
  info: UpdateInfo | null;
  onClose: () => void;
}

export function UpdateModal({ info, onClose }: Props) {
  if (!info) return null;

  const isOta = info.type === "ota";
  const title = isOta ? "تحديث جديد للتطبيق!" : "إصدار جديد متاح!";
  const subtitle = isOta
    ? "لقد قمنا بإصدار تحديث جديد لتحسين تجربتك. هل ترغب في إعادة التشغيل وتطبيقه الآن؟"
    : `الإصدار ${info.version} متوفر الآن للتحميل. يرجى التحديث للحصول على أفضل تجربة.`;

  const handleAction = () => {
    if (isOta) {
      applyOtaUpdate();
    } else if (info.apkUrl) {
      openApkDownload(info.apkUrl);
    }
  };

  return (
    <Modal transparent animationType="fade" visible onRequestClose={info.isForce ? undefined : onClose}>
      <BlurView intensity={40} tint="dark" style={ss.backdrop}>
        <View style={ss.sheet}>
          <View style={ss.iconContainer}>
            <LinearGradient
              colors={[C.accent, C.violet]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={ss.iconGrad}
            >
              <Ionicons name="cloud-download-outline" size={32} color="#fff" />
            </LinearGradient>
          </View>
          
          <Text style={ss.title}>{title}</Text>
          <Text style={ss.subtitle}>{subtitle}</Text>

          {info.releaseNotes ? (
            <View style={ss.notesContainer}>
              <Text style={ss.notesTitle}>ما الجديد:</Text>
              <Text style={ss.notesText}>{info.releaseNotes}</Text>
            </View>
          ) : null}

          <View style={ss.buttons}>
            <Pressable style={ss.btnPrimary} onPress={handleAction}>
              <LinearGradient
                colors={[C.accent, C.violet]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={ss.btnGrad}
              >
                <Ionicons name="refresh" size={20} color="#fff" />
                <Text style={ss.btnPrimaryText}>{isOta ? "إعادة التشغيل الآن" : "تحديث الآن"}</Text>
              </LinearGradient>
            </Pressable>

            {!info.isForce && (
              <Pressable style={ss.btnSecondary} onPress={onClose}>
                <Text style={ss.btnSecondaryText}>لاحقاً</Text>
              </Pressable>
            )}
          </View>
        </View>
      </BlurView>
    </Modal>
  );
}

const ss = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  sheet: {
    width: "100%",
    maxWidth: 340,
    backgroundColor: C.surface,
    borderRadius: R.xl,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: C.border,
    shadowColor: C.accent,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
  },
  iconContainer: {
    marginBottom: 20,
    ...ELEVATION_GLOW,
  },
  iconGrad: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    fontFamily: "Outfit_800ExtraBold",
    color: C.text,
    textAlign: "center",
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 14,
    color: C.textMuted,
    fontFamily: "DMSans_500Medium",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 20,
  },
  notesContainer: {
    width: "100%",
    backgroundColor: C.surfaceGlass,
    borderRadius: R.md,
    padding: 12,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: C.glassBorder,
  },
  notesTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: C.text,
    marginBottom: 6,
    fontFamily: "Outfit_700Bold",
    textAlign: "right",
  },
  notesText: {
    fontSize: 13,
    color: C.textSecondary,
    fontFamily: "DMSans_400Regular",
    textAlign: "right",
    lineHeight: 20,
  },
  buttons: {
    width: "100%",
    gap: 12,
  },
  btnPrimary: {
    width: "100%",
    borderRadius: R.pill,
    overflow: "hidden",
  },
  btnGrad: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
  },
  btnPrimaryText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    fontFamily: "Outfit_700Bold",
  },
  btnSecondary: {
    width: "100%",
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  btnSecondaryText: {
    color: C.textMuted,
    fontSize: 15,
    fontWeight: "600",
    fontFamily: "DMSans_600SemiBold",
  },
});

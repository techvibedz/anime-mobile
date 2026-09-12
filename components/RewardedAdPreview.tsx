import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef } from "react";
import { Animated, Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { useReducedMotion } from "../lib/motion";
import { AR } from "../lib/theme";

type Props = {
  visible: boolean;
  onClose: () => void;
  onWatchAd: () => void;
};

export function RewardedAdPreview({ visible, onClose, onWatchAd }: Props) {
  const reducedMotion = useReducedMotion();
  const scale = useRef(new Animated.Value(0.94)).current;

  useEffect(() => {
    if (!visible) return;
    scale.setValue(reducedMotion ? 1 : 0.94);
    if (reducedMotion) return;
    Animated.spring(scale, {
      toValue: 1,
      damping: 16,
      stiffness: 180,
      mass: 0.8,
      useNativeDriver: true,
    }).start();
  }, [reducedMotion, scale, visible]);

  return (
    <Modal
      transparent
      statusBarTranslucent
      visible={visible}
      animationType={reducedMotion ? "none" : "fade"}
      onRequestClose={onClose}
    >
      <View style={s.backdrop}>
        <Animated.View testID="rewarded-ad-preview" style={[s.card, { transform: [{ scale }] }]}>
          <View pointerEvents="none" style={s.glow} />
          <View pointerEvents="none" style={[s.corner, s.cornerTopLeft]} />
          <View pointerEvents="none" style={[s.corner, s.cornerBottomRight]} />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="إغلاق"
            hitSlop={8}
            onPress={onClose}
            style={({ pressed }) => [s.closeButton, pressed && s.pressed]}
          >
            <Ionicons name="close" size={25} color="#FFFFFF" />
          </Pressable>

          <LinearGradient colors={["#7219A8", "#2B0B47"]} style={s.banner}>
            <Text style={s.bannerText}>إعلان مطلوب</Text>
          </LinearGradient>

          <LinearGradient colors={["#A52CDE", "#561099"]} style={s.iconWrap}>
            <Ionicons name="tv-outline" size={39} color="#FFFFFF" />
            <View style={s.playDot}>
              <Ionicons name="play" size={13} color="#FFFFFF" />
            </View>
          </LinearGradient>

          <Text style={s.headline}>
            شاهد <Text style={s.headlineAccent}>إعلاناً</Text>
          </Text>
          <Text style={s.subtitle}>لمواصلة مشاهدة الأنمي والمحتوى المميز</Text>

          <View style={s.durationPill}>
            <Ionicons name="sparkles" size={15} color="#E553FF" />
            <Text style={s.durationText}>لن يستغرق الأمر سوى 15 - 30 ثانية</Text>
          </View>

          <Pressable
            testID="rewarded-ad-watch"
            accessibilityRole="button"
            accessibilityLabel="شاهد الإعلان"
            accessibilityHint="يشغّل اختبار زر الإعلان"
            onPress={onWatchAd}
            style={({ pressed }) => [pressed && s.pressed]}
          >
            <LinearGradient colors={["#AA2CE0", "#6210A9"]} style={s.watchButton}>
              <Ionicons name="videocam-outline" size={25} color="#FFFFFF" />
              <Text style={s.watchText}>شاهد الإعلان</Text>
            </LinearGradient>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 28,
    backgroundColor: "rgba(3,2,8,0.82)",
  },
  card: {
    width: "100%",
    maxWidth: 360,
    overflow: "hidden",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 20,
    borderWidth: 1,
    borderColor: "#9E35D7",
    borderRadius: 20,
    backgroundColor: "#08070D",
    shadowColor: "#B62CFF",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.38,
    shadowRadius: 18,
    elevation: 14,
  },
  glow: {
    position: "absolute",
    top: -90,
    width: 260,
    height: 180,
    borderRadius: 130,
    backgroundColor: "rgba(150,38,224,0.18)",
  },
  corner: {
    position: "absolute",
    width: 58,
    height: 3,
    backgroundColor: "#C347FF",
  },
  cornerTopLeft: { left: -13, top: 14, transform: [{ rotate: "-30deg" }] },
  cornerBottomRight: { right: -13, bottom: 14, transform: [{ rotate: "-30deg" }] },
  closeButton: {
    position: "absolute",
    zIndex: 2,
    right: 10,
    top: 10,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(212,83,255,0.65)",
    borderRadius: 22,
    backgroundColor: "#17101E",
  },
  banner: {
    minWidth: 170,
    alignItems: "center",
    paddingHorizontal: 28,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: "rgba(224,112,255,0.72)",
    borderRadius: 8,
  },
  bannerText: {
    color: "#FFFFFF",
    fontFamily: AR.bold,
    fontSize: 22,
    lineHeight: 31,
    textAlign: "center",
  },
  iconWrap: {
    width: 70,
    height: 62,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
    borderWidth: 1,
    borderColor: "#D77CFF",
    borderRadius: 17,
  },
  playDot: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    width: 25,
    height: 25,
    borderRadius: 13,
    backgroundColor: "rgba(16,5,27,0.82)",
  },
  headline: {
    marginTop: 12,
    color: "#FFFFFF",
    fontFamily: AR.bold,
    fontSize: 27,
    lineHeight: 39,
    textAlign: "center",
    writingDirection: "rtl",
  },
  headlineAccent: { color: "#D946EF" },
  subtitle: {
    marginTop: 2,
    color: "#E7E0EB",
    fontFamily: AR.medium,
    fontSize: 13,
    lineHeight: 21,
    textAlign: "center",
    writingDirection: "rtl",
  },
  durationPill: {
    width: "100%",
    minHeight: 40,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 14,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: "rgba(207,64,255,0.62)",
    borderRadius: 10,
    backgroundColor: "rgba(108,22,146,0.14)",
  },
  durationText: {
    color: "#DFA5F3",
    fontFamily: AR.semibold,
    fontSize: 12,
    lineHeight: 19,
    textAlign: "center",
    writingDirection: "rtl",
  },
  watchButton: {
    minHeight: 52,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 11,
    marginTop: 14,
    paddingHorizontal: 28,
    borderWidth: 1,
    borderColor: "#E17BFF",
    borderRadius: 12,
  },
  watchText: {
    color: "#FFFFFF",
    fontFamily: AR.bold,
    fontSize: 20,
    lineHeight: 29,
  },
  pressed: { opacity: 0.72 },
});

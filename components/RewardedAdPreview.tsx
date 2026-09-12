import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useReducedMotion } from "../lib/motion";

type Props = {
  visible: boolean;
  onClose: () => void;
  onWatchAd: () => void;
};

export function RewardedAdPreview({ visible, onClose, onWatchAd }: Props) {
  const reducedMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
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

  if (!visible) return null;

  return (
    <View pointerEvents="box-none" style={[s.host, { top: insets.top + 12 }]}>
      <Animated.View
        testID="rewarded-ad-preview"
        style={[s.card, { width: Math.min(380, width - 28), transform: [{ scale }] }]}
      >
        <LinearGradient
          pointerEvents="none"
          colors={["rgba(145,32,214,0.32)", "rgba(8,7,13,0)"]}
          style={s.glow}
        />
        <View pointerEvents="none" style={[s.slash, s.slashTop]} />
        <View pointerEvents="none" style={[s.slash, s.slashBottom]} />

        <View style={s.topRow}>
          <LinearGradient colors={["#8D24C8", "#3B0C65"]} style={s.label}>
            <Text style={s.labelText}>إعلان مطلوب</Text>
          </LinearGradient>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="إغلاق"
            hitSlop={10}
            onPress={onClose}
            style={({ pressed }) => [s.closeButton, pressed && s.pressed]}
          >
            <Ionicons name="close" size={25} color="#FFFFFF" />
          </Pressable>
        </View>

        <LinearGradient colors={["#A52CDE", "#51108E"]} style={s.iconWrap}>
          <Ionicons name="tv-outline" size={42} color="#FFFFFF" />
          <View style={s.playDot}>
            <Ionicons name="play" size={14} color="#FFFFFF" />
          </View>
        </LinearGradient>

        <Text style={s.headline}>
          شاهد <Text style={s.headlineAccent}>إعلاناً</Text>
        </Text>
        <Text style={s.subtitle}>لمواصلة مشاهدة الأنمي والمحتوى المميز</Text>

        <View style={s.durationPill}>
          <Ionicons name="sparkles" size={16} color="#E96BFF" />
          <Text style={s.durationText}>لن يستغرق الأمر سوى 15 - 30 ثانية</Text>
        </View>

        <Pressable
          testID="rewarded-ad-watch"
          accessibilityRole="button"
          accessibilityLabel="شاهد الإعلان"
          accessibilityHint="يشغّل اختبار زر الإعلان"
          onPress={onWatchAd}
          style={({ pressed }) => [s.watchTarget, pressed && s.pressed]}
        >
          <LinearGradient colors={["#B034E8", "#6612AE"]} style={s.watchButton}>
            <Ionicons name="videocam-outline" size={24} color="#FFFFFF" />
            <Text style={s.watchText}>شاهد الإعلان</Text>
          </LinearGradient>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  host: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 100,
    elevation: 100,
    alignItems: "center",
  },
  card: {
    overflow: "hidden",
    alignItems: "center",
    paddingHorizontal: 22,
    paddingTop: 16,
    paddingBottom: 22,
    borderWidth: 1,
    borderColor: "#9E35D7",
    borderRadius: 22,
    backgroundColor: "#08070D",
    shadowColor: "#B62CFF",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.42,
    shadowRadius: 20,
  },
  glow: {
    position: "absolute",
    top: -85,
    width: 300,
    height: 210,
    borderRadius: 150,
  },
  slash: {
    position: "absolute",
    width: 74,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#CF4DFF",
  },
  slashTop: { left: -18, top: 18, transform: [{ rotate: "-28deg" }] },
  slashBottom: { right: -18, bottom: 18, transform: [{ rotate: "-28deg" }] },
  topRow: {
    width: "100%",
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    minWidth: 190,
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#C855F0",
    borderRadius: 10,
  },
  labelText: {
    color: "#FFFFFF",
    fontSize: 22,
    fontFamily: "Cairo_700Bold",
  },
  closeButton: {
    position: "absolute",
    right: -7,
    top: -3,
    width: 46,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#A63DDA",
    borderRadius: 23,
    backgroundColor: "#191020",
  },
  iconWrap: {
    width: 82,
    height: 70,
    marginTop: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#D96BFF",
    borderRadius: 18,
  },
  playDot: {
    position: "absolute",
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: "rgba(14,7,23,0.84)",
  },
  headline: {
    marginTop: 13,
    color: "#FFFFFF",
    fontSize: 29,
    fontFamily: "Cairo_700Bold",
    textAlign: "center",
  },
  headlineAccent: { color: "#E34BFF" },
  subtitle: {
    marginTop: -3,
    color: "#D8D0DE",
    fontSize: 14,
    fontFamily: "Cairo_500Medium",
    textAlign: "center",
  },
  durationPill: {
    width: "100%",
    minHeight: 45,
    marginTop: 16,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(198,63,239,0.55)",
    borderRadius: 12,
    backgroundColor: "rgba(123,33,161,0.16)",
  },
  durationText: {
    color: "#E3C7EB",
    fontSize: 13,
    fontFamily: "Cairo_600SemiBold",
    textAlign: "center",
  },
  watchTarget: { width: "100%", marginTop: 14, borderRadius: 13 },
  watchButton: {
    minHeight: 54,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: "#CF5BF4",
    borderRadius: 13,
  },
  watchText: { color: "#FFFFFF", fontSize: 18, fontFamily: "Cairo_700Bold" },
  pressed: { opacity: 0.78 },
});
